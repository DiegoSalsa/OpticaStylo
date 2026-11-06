import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {database,ids,prescription} from "../prescriptions/helpers.js";
import {evaluation} from "../evaluation-data.js";
import {inventoryDemo} from "../inventory/data.js";
const branchId=inventoryDemo.branches[0];
test.beforeEach(async()=>{const db=database();try{await db.public_request_rate_limits.deleteMany();}finally{await db.$disconnect();}});
async function login(page,email=evaluation.adminEmail){await page.goto("/ingresar");await page.getByLabel("Correo electrónico",{exact:true}).fill(email);await page.getByLabel("Contraseña",{exact:true}).fill(evaluation.password);await page.getByRole("button",{name:"Ingresar de forma segura",exact:true}).click();await expect(page).toHaveURL(/\/app$/);}
async function open(page){
  const name=`Caja navegador ${randomUUID()}`;
  const result=await page.request.post("/api/cash-register/terminals",{data:{branchId,name}});expect(result.status()).toBe(201);const terminal=(await result.json()).data;
  await page.goto("/app/ventas");await page.getByRole("combobox",{name:"Sucursal de la venta",exact:true}).selectOption(branchId);
  await page.getByRole("combobox",{name:"Punto de cobro",exact:true}).selectOption(terminal.id);
  await page.getByLabel("Fondo inicial de efectivo",{exact:true}).fill("10000");
  const response=page.waitForResponse((r)=>r.url().endsWith("/api/cash-register")&&r.request().method()==="POST");
  await page.getByRole("button",{name:"Abrir caja",exact:true}).click();const created=await response;expect(created.status()).toBe(201);const session=(await created.json()).data;
  await expect(page.getByRole("status").filter({hasText:"Caja abierta y asociada"})).toBeVisible();return {terminal,name,session};
}
async function search(page,sku){await page.getByRole("textbox",{name:"Buscar productos",exact:true}).fill(sku);const button=page.locator(".product-results button").filter({hasText:sku});await expect(button).toHaveCount(1);return button;}
test("Apertura, pago dividido con vuelto, retiro, arqueo e historial persistente",async({page},info)=>{
  const errors=[];page.on("pageerror",e=>errors.push(e.message));await login(page);const {terminal,name,session}=await open(page);
  const sku=`INV-NAVEGADOR-${info.project.name==="movil"?2:1}`;await(await search(page,sku)).click();
  await page.getByRole("button",{name:"Continuar al cobro",exact:true}).click();await expect(page.getByRole("heading",{name:/Cobrar venta/})).toBeVisible();
  await page.getByLabel("Importe del pago 1",{exact:true}).fill("600");await page.getByLabel("Efectivo recibido 1",{exact:true}).fill("1000");
  await expect(page.getByText(/Vuelto:.*400/)).toBeVisible();await page.getByRole("button",{name:"Dividir pago / agregar medio",exact:true}).click();
  await page.getByRole("combobox",{name:"Medio de pago 2",exact:true}).selectOption("TRANSBANK");await page.getByLabel("Referencia o folio 2",{exact:true}).fill("TERMINAL-SINTETICO-SIN-COBRO-REAL");
  await page.getByRole("button",{name:"Confirmar cobro",exact:true}).click();await expect(page.getByText("Venta pagada. Existencias descontadas de Sucursal sintética A.",{exact:true})).toBeVisible();
  await page.getByText("Ingreso, egreso o retiro de efectivo",{exact:true}).click();await page.getByRole("combobox",{name:"Movimiento",exact:true}).selectOption("WITHDRAWAL");await page.getByLabel("Monto del movimiento",{exact:true}).fill("200");await page.getByLabel("Motivo del movimiento",{exact:true}).fill("Retiro sintético de jornada");await page.getByRole("button",{name:"Registrar movimiento",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Movimiento registrado."})).toBeVisible();
  const summary=(await(await page.request.get(`/api/cash-register/${session.id}`)).json()).data;expect(summary.expectedAmountCents).toBe(10400);expect(summary.electronicPaymentsCents).toBe(400);
  await page.getByText("Cerrar y arquear caja",{exact:true}).click();await page.getByLabel("Efectivo contado al cierre",{exact:true}).fill("10400");await page.getByRole("button",{name:"Confirmar cierre de caja",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Cierre guardado."})).toBeVisible();
  await page.reload();await page.getByRole("combobox",{name:"Sucursal de la venta",exact:true}).selectOption(branchId);await page.getByRole("combobox",{name:"Punto de cobro",exact:true}).selectOption(terminal.id);
  await page.getByText("Historial de aperturas y cierres",{exact:true}).click();await page.locator("tr").filter({hasText:name}).getByRole("button",{name:"Ver cierre",exact:true}).click();await expect(page.getByText(/Caja cerrada · Contado:/)).toContainText("10.400");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test("Cliente comercial, cotización y stock del local; empleado no puede operar caja ajena",async({page})=>{
  await login(page);const {terminal}=await open(page),sku=`POS-UI-${randomUUID()}`.toUpperCase(),productName=`Marco de prueba ${sku}`;
  const created=await page.request.post("/api/products",{data:{sku,name:productName,category:"FRAME",unitPriceCents:1000,requiresPrescription:false}});expect(created.status()).toBe(201);const product=(await created.json()).data;
  const count=await page.request.post("/api/inventory",{headers:{"X-Idempotency-Key":randomUUID()},data:{branchId,productId:product.id,kind:"COUNT",quantity:2,expectedVersion:null,reason:"Conteo sintético del caso de navegador"}});expect(count.status()).toBe(200);
  await page.getByText("Cliente e historial (opcional)",{exact:true}).click();await page.getByRole("button",{name:"+ Crear cliente",exact:true}).click();await page.getByLabel("Nombre",{exact:true}).fill("Comprador POS sintético");await page.getByLabel("Correo opcional",{exact:true}).fill(`pos-ui-${randomUUID()}@example.invalid`);await page.getByRole("button",{name:"Crear y seleccionar",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Cliente creado y seleccionado"})).toBeVisible();await expect(page.getByRole("heading",{name:"Paciente",exact:true})).toHaveCount(0);
  const button=await search(page,sku);await button.click();await button.click();await expect(button).toBeDisabled();await page.getByRole("button",{name:`Quitar ${productName}`,exact:true}).click();
  await page.getByLabel("Descuento manual (CLP)",{exact:true}).fill("100");await page.getByLabel("Motivo obligatorio",{exact:true}).fill("Convenio sintético autorizado");await page.getByLabel("Correo del supervisor",{exact:true}).fill(evaluation.adminEmail);await page.getByLabel("Contraseña del supervisor",{exact:true}).fill(evaluation.password);await page.getByRole("button",{name:"Autorizar descuento",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Descuento autorizado temporalmente"})).toBeVisible();
  const quotedResponse=page.waitForResponse((r)=>r.url().endsWith("/api/sales")&&r.request().method()==="POST");await page.getByRole("button",{name:"Crear cotización",exact:true}).click();const quote=(await(await quotedResponse).json()).data;await expect(page.getByRole("status").filter({hasText:/Cotización N.º.*creada/})).toBeVisible();
  await page.getByRole("button",{name:"Nueva venta",exact:true}).click();await page.getByRole("button",{name:"Cotizaciones",exact:true}).click();await page.locator(".quotation-list article").filter({hasText:`Cotización N.º ${quote.saleNumber} ·`}).getByRole("button",{name:"Cargar para vender",exact:true}).click();await page.getByRole("button",{name:"Confirmar y cobrar",exact:true}).click();
  await page.getByRole("combobox",{name:"Medio de pago 1",exact:true}).selectOption("BANK_TRANSFER");await page.getByLabel("Referencia o folio 1",{exact:true}).fill("TRANSFERENCIA-VERIFICADA-SINTETICA");await page.getByRole("button",{name:"Confirmar cobro",exact:true}).click();await expect(page.getByText("Venta pagada. Existencias descontadas de Sucursal sintética A.",{exact:true})).toBeVisible();
  await page.getByText("Compras anteriores del cliente",{exact:true}).click();await expect(page.getByRole("button",{name:/Ver compra N.º/})).toBeVisible();
  await page.request.post("/api/auth/logout");await login(page,inventoryDemo.staffEmail);await page.goto("/app/ventas");await expect(page.getByRole("combobox",{name:"Sucursal de la venta",exact:true}).locator(`option[value="${inventoryDemo.branches[1]}"]`)).toHaveCount(0);
  await page.getByRole("combobox",{name:"Sucursal de la venta",exact:true}).selectOption(branchId);await page.getByRole("combobox",{name:"Punto de cobro",exact:true}).selectOption(terminal.id);await expect(page.getByRole("alert").filter({hasText:"otro responsable"})).toBeVisible();await expect(page.getByRole("button",{name:"Abrir caja",exact:true})).toHaveCount(0);
});
test("Reabrir una cotización óptica conserva la receta externa y sus valores autorizados",async({page})=>{
  await login(page);const {session}=await open(page);
  const externalResponse=await page.request.post("/api/external-prescriptions",{data:{customerId:evaluation.customerId,patientId:evaluation.patientId,confirmedData:prescription}});expect(externalResponse.status()).toBe(201);const external=(await externalResponse.json()).data;
  const quoteResponse=await page.request.post("/api/sales",{headers:{"X-Idempotency-Key":randomUUID()},data:{operation:"QUOTATION",branchId,cashSessionId:session.id,customerId:evaluation.customerId,patientId:evaluation.patientId,externalPrescriptionId:external.id,items:[{productId:ids.frame,quantity:1},{productId:ids.lens,quantity:1,mount:{source:"SOLD_FRAME",frameProductId:ids.frame}}]}});expect(quoteResponse.status()).toBe(201);const quote=(await quoteResponse.json()).data;
  await page.getByRole("button",{name:"Cotizaciones",exact:true}).click();await page.locator(".quotation-list article").filter({hasText:`Cotización N.º ${quote.saleNumber} ·`}).getByRole("button",{name:"Cargar para vender",exact:true}).click();
  await expect(page.getByLabel("OD sphere",{exact:true})).toHaveValue("-1.25");await expect(page.getByLabel("Distancia pupilar",{exact:true})).toHaveValue("62");const confirmed=page.waitForResponse((r)=>r.url().endsWith(`/api/sales/${quote.id}/confirm`)&&r.request().method()==="POST");await page.getByRole("button",{name:"Confirmar y cobrar",exact:true}).click();expect((await confirmed).status()).toBe(200);
  const persisted=(await(await page.request.get(`/api/sales/${quote.id}`)).json()).data;expect(persisted.status).toBe("PENDING");expect(persisted.externalPrescription.id).toBe(external.id);expect(persisted.patient.id).toBe(evaluation.patientId);
});
