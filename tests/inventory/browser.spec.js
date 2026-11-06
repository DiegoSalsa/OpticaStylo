import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { database } from "../prescriptions/helpers.js";
import { evaluation } from "../evaluation-data.js";
import { inventoryDemo } from "./data.js";

test.beforeEach(async () => { const db=database(); try { await db.public_request_rate_limits.deleteMany(); } finally { await db.$disconnect(); } });
async function login(page,email=evaluation.adminEmail) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico",{exact:true}).fill(email);
  await page.getByLabel("Contraseña",{exact:true}).fill(evaluation.password);
  await page.getByRole("button",{name:"Ingresar de forma segura",exact:true}).click();
  await expect(page).toHaveURL(/\/app$/);
}
async function search(page,sku) {
  await page.getByLabel("Buscar producto",{exact:true}).fill(sku);
  await page.getByRole("button",{name:"Buscar",exact:true}).click();
  await expect(page.getByRole("table",{name:/Existencias/}).locator("tbody tr").filter({hasText:sku})).toHaveCount(1);
}
test("Ingresar stock, comprobar persistencia, despachar y recibir físicamente una transferencia",async({page},info)=>{
  const index=info.project.name==="movil"?1:0, sku=`INV-NAVEGADOR-${index+1}`;
  await login(page); await page.getByRole("link",{name:"Inventario por sucursal",exact:true}).click();
  await page.getByRole("combobox",{name:"Sucursal",exact:true}).selectOption(inventoryDemo.branches[0]);
  await search(page,sku);
  await page.getByRole("button",{name:`Registrar movimiento de ${sku}`,exact:true}).click();
  await page.getByLabel("Cantidad del movimiento",{exact:true}).fill("2");
  await page.getByLabel("Motivo u origen",{exact:true}).fill("Ingreso sintético desde navegador");
  await page.getByRole("button",{name:"Confirmar movimiento",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Movimiento registrado y auditado"})).toBeVisible();
  await expect(page.getByRole("table",{name:/Existencias/}).locator("tbody tr").filter({hasText:sku})).toContainText("1002");
  await page.reload(); await search(page,sku);
  await expect(page.getByRole("table",{name:/Existencias/}).locator("tbody tr").filter({hasText:sku})).toContainText("1002");
  await page.getByRole("button",{name:`Registrar movimiento de ${sku}`,exact:true}).click();
  await page.getByLabel("Cantidad del movimiento",{exact:true}).fill("2");
  await page.getByLabel("Motivo u origen",{exact:true}).fill("Traslado sintético desde navegador");
  await page.getByText("Transferir este producto",{exact:true}).click();
  await page.getByRole("combobox",{name:"Destino",exact:true}).selectOption(inventoryDemo.branches[1]);
  await page.getByRole("button",{name:"Despachar transferencia",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Transferencia despachada"})).toBeVisible();
  await page.getByRole("combobox",{name:"Sucursal",exact:true}).selectOption(inventoryDemo.branches[1]);
  await search(page,sku);
  await expect(page.getByRole("table",{name:/Existencias/}).locator("tbody tr").filter({hasText:sku})).toContainText("3");
  const shipment=page.locator("article").filter({hasText:`Armazón inventario navegador ${index+1}`});
  await shipment.getByRole("button",{name:"Confirmar recepción física",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Transferencia actualizada"})).toBeVisible();
  await expect(page.getByRole("table",{name:/Existencias/}).locator("tbody tr").filter({hasText:sku})).toContainText("5");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("Importación revisada distingue conteo cero y el empleado solo ve su sucursal",async({page})=>{
  await login(page);
  const sku=`CSV-${randomUUID()}`.toUpperCase();
  const created=await page.request.post("/api/products",{data:{sku,name:`Armazón sintético ${sku}`,category:"FRAME",requiresPrescription:false,unitPriceCents:1000}});
  expect(created.status()).toBe(201);
  await page.goto("/app/inventario");
  await page.getByRole("combobox",{name:"Sucursal",exact:true}).selectOption(inventoryDemo.branches[0]);
  await search(page,sku); await expect(page.getByRole("table",{name:/Existencias/}).locator("tbody tr").filter({hasText:sku})).toContainText("Sin conteo");
  await page.getByLabel("Contenido del inventario",{exact:true}).fill(`sku,cantidad\n${sku},0`);
  await page.getByRole("button",{name:"Previsualizar inventario",exact:true}).click();
  await expect(page.getByText(/Fila 2:/)).toContainText("sin conteo → 0");
  await expect(page.getByRole("button",{name:"Confirmar carga de inventario",exact:true})).toBeDisabled();
  await page.getByLabel("Origen del conteo / motivo de conciliación",{exact:true}).fill("Inventario sintético revisado");
  await page.getByRole("checkbox",{name:/He revisado las coincidencias/}).check();
  await page.getByRole("button",{name:"Confirmar carga de inventario",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Carga procesada"})).toBeVisible();
  await expect(page.getByRole("table",{name:/Existencias/}).locator("tbody tr").filter({hasText:sku})).toContainText("Agotado");
  await page.request.post("/api/auth/logout");
  await login(page,inventoryDemo.staffEmail); await page.goto("/app/inventario");
  await expect(page.getByRole("combobox",{name:"Sucursal",exact:true})).toHaveValue(inventoryDemo.branches[0]);
  await expect(page.getByRole("combobox",{name:"Sucursal",exact:true}).locator(`option[value="${inventoryDemo.branches[1]}"]`)).toHaveCount(0);
  await expect(page.getByText("Configurar sucursales y permisos",{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
