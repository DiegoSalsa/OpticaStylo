import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db/prisma.js";
import { requireAcademicIsolation, ids } from "../tests/fixtures/academic-data.js";
import { isolateBrowserNetwork } from "./isolated-network.js";

test.beforeAll(()=>requireAcademicIsolation());
test.afterAll(async()=>prisma.$disconnect());
test.beforeEach(async({context})=>{
  requireAcademicIsolation();
  // Cada escenario parte de cuotas sintéticas vacías; los límites de producción no cambian.
  await prisma.public_request_rate_limits.deleteMany();
  await isolateBrowserNetwork(context);
});
async function activateClinicalBranch(page) {
  const response = await page.request.patch("/api/auth/me", { data: { branchId: ids.branch } });
  expect(response.ok()).toBe(true);
}
async function login(page,profile) {
  const {password}=JSON.parse(await readFile("tmp/academic-validation/demo-credentials.json","utf8"));
  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico",{exact:true}).fill(`academic-${profile}@example.invalid`);
  await page.getByLabel("Contraseña",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Ingresar de forma segura",exact:true}).click();
  await expect(page).toHaveURL(/\/app$/);
}

for (const [device, viewport] of [
  ["escritorio", { width: 1440, height: 1000 }],
  ["móvil", { width: 390, height: 844 }],
]) {
  test.describe(`Navegación Clientes en ${device}`, () => {
    test.use({ viewport, isMobile: device === "móvil", hasTouch: device === "móvil" });

    for (const profile of ["administrador", "ventas"]) {
      test(`${profile} entra desde el menú, consulta la ficha y vuelve al panel`, async ({ page }) => {
        await login(page, profile);
        const navigation = page.getByRole("navigation", { name: "Navegación interna" });
        const customers = navigation.getByRole("link", { name: "Clientes", exact: true });
        await expect(customers).toHaveAttribute("href", "/app/clientes");
        await customers.click();
        await expect(page).toHaveURL(/\/app\/clientes$/);
        await expect(customers).toHaveAttribute("aria-current", "page");
        await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
        await page.getByRole("button", { name: /ClienteFicticio/ }).click();
        await expect(page.getByRole("heading", { name: "ClienteFicticio Demostración", exact: true })).toBeVisible();

        const dashboard = navigation.getByRole("link", { name: "Dashboard", exact: true });
        await dashboard.click();
        await expect(page).toHaveURL(/\/app$/);
        await expect(dashboard).toHaveAttribute("aria-current", "page");
        await page.goBack();
        await expect(page).toHaveURL(/\/app\/clientes$/);
        await expect(customers).toHaveAttribute("aria-current", "page");
      });
    }

    test("el profesional no ve Clientes ni puede acceder por URL o API", async ({ page }) => {
      await login(page, "profesional");
      const navigation = page.getByRole("navigation", { name: "Navegación interna" });
      await expect(navigation.getByRole("link", { name: "Clientes", exact: true })).toHaveCount(0);

      await page.goto("/app/clientes");
      await expect(page.getByRole("heading", { name: "Acceso no disponible" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toHaveCount(0);

      for (const endpoint of ["/api/customers", "/api/customers/" + ids.customer]) {
        const response = await page.request.get(endpoint);
        expect(response.status()).toBe(403);
        expect((await response.json()).error.code).toBe("INSUFFICIENT_PERMISSIONS");
      }
    });
  });
}

test("Navegación Clientes sin sesión devuelve al ingreso y protege la API", async ({ page }) => {
  await page.goto("/app/clientes");
  await expect(page).toHaveURL(/\/ingresar\?next=%2Fapp%2Fclientes$/);
  const response = await page.request.get("/api/customers");
  expect(response.status()).toBe(401);
});

const navigationViewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
];

test.describe("Accesos Pacientes", () => {
  for (const viewport of navigationViewports) {
    test.describe(`${viewport.width} px`, () => {
      test.use({ viewport, hasTouch: viewport.width < 1000 });

      for (const [profile, canManage] of [
        ["administrador", true],
        ["ventas", true],
        ["profesional", false],
      ]) {
        test(`${profile} navega a Pacientes con los permisos de su rol`, async ({ page }) => {
          await login(page, profile);
          const navigation = page.getByRole("navigation", { name: "Navegación interna" });
          const patients = navigation.getByRole("link", { name: "Pacientes", exact: true });
          await expect(patients).toHaveAttribute("href", "/app/pacientes");
          await patients.click();
          await expect(page).toHaveURL(/\/app\/pacientes$/);
          await expect(patients).toHaveAttribute("aria-current", "page");
          await expect(page.getByRole("heading", { name: "Pacientes", exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "Nuevo paciente", exact: true })).toHaveCount(canManage ? 1 : 0);

          const detail = await page.request.get("/api/patients/" + ids.patient);
          expect(detail.status()).toBe(200);
          expect((await detail.json()).data.id).toBe(ids.patient);

          const write = await page.request.post("/api/patients", {
            headers: { Origin: new URL(page.url()).origin },
            data: {},
          });
          expect(write.status()).toBe(canManage ? 400 : 403);
          if (!canManage) expect((await write.json()).error.code).toBe("INSUFFICIENT_PERMISSIONS");
        });
      }
    });
  }
});

test.describe("Accesos Agenda del panel", () => {
  for (const viewport of navigationViewports) {
    test.describe(`${viewport.width} px`, () => {
      test.use({ viewport, hasTouch: viewport.width < 1000 });

      for (const [profile, canRead] of [
        ["administrador", true],
        ["ventas", false],
        ["profesional", true],
      ]) {
        test(`${profile} ve el enlace de Agenda solo con permiso de lectura`, async ({ page }) => {
          await login(page, profile);
          await expect(page.getByRole("heading", { name: "Atenciones de hoy" })).toBeVisible();
          const agenda = page.getByRole("link", { name: "Ver agenda", exact: true });
          if (canRead) {
            await expect(agenda).toHaveAttribute("href", "/app/agenda");
            await agenda.click();
            await expect(page).toHaveURL(/\/app\/agenda$/);
            await expect(page.getByRole("heading", { name: "Agenda", exact: true })).toBeVisible();
          } else {
            await expect(agenda).toHaveCount(0);
            await page.goto("/app/agenda");
            await expect(page.getByRole("heading", { name: "Acceso no disponible" })).toBeVisible();
          }

          const response = await page.request.get("/api/professionals");
          expect(response.status()).toBe(canRead ? 200 : 403);
          if (!canRead) expect((await response.json()).error.code).toBe("INSUFFICIENT_PERMISSIONS");
        });
      }
    });
  }
});

test.describe("Agenda recuperable", () => {
  for (const profile of ["administrador", "profesional"]) {
    test(profile + " conserva Agenda cuando se cancela la lectura de profesionales", async ({ page }) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await login(page, profile);
      const nav = page.getByRole("navigation", { name: "Navegación interna" });
      const agenda = page.getByRole("heading", { name: "Agenda", exact: true });
      await expect(nav).toBeVisible();

      for (let visit = 0; visit < 3; visit += 1) {
        // Demorar el cuerpo del primer HTTP 200 hasta que el cambio de sesión cancele la consulta.
        await page.evaluate(() => {
          const originalFetch = window.fetch;
          window.fetch = async (resource, options) => {
            const response = await originalFetch(resource, options);
            if (resource !== "/api/professionals") return response;
            window.fetch = originalFetch;
            const { signal } = options;
            return new Response(new ReadableStream({
              start(controller) {
                if (signal.aborted) controller.error(signal.reason);
                else signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
              },
              pull() {
                console.debug("agenda: cuerpo pendiente");
              },
            }), { status: response.status, headers: response.headers });
          };
        });
        const reading = page.waitForEvent("console", (message) => message.text() === "agenda: cuerpo pendiente");
        await page.route("**/api/auth/me", async (route) => {
          await reading;
          await route.continue();
        }, { times: 1 });
        await nav.getByRole("link", { name: "Agenda", exact: true }).click();
        await reading;
        await expect(page.locator(".agenda-toolbar select").first().locator("option")).toHaveCount(2);
        await expect(agenda).toBeVisible();
        const refreshedSession = page.waitForResponse("**/api/auth/me");
        await nav.getByRole("link", { name: "Pacientes", exact: true }).click();
        await refreshedSession;
        await expect(page.getByRole("heading", { name: "Pacientes", exact: true })).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  }

  test("distingue un listado inválido de uno vacío y permite reintentar tras un 503", async ({ page }) => {
    await login(page, "administrador");
    const nav = page.getByRole("navigation", { name: "Navegación interna" });
    const agenda = page.getByRole("heading", { name: "Agenda", exact: true });
    const professionalsUrl = "**/api/professionals";
    const alert = page.getByRole("main").getByRole("alert");
    const malformed = (route) => route.fulfill({ json: { success: true, data: {} } });
    await page.route(professionalsUrl, malformed);
    await page.goto("/app/agenda");
    await expect(agenda).toBeVisible();
    await expect(nav).toBeVisible();
    await expect(alert).toContainText("profesionales");
    await expect(page.getByText("No hay profesionales disponibles.")).toHaveCount(0);
    await page.unroute(professionalsUrl, malformed);
    await page.route(professionalsUrl, (route) => route.fulfill({
      status: 503,
      json: { success: false, error: { message: "Profesionales temporalmente no disponibles." } },
    }), { times: 1 });
    await page.getByRole("button", { name: "Actualizar", exact: true }).click();
    await expect(alert).toContainText("temporalmente no disponibles");
    await page.route(professionalsUrl, (route) => route.fulfill({
      json: { success: true, data: [] },
    }), { times: 1 });
    await page.getByRole("button", { name: "Actualizar", exact: true }).click();
    await expect(page.getByText("No hay profesionales disponibles.")).toBeVisible();
    await expect(alert).toHaveCount(0);
    await page.getByRole("button", { name: "Actualizar", exact: true }).click();
    await expect(page.locator(".agenda-toolbar select").first().locator("option")).toHaveCount(2);
  });

  test("descarta una carga anterior al cambiar de profesional y guarda el horario seleccionado", async ({ page }) => {
    await login(page, "administrador");
    await activateClinicalBranch(page);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/app/agenda");
    const professional = page.locator(".agenda-toolbar select").first();
    const save = page.getByRole("button", { name: "Guardar horario" });
    await expect(save).toBeEnabled();
    const current = await professional.inputValue();
    const other = current === ids.professional ? ids.otherProfessional : ids.professional;
    const scheduleUrl = `**/api/professionals/${current}/schedule`;
    const alert = page.getByRole("main").getByRole("alert");
    const update = page.getByRole("button", { name: "Actualizar", exact: true });
    await page.route(scheduleUrl, (route) => route.fulfill({
      json: { success: true, data: [null] },
    }), { times: 1 });
    await update.click();
    await expect(alert).toContainText("horario semanal");
    await expect(save).toBeDisabled();
    await update.click();
    await expect(save).toBeEnabled();
    let markPending;
    let release;
    const pending = new Promise((resolve) => { markPending = resolve; });
    const resume = new Promise((resolve) => { release = resolve; });
    await page.route(scheduleUrl, async (route) => {
      markPending();
      await resume;
      await route.fulfill({ status: 503, json: { success: false } });
    }, { times: 1 });
    await update.click();
    await pending;
    try {
      await expect(page.getByText("Cargando agenda…").first()).toBeVisible();
      await expect(save).toBeDisabled();
      await professional.selectOption(other);
      await expect(save).toBeEnabled();
    } finally {
      release();
    }
    await expect(alert).toHaveCount(0);
    const morning = page.getByLabel("Lunes inicio", { exact: true });
    const oldHour = await morning.inputValue();
    const newHour = oldHour === "09:20" ? "09:00" : "09:20";
    await morning.fill(newHour);
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/professionals/" + other + "/schedule") && response.request().method() === "PUT");
    await save.click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByText("Horario semanal guardado.")).toBeVisible();
    await page.reload();
    await expect(professional.locator("option")).toHaveCount(2);
    await professional.selectOption(other);
    await expect(save).toBeEnabled();
    await expect(morning).toHaveValue(newHour);
    expect(errors).toEqual([]);
  });
});

test.describe("Accesos Configuración logística", () => {
  for (const viewport of navigationViewports) {
    test.describe(`${viewport.width} px`, () => {
      test.use({ viewport, hasTouch: viewport.width < 1000 });

      test("administrador abre Configuración logística y recupera un error de carga", async ({ page }) => {
        await login(page, "administrador");
        await page.goto("/app/pedidos");
        let release;
        const pending = new Promise((resolve) => { release = resolve; });
        await page.route("**/api/shipping/settings", async (route) => {
          await pending;
          await route.fulfill({
            status: 503,
            json: { success: false, error: { message: "Servicio temporalmente indisponible." } },
          });
        }, { times: 1 });

        const logistics = page.getByRole("link", { name: "Configuración logística", exact: true });
        try {
          await expect(logistics).toHaveAttribute("href", "/app/pedidos/configuracion-despachos");
          await logistics.click();
          await expect(page.getByRole("status").filter({ hasText: "Cargando configuración de despachos" })).toBeVisible();
          await expect(page.getByRole("button", { name: "Guardar origen", exact: true })).toHaveCount(0);
        } finally {
          release();
        }
        await expect(page.getByRole("alert").filter({ hasText: "Servicio temporalmente indisponible." })).toBeVisible();
        await page.getByRole("button", { name: "Reintentar", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Origen por sucursal", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Guardar origen", exact: true })).toBeEnabled();
        await page.getByRole("link", { name: "Volver a pedidos", exact: true }).click();
        await expect(page).toHaveURL(/\/app\/pedidos$/);
      });

      for (const profile of ["ventas", "profesional"]) {
        test(`${profile} no accede a Configuración logística desde el tablero, URL o API`, async ({ page }) => {
          await login(page, profile);
          await page.goto("/app/pedidos");
          const ordersHeading = profile === "ventas" ? "Gestión de pedidos" : "Acceso no disponible";
          await expect(page.getByRole("heading", { name: ordersHeading, exact: true })).toBeVisible();
          await expect(page.getByRole("link", { name: "Configuración logística", exact: true })).toHaveCount(0);

          let settingsRequests = 0;
          page.on("request", (request) => {
            if (new URL(request.url()).pathname === "/api/shipping/settings") settingsRequests++;
          });
          await page.goto("/app/pedidos/configuracion-despachos");
          await expect(page.getByRole("alert").filter({ hasText: "No tienes permisos para configurar despachos." })).toBeVisible();
          await expect(page.getByRole("button", { name: "Guardar origen", exact: true })).toHaveCount(0);
          expect(settingsRequests).toBe(0);

          const read = await page.request.get("/api/shipping/settings");
          const write = await page.request.post("/api/shipping/settings", {
            headers: { Origin: new URL(page.url()).origin },
            data: {},
          });
          for (const response of [read, write]) {
            expect(response.status()).toBe(403);
            expect((await response.json()).error.code).toBe("INSUFFICIENT_PERMISSIONS");
          }
        });
      }
    });
  }

  test("el administrador guarda un embalaje sintético y una denegación oculta el formulario", async ({ page }) => {
    await login(page, "administrador");
    await page.goto("/app/pedidos/configuracion-despachos");
    const packaging = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Embalajes aprobados", exact: true }),
    });
    for (const [label, value] of [
      ["Código de embalaje", "ACCESO-DEMO"],
      ["Peso del embalaje vacío (kg)", "0.5"],
      ["Alto (cm)", "10"],
      ["Ancho (cm)", "10"],
      ["Largo (cm)", "20"],
      ["Capacidad máxima de unidades", "2"],
    ]) {
      await packaging.getByLabel(label, { exact: true }).fill(value);
    }
    await packaging.getByRole("checkbox").check();
    const save = packaging.getByRole("button", { name: "Guardar embalaje", exact: true });
    await save.click();
    await expect(page.getByRole("status").filter({ hasText: "Configuración guardada." })).toBeVisible();
    await expect(packaging.getByText(/ACCESO-DEMO/)).toBeVisible();

    await page.route("**/api/shipping/settings", (route) => route.fulfill({
      status: 403,
      json: { success: false, error: { code: "INSUFFICIENT_PERMISSIONS" } },
    }), { times: 1 });
    await save.click();
    await expect(page.getByRole("alert").filter({ hasText: "No tienes permisos para configurar despachos." })).toBeVisible();
    await expect(save).toHaveCount(0);
  });

  test("una denegación de la API se muestra como acceso restringido", async ({ page }) => {
    await login(page, "administrador");
    await page.route("**/api/shipping/settings", (route) => route.fulfill({
      status: 403,
      json: { success: false, error: { code: "INSUFFICIENT_PERMISSIONS" } },
    }));
    await page.goto("/app/pedidos/configuracion-despachos");
    await expect(page.getByRole("alert").filter({ hasText: "No tienes permisos para configurar despachos." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Guardar origen", exact: true })).toHaveCount(0);
  });
});

test("E2E-AG agenda crea una reserva en disponibilidad real y conserva paciente/profesional",async({page})=>{
  await login(page,"administrador");
  await activateClinicalBranch(page);
  await page.goto("/app/agenda");
  const form=page.locator(".internal-booking");
  await form.getByPlaceholder("RUT o nombre",{exact:true}).fill("PacienteFicticio");
  await form.getByRole("button",{name:"Buscar",exact:true}).click();
  await form.getByRole("combobox",{name:/^Paciente/}).selectOption(ids.patient);
  await form.getByRole("combobox",{name:/^Profesional/}).selectOption(ids.professional);
  const {created}=JSON.parse(await readFile("tmp/academic-validation/demo-records.json","utf8"));
  await form.getByLabel("Fecha",{exact:true}).fill(created[0].date);
  const available=form.getByRole("combobox",{name:/^Hora disponible/});
  await expect(available.locator("option")).not.toHaveCount(1);
  const startAt=await available.locator("option").nth(1).getAttribute("value");
  await available.selectOption(startAt);
  await form.getByLabel("Notas internas opcionales").fill("Reserva creada mediante navegador con datos ficticios.");
  await form.getByRole("button",{name:"Crear reserva",exact:true}).click();
  await expect.poll(async()=>prisma.appointments.count({where:{professional_id:ids.professional,patient_id:ids.patient,start_at:new Date(startAt)}})).toBe(1);
  await expect(available.locator(`option[value="${startAt}"]`)).toHaveCount(0);
});

test("E2E-CL profesional inicia, guarda, emite receta, finaliza y agrega adenda desde la interfaz",async({page})=>{
  await login(page,"profesional");
  const {created}=JSON.parse(await readFile("tmp/academic-validation/demo-records.json","utf8"));
  const appointmentId=created[1].appointmentId;
  await page.goto(`/app/ficha-clinica?appointmentId=${appointmentId}`);
  await page.getByRole("button",{name:"Marcar presente",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Paciente marcado presente");
  await page.getByRole("combobox",{name:"Tipo de ficha",exact:true}).selectOption("GENERAL");
  await page.getByRole("textbox",{name:"Motivo inicial",exact:true}).fill("Motivo ficticio de prueba E2E");
  await page.getByRole("button",{name:"Crear borrador clínico",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Borrador creado");
  await page.getByText("Antecedentes permanentes del paciente", { exact: true }).click();
  await page.getByRole("textbox",{name:"Antecedentes médicos generales",exact:true}).fill(`DEMO FICTICIA, ejercicio de la atención ${created[1].time}.`);
  await page.getByRole("button",{name:"Guardar antecedentes",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Antecedentes guardados y auditados");
  await page.getByRole("textbox",{name:"Examen",exact:true}).fill("Examen sintético para verificar el software.");
  await page.getByRole("textbox",{name:"Diagnóstico",exact:true}).fill("Diagnóstico ficticio E2E, sin uso asistencial.");
  await page.getByRole("button",{name:"Guardar borrador",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Borrador guardado con una nueva versión");
  await page.getByText("Prescripción óptica · emisión profesional explícita", { exact: true }).click();
  for(const [label,value] of [["OD sphere","-1"],["OD cylinder","-0.5"],["OD axis","90"],["OI sphere","-1.25"],["OI cylinder","0"],["Distancia pupilar","62"],["Notas de fabricación","RECETA FICTICIA, sin validez clínica."]]) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole("button",{name:"Emitir receta",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Prescripción óptica guardada");
  page.once("dialog",(dialog)=>dialog.accept());
  await page.getByRole("button",{name:"Finalizar atención",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Atención finalizada");
  await expect(page.getByRole("textbox",{name:"Diagnóstico",exact:true})).toBeDisabled();
  await page.getByRole("textbox",{name:"Motivo de la adenda",exact:true}).fill("Aclaración ficticia de prueba");
  await page.getByRole("textbox",{name:"Contenido de la adenda",exact:true}).fill("Adenda sintética conservada sin alterar el diagnóstico.");
  await page.getByRole("button",{name:"Agregar adenda",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Adenda permanente guardada");
  const encounter=await prisma.clinical_encounters.findUniqueOrThrow({where:{appointment_id:appointmentId},include:{clinical_encounter_addenda:true,optical_prescriptions:true}});
  expect(encounter).toMatchObject({ status: "FINALIZED", branch_id: ids.branch });
  expect(encounter.clinical_encounter_addenda).toHaveLength(1);
  expect(encounter.optical_prescriptions).toHaveLength(1);
  await page.reload();
  await page.getByRole("button",{name:new RegExp("Finalizada · Ficha " + encounter.record_number + "$")}).click();
  await expect(page.getByText("Aclaración ficticia de prueba",{exact:true})).toBeVisible();
});

test("E2E-SEG ADMIN ve restricción clínica y profesional ajeno no ve la atención del otro",async({page,context})=>{
  await login(page,"administrador");
  await page.goto("/app/ficha-clinica");
  await expect(page.getByRole("heading",{name:"Acceso clínico restringido",exact:true})).toBeVisible();
  await context.clearCookies();
  await login(page,"profesionalajeno");
  await page.goto("/app/ficha-clinica");
  await expect(page.getByText("No hay pacientes en esta búsqueda autorizada.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:/PacienteFicticio|PacienteAjeno/})).toHaveCount(0);
  const {created}=JSON.parse(await readFile("tmp/academic-validation/demo-records.json","utf8"));
  expect((await page.request.get("/api/appointments/" + created[1].appointmentId)).status()).toBe(404);
});

test("E2E-POS cotización, cantidades, venta y abonos manuales conservan importes/comprobante sin proveedores",async({page})=>{
  await login(page,"ventas");
  await activateClinicalBranch(page);
  await prisma.products.update({ where: { sku: "ESTUCHE-TEST" }, data: { inventory_mode: "ON_DEMAND" } });
  const terminal = await prisma.cash_register_terminals.create({ data: { branch_id: ids.branch, name: "Caja sintética POS " + randomUUID().slice(0, 8) } });
  const opened = await page.request.post("/api/cash-register", { data: { branchId: ids.branch, terminalId: terminal.id, openingAmountCents: 5000 } });
  expect(opened.status()).toBe(201);
  await page.goto("/app/ventas");
  await page.getByLabel("Ingresar SKU con escáner",{exact:true}).fill("ESTUCHE-TEST");
  await page.getByLabel("Ingresar SKU con escáner",{exact:true}).press("Enter");
  await expect(page.locator(".ticket-line")).toHaveCount(1);
  await page.getByRole("button",{name:"Agregar Estuche de prueba",exact:true}).click();
  await page.getByRole("button",{name:"Crear cotización",exact:true}).click();
  await expect(page.locator(".pos-ticket .status-chip").first()).toHaveText("QUOTATION");
  const saleNumber=Number((await page.locator(".ticket-head h2").innerText()).match(/\d+/)[0]);
  const initial=await prisma.sales.findUnique({where:{sale_number:BigInt(saleNumber)}});
  expect(Number(initial.total_cents)).toBe(10000);
  await page.getByRole("button",{name:"Confirmar y cobrar",exact:true}).click();
  await expect(page.getByRole("heading",{name:/Cobrar venta · Saldo/})).toBeVisible();
  await page.getByLabel("Importe del pago 1",{exact:true}).fill("4000");
  await page.getByRole("combobox",{name:"Medio de pago 1",exact:true}).selectOption("BANK_TRANSFER");
  await page.getByLabel("Referencia o folio 1",{exact:true}).fill("TRANSFERENCIA FICTICIA E2E");
  await page.getByRole("button",{name:"Confirmar cobro",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Pagos recibidos",exact:true})).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Abono registrado y comprobante emitido");
  await expect.poll(async()=>Number((await prisma.sales.findUnique({where:{id:initial.id},include:{sale_payments:true}})).sale_payments.reduce((sum,row)=>sum+Number(row.amount_cents),0))).toBe(4000);
  await page.getByLabel("Importe del pago 1",{exact:true}).fill("6000");
  await page.getByRole("combobox",{name:"Medio de pago 1",exact:true}).selectOption("BANK_TRANSFER");
  await page.getByLabel("Referencia o folio 1",{exact:true}).fill("SALDO FICTICIO E2E");
  await page.getByRole("button",{name:"Confirmar cobro",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Venta pagada y comprobante emitido");
  await expect(page.locator(".pos-ticket .status-chip").first()).toHaveText("PAID");
  await expect(page.getByRole("link",{name:"Abrir comprobante",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Emitir comprobante final",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Comprobante");
  const final=await prisma.sales.findUnique({where:{id:initial.id},include:{sale_payments:true,sale_receipts:true}});
  expect(final.sale_payments).toHaveLength(2);expect(final.sale_receipts.some((row)=>row.receipt_type==="FINAL")).toBe(true);
  expect(await prisma.transactional_email_outbox.count({where:{sale_id:initial.id,status:"SENT"}})).toBe(0);
});
