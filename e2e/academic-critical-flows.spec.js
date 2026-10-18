import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/db/prisma.js";
import { requireAcademicIsolation, ids } from "../tests/fixtures/academic-data.js";
import { isolateBrowserNetwork } from "./isolated-network.js";

test.beforeAll(()=>requireAcademicIsolation());
test.afterAll(async()=>prisma.$disconnect());
test.beforeEach(async({context})=>isolateBrowserNetwork(context));
async function login(page,profile) {
  const {password}=JSON.parse(await readFile("tmp/academic-validation/demo-credentials.json","utf8"));
  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico",{exact:true}).fill(`academic-${profile}@example.invalid`);
  await page.getByLabel("Contraseña",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Ingresar de forma segura",exact:true}).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("E2E-AG agenda crea una reserva en disponibilidad real y conserva paciente/profesional",async({page})=>{
  await login(page,"administrador");
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
  await page.getByRole("button",{name:"Marcar presente e iniciar",exact:true}).click();
  await page.getByRole("textbox",{name:"Motivo de consulta",exact:true}).fill("Motivo ficticio de prueba E2E");
  await page.getByRole("button",{name:"Crear borrador clínico",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Atención clínica iniciada");
  await page.getByRole("textbox",{name:"Antecedentes médicos generales",exact:true}).fill(`DEMO FICTICIA, ejercicio de la atención ${created[1].time}.`);
  await page.getByRole("button",{name:"Guardar antecedentes",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Antecedentes actualizados");
  await page.getByRole("textbox",{name:"Examen",exact:true}).fill("Examen sintético para verificar el software.");
  await page.getByRole("textbox",{name:"Diagnóstico",exact:true}).fill("Diagnóstico ficticio E2E, sin uso asistencial.");
  await page.getByRole("button",{name:"Guardar borrador",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Borrador clínico guardado");
  for(const [label,value] of [["OD sphere","-1"],["OD cylinder","-0.5"],["OD axis","90"],["OI sphere","-1.25"],["OI cylinder","0"],["Distancia pupilar","62"],["Notas de fabricación","RECETA FICTICIA, sin validez clínica."]]) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole("button",{name:"Emitir receta",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Receta óptica emitida");
  page.once("dialog",(dialog)=>dialog.accept());
  await page.getByRole("button",{name:"Finalizar atención",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Atención finalizada");
  await expect(page.getByRole("textbox",{name:"Diagnóstico",exact:true})).toBeDisabled();
  await page.getByRole("textbox",{name:"Motivo de la adenda",exact:true}).fill("Aclaración ficticia de prueba");
  await page.getByRole("textbox",{name:"Contenido",exact:true}).fill("Adenda sintética conservada sin alterar el diagnóstico.");
  await page.getByRole("button",{name:"Agregar adenda",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Adenda permanente agregada");
  await page.reload();
  await expect(page.getByText("Aclaración ficticia de prueba",{exact:true}).first()).toBeVisible();
  const encounter=await prisma.clinical_encounters.findUnique({where:{appointment_id:appointmentId},include:{clinical_encounter_addenda:true,optical_prescriptions:true}});
  expect(encounter.status).toBe("FINALIZED");expect(encounter.clinical_encounter_addenda).toHaveLength(1);expect(encounter.optical_prescriptions).toHaveLength(1);
});

test("E2E-SEG ADMIN ve restricción clínica y profesional ajeno no ve la atención del otro",async({page,context})=>{
  await login(page,"administrador");
  await page.goto("/app/ficha-clinica");
  await expect(page.getByRole("heading",{name:"Acceso clínico restringido",exact:true})).toBeVisible();
  await context.clearCookies();
  await login(page,"profesionalajeno");
  await page.goto("/app/ficha-clinica");
  await expect(page.getByText("No hay atenciones en el periodo.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:/PacienteFicticio|PacienteAjeno/})).toHaveCount(0);
});

test("E2E-POS cotización, cantidades, venta y abonos manuales conservan importes/comprobante sin proveedores",async({page})=>{
  await login(page,"ventas");
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
  await expect(page.getByRole("heading",{name:"Registrar abono manual",exact:true})).toBeVisible();
  await expect(page.getByText("Pendiente de configuración comercial",{exact:true})).toBeVisible();
  await page.locator('input[name="amountCents"]').fill("4000");
  await page.locator('select[name="paymentMethod"]').selectOption("BANK_TRANSFER");
  await page.getByLabel("Referencia o folio obligatorio",{exact:true}).fill("TRANSFERENCIA FICTICIA E2E");
  await page.getByRole("button",{name:"Registrar abono",exact:true}).click();
  await expect(page.getByText("Abono 1",{exact:true})).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Abono registrado y comprobante emitido");
  await expect.poll(async()=>Number((await prisma.sales.findUnique({where:{id:initial.id},include:{sale_payments:true}})).sale_payments.reduce((sum,row)=>sum+Number(row.amount_cents),0))).toBe(4000);
  await page.locator('input[name="amountCents"]').fill("6000");
  await page.getByLabel("Referencia o folio obligatorio",{exact:true}).fill("SALDO FICTICIO E2E");
  await page.getByRole("button",{name:"Registrar abono",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Venta pagada y comprobante emitido");
  await expect(page.locator(".pos-ticket .status-chip").first()).toHaveText("PAID");
  await expect(page.getByRole("link",{name:"Abrir comprobante",exact:true})).toBeVisible();
  const final=await prisma.sales.findUnique({where:{id:initial.id},include:{sale_payments:true,sale_receipts:true}});
  expect(final.sale_payments).toHaveLength(2);expect(final.sale_receipts.some((row)=>row.receipt_type==="FINAL")).toBe(true);
  expect(await prisma.transactional_email_outbox.count({where:{sale_id:initial.id,status:"SENT"}})).toBe(0);
});
