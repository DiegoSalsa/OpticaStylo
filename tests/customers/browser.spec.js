import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { database } from "../prescriptions/helpers.js";
import { fixtureRut } from "../rut-fixture.js";
import { evaluation } from "../evaluation-data.js";
import { inventoryDemo as inv } from "../inventory/data.js";
const index = info => ["escritorio", "tablet", "movil"].indexOf(info.project.name);
async function login(page) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico", {
    exact: true
  }).fill(evaluation.adminEmail);
  await page.getByLabel("Contraseña", {
    exact: true
  }).fill(evaluation.password);
  await page.getByRole("button", {
    name: "Ingresar de forma segura",
    exact: true
  }).click();
  await expect(page).toHaveURL(/\/app$/);
}
async function value(r, status = 200) {
  expect(r.status(), await r.text()).toBe(status);
  return (await r.json()).data;
}
async function product(page) {
  const id = randomUUID(),
    p = await value(await page.request.post("/api/products", {
      data: {
        sku: "CLI-UI-" + id,
        name: "Armazón comercial sintético " + id,
        category: "FRAME",
        unitPriceCents: 1000,
        requiresPrescription: false
      }
    }), 201);
  for (const branchId of inv.branches.slice(0, 2)) await value(await page.request.post("/api/inventory", {
    headers: {
      "X-Idempotency-Key": randomUUID()
    },
    data: {
      branchId,
      productId: p.id,
      kind: "COUNT",
      quantity: 10,
      expectedVersion: null,
      reason: "Conteo comercial sintético para navegador"
    }
  }));
  return p;
}
async function open(page, branchId) {
  const t = await value(await page.request.post("/api/cash-register/terminals", {
    data: {
      branchId,
      name: "Caja clientes navegador " + randomUUID()
    }
  }), 201);
  await page.goto("/app/ventas");
  await page.getByRole("combobox", {
    name: "Sucursal de la venta",
    exact: true
  }).selectOption(branchId);
  await page.getByRole("combobox", {
    name: "Punto de cobro",
    exact: true
  }).selectOption(t.id);
  await page.getByLabel("Fondo inicial de efectivo", {
    exact: true
  }).fill("0");
  const response = page.waitForResponse(r => r.url().endsWith("/api/cash-register") && r.request().method() === "POST");
  await page.getByRole("button", {
    name: "Abrir caja",
    exact: true
  }).click();
  return value(await response, 201);
}
async function pay(page, p, session) {
  await page.getByRole("textbox", {
    name: "Buscar productos",
    exact: true
  }).fill(p.sku);
  await page.locator(".product-results button").filter({
    hasText: p.sku
  }).click();
  await page.getByRole("button", {
    name: "Continuar al cobro",
    exact: true
  }).click();
  await page.getByLabel("Importe del pago 1", {
    exact: true
  }).fill("1000");
  await page.getByLabel("Efectivo recibido 1", {
    exact: true
  }).fill("1000");
  const saving = page.waitForResponse(r => /\/api\/sales\/[^/]+\/payments$/.test(r.url()) && r.request().method() === "POST");
  await page.getByRole("button", {
    name: "Confirmar cobro",
    exact: true
  }).click();
  const sale = await value(await saving, 201);
  await value(await page.request.post(`/api/cash-register/${session.id}/close`, {
    data: {
      closingCountedCents: 1000,
      closingNotes: "Fin de compra sintética"
    }
  }));
  return sale;
}
test.beforeEach(async () => {
  const db = database();
  try {
    await db.public_request_rate_limits.deleteMany();
  } finally {
    await db.$disconnect();
  }
});
test("Cliente en administración → dos compras POS → perfil recurrente persistido", async ({
  page
}, info) => {
  const rut = fixtureRut(9800 + index(info)),
    name = "Cliente navegador " + info.project.name;
  await login(page);
  await page.goto("/app/clientes");
  await page.getByRole("textbox", {
    name: "Nombres",
    exact: true
  }).fill(name);
  await page.getByRole("textbox", {
    name: "RUT",
    exact: true
  }).fill(rut);
  const creating = page.waitForResponse(r => r.url().endsWith("/api/customers") && r.request().method() === "POST");
  await page.getByRole("button", {
    name: "Crear cliente",
    exact: true
  }).click();
  const customer = await value(await creating, 201);
  await expect(page.getByRole("heading", {
    name: "Perfil comercial",
    exact: true
  })).toBeVisible();
  const p = await product(page);
  for (const branchId of inv.branches.slice(0, 2)) {
    const session = await open(page, branchId);
    await page.getByText("Cliente e historial (opcional)", {
      exact: true
    }).click();
    await page.getByRole("textbox", {
      name: "Buscar cliente",
      exact: true
    }).fill(rut);
    await page.locator(".result-list button").filter({
      hasText: name
    }).click();
    await expect(page.getByRole("heading", {
      name: "Resumen del cliente",
      exact: true
    })).toBeVisible();
    const sale = await pay(page, p, session);
    expect(sale.customer.id).toBe(customer.id);
  }
  await page.goto("/app/clientes");
  await page.getByRole("textbox", {
    name: "Buscar clientes",
    exact: true
  }).fill(rut);
  await page.getByRole("button", {
    name: "Buscar",
    exact: true
  }).click();
  await page.locator(".management-list button").filter({
    hasText: name
  }).click();
  const profile = page.getByRole("region", {
    name: "Perfil comercial del cliente"
  });
  await expect(profile.getByText("Cliente recurrente", {
    exact: true
  })).toBeVisible();
  await expect(profile.locator(".commercial-metrics > div").filter({
    has: page.locator("dt", {
      hasText: /^Compras válidas$/
    })
  }).locator("dd")).toHaveText("2");
  await profile.getByText("Historial comercial", {
    exact: true
  }).click();
  await expect(profile.locator(".commercial-operation")).toHaveCount(2);
  await profile.getByText("Preferencias comerciales declaradas", {
    exact: true
  }).click();
  await profile.getByRole("textbox", {
    name: "Marcas preferidas, separadas por coma",
    exact: true
  }).fill("Marca declarada en navegador");
  await profile.getByRole("button", {
    name: "Guardar preferencias",
    exact: true
  }).click();
  await expect(profile.getByRole("status").filter({
    hasText: "Preferencias comerciales guardadas"
  })).toBeVisible();
  await page.reload();
  await page.getByRole("textbox", {
    name: "Buscar clientes",
    exact: true
  }).fill(rut);
  await page.getByRole("button", {
    name: "Buscar",
    exact: true
  }).click();
  await page.locator(".management-list button").filter({
    hasText: name
  }).click();
  await page.getByText("Preferencias comerciales declaradas", {
    exact: true
  }).click();
  await expect(page.getByRole("textbox", {
    name: "Marcas preferidas, separadas por coma",
    exact: true
  })).toHaveValue("Marca declarada en navegador");
  const db = database();
  try {
    expect(await db.sales.count({
      where: {
        customer_id: customer.id,
        status: "PAID"
      }
    })).toBe(2);
    expect((await db.customers.findUniqueOrThrow({
      where: {
        id: customer.id
      }
    })).commercial_preferences.brands).toEqual(["Marca declarada en navegador"]);
  } finally {
    await db.$disconnect();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath("perfil-recurrente.png"),
    fullPage: true
  });
});
test("Alta rápida en POS y venta sin identificación siguen disponibles", async ({
  page
}, info) => {
  await login(page);
  const p = await product(page),
    session = await open(page, inv.branches[0]);
  await page.getByText("Cliente e historial (opcional)", {
    exact: true
  }).click();
  await page.getByRole("button", {
    name: "+ Crear cliente",
    exact: true
  }).click();
  await page.getByLabel("Nombre", {
    exact: true
  }).fill("Cliente rápido sintético " + info.project.name);
  const created = page.waitForResponse(r => r.url().endsWith("/api/customers") && r.request().method() === "POST");
  await page.getByRole("button", {
    name: "Crear y seleccionar",
    exact: true
  }).click();
  const customer = await value(await created, 201);
  const sale = await pay(page, p, session);
  expect(sale.customer.id).toBe(customer.id);
  const second = await open(page, inv.branches[0]);
  expect((await pay(page, p, second)).customer).toBe(null);
});
test("Compra invitada → registro con verificación → recuperación privada del pedido", async ({
  page
}, info) => {
  await login(page);
  const p = await product(page);
  await page.request.post("/api/auth/logout");
  const buyer = {
    rut: fixtureRut(9820 + index(info)),
    firstNames: "Comprador invitado",
    lastNames: "Sintético " + info.project.name,
    email: `cuenta-historica-${info.project.name}@example.invalid`,
    phone: "+56912345678",
    address: "Calle sintética 123"
  };
  await value(await page.request.post("/api/store/cart"), 201);
  await value(await page.request.post("/api/store/cart/items", {
    data: {
      items: [{
        productId: p.id,
        quantity: 1
      }]
    }
  }));
  await value(await page.request.patch("/api/store/cart", {
    data: {
      buyer,
      fulfillment: {
        method: "PICKUP",
        branchId: inv.branches[0]
      }
    }
  }));
  const order = (await value(await page.request.post("/api/store/cart/checkout"), 201)).order;
  await page.goto("/cuenta");
  await page.getByRole("button", {
    name: "Crear cuenta",
    exact: true
  }).click();
  for (const [label, key] of [["RUT", "rut"], ["Nombres", "firstNames"], ["Apellidos", "lastNames"], ["Teléfono", "phone"], ["Dirección", "address"], ["Correo electrónico", "email"]]) await page.getByRole("textbox", {
    name: label,
    exact: true
  }).fill(buyer[key]);
  await page.getByLabel("Contraseña (mínimo 15 caracteres)", {
    exact: true
  }).fill(evaluation.password);
  const requesting = page.waitForResponse(r => r.url().endsWith("/api/store/accounts/register/request-code"));
  await page.getByRole("button", {
    name: "Verificar registro de compras anteriores",
    exact: true
  }).click();
  const challenge = await value(await requesting);
  const db = database();
  try {
    const row = await db.transactional_email_outbox.findUniqueOrThrow({
      where: {
        deduplication_key: "CUSTOMER_COMMERCE_OTP:" + challenge.challengeId
      }
    });
    await page.getByRole("textbox", {
      name: "Código para crear la cuenta",
      exact: true
    }).fill(row.payload.code);
  } finally {
    await db.$disconnect();
  }
  await page.getByRole("button", {
    name: "Crear cuenta segura",
    exact: true
  }).click();
  await expect(page.getByRole("heading", {
    name: "Hola, Comprador invitado",
    exact: true
  })).toBeVisible();
  await page.getByText("Recuperar una compra anterior como invitado", {
    exact: true
  }).click();
  await page.getByRole("textbox", {
    name: "Número del pedido anterior",
    exact: true
  }).fill(String(order.saleNumber));
  const req = page.waitForResponse(r => r.url().endsWith("/api/store/accounts/me/orders-link/request-code"));
  await page.getByRole("button", {
    name: "Solicitar código del pedido",
    exact: true
  }).click();
  const c = await value(await req);
  const database2 = database();
  try {
    const row = await database2.transactional_email_outbox.findUniqueOrThrow({
      where: {
        deduplication_key: "CUSTOMER_COMMERCE_OTP:" + c.challengeId
      }
    });
    await page.getByRole("textbox", {
      name: "Código del pedido anterior",
      exact: true
    }).fill(row.payload.code);
  } finally {
    await database2.$disconnect();
  }
  await page.getByRole("button", {
    name: "Confirmar recuperación",
    exact: true
  }).click();
  await expect(page.getByRole("status").filter({
    hasText: "Pedido recuperado en esta cuenta."
  })).toBeVisible();
  await expect(page.locator(".order-row").filter({
    hasText: `Pedido N.º ${order.saleNumber}`
  })).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".order-row").filter({
    hasText: `Pedido N.º ${order.saleNumber}`
  })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath("cuenta-pedido-recuperado.png"),
    fullPage: true
  });
});
