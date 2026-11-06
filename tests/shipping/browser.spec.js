import { test, expect } from "@playwright/test";
import { prisma } from "../../src/db/prisma.js";
import { evaluation } from "../evaluation-data.js";
import { buyer } from "../prescriptions/helpers.js";
import { branch, product, syntheticPayment } from "./helpers.js";

async function value(r,status=200){expect(r.status(),await r.text()).toBe(status);return (await r.json()).data;}
async function start(page,price=79990){
  await prisma.public_request_rate_limits.deleteMany();
  const productId=await product(price),cart=await value(await page.request.post("/api/store/cart"),201);
  await value(await page.request.post("/api/store/cart/items",{data:{items:[{productId,quantity:1}]}}));
  await page.goto("/carrito");await expect(page.getByRole("heading",{name:"Datos para la compra"})).toBeVisible();
  return {productId,cart};
}
async function buyerForm(page){
  for(const [name,key] of [["RUT","rut"],["Nombres","firstNames"],["Apellidos","lastNames"],["Teléfono","phone"],["Correo","email"],["Dirección de contacto","address"]])await page.getByLabel(name,{exact:true}).fill(buyer[key]);
}
async function shippingForm(page){
  await page.getByRole("radio",{name:"Despacho Chilexpress",exact:true}).check();
  await page.getByRole("combobox",{name:"Región de destino",exact:true}).selectOption("TEST-RM");
  await page.getByRole("combobox",{name:"Comuna de destino",exact:true}).selectOption("TEST-DEST");
  await page.getByLabel("Calle de destino",{exact:true}).fill("Calle sintética");
  await page.getByLabel("Número de destino",{exact:true}).fill("123");
  await page.getByRole("button",{name:"Verificar dirección y cotizar",exact:true}).click();
  await expect(page.getByText("Dirección verificada. Selecciona el servicio de despacho.")).toBeVisible();
}
async function checkout(page,cart){
  await buyerForm(page);await page.getByRole("button",{name:"Continuar a Mercado Pago",exact:true}).click();
  await expect(page).toHaveURL(/\/checkout\/mercado-pago\/pending\?orderId=/);
  const stored=await prisma.store_carts.findUniqueOrThrow({where:{id:cart.id}});expect(stored.status).toBe("CHECKED_OUT");
  const sale=await value(await page.request.get(`/api/store/orders/${stored.sale_id}`));return sale;
}
test.afterAll(async()=>{await prisma.$disconnect();});

test("Checkout con despacho normal conserva tarifa, dirección y origen al recargar",async({page})=>{
  const {cart}=await start(page);await shippingForm(page);await expect(page.locator(".cart-summary")).toContainText("4.990");
  const sale=await checkout(page,cart);expect(sale.shippingFeeCents).toBe(4990);expect(sale.totalCents).toBe(84980);expect(sale.branch.id).toBe(branch);
  await page.reload();await expect(page.getByRole("heading",{name:"Despacho Chilexpress"})).toBeVisible();expect((await prisma.sales.findUnique({where:{id:sale.id}})).delivery_address).toContain("Calle sintética 123");
});
test("Envío gratuito sobre $100.000 conserva el costo interno del proveedor",async({page})=>{
  const {cart}=await start(page,100001);await shippingForm(page);await expect(page.locator(".cart-summary")).toContainText("Gratis");
  const sale=await checkout(page,cart);expect(sale.shippingFeeCents).toBe(0);expect(sale.totalCents).toBe(100001);
  const shipment=await prisma.shipping_shipments.findUniqueOrThrow({where:{sale_id:sale.id},include:{quote:true}});expect(Number(shipment.quote.provider_cost)).toBe(4990);expect(Number(shipment.quote.customer_charge)).toBe(0);
});
test("Checkout con retiro mantiene local elegido, reserva y consulta posterior",async({page})=>{
  const {cart,productId}=await start(page);await page.getByRole("combobox",{name:"Sucursal de retiro",exact:true}).selectOption(branch);const sale=await checkout(page,cart);
  expect(sale.fulfillment.method).toBe("PICKUP");expect(sale.branch.id).toBe(branch);expect(sale.shippingFeeCents).toBe(0);
  const held=await prisma.inventory_reservations.findUniqueOrThrow({where:{sale_id_product_id:{sale_id:sale.id,product_id:productId}}});expect(held.status).toBe("HELD");await page.reload();await expect(page.getByText("Sucursal sintética A",{exact:false})).toBeVisible();
});
test("Dirección inválida y destino sin cobertura impiden obtener tarifa",async({page})=>{
  await start(page);await page.getByRole("radio",{name:"Despacho Chilexpress",exact:true}).check();await page.getByRole("combobox",{name:"Región de destino",exact:true}).selectOption("TEST-RM");await page.getByRole("combobox",{name:"Comuna de destino",exact:true}).selectOption("TEST-NONE");
  await page.getByLabel("Calle de destino",{exact:true}).fill("Calle sintética");await page.getByLabel("Número de destino",{exact:true}).fill("123");await page.getByRole("button",{name:"Verificar dirección y cotizar",exact:true}).click();await expect(page.locator(".shipping-choice").getByRole("alert")).toContainText("sin cobertura");
  await page.getByRole("combobox",{name:"Comuna de destino",exact:true}).selectOption("TEST-DEST");await page.getByLabel("Número de destino",{exact:true}).fill("0");await page.getByRole("button",{name:"Verificar dirección y cotizar",exact:true}).click();await expect(page.locator(".shipping-choice").getByRole("alert")).toContainText("inválida");await expect(page.locator(".cart-summary")).toContainText("Pendiente de cotizar");
});
test("Administración prepara, emite OT, recupera etiqueta y consulta seguimiento privado",async({page})=>{
  const {cart,productId}=await start(page);await shippingForm(page);const sale=await checkout(page,cart);await syntheticPayment(sale);
  await value(await page.request.post("/api/auth/login",{data:{email:evaluation.adminEmail,password:evaluation.password}}));await page.goto("/app/pedidos");await page.getByRole("textbox",{name:"Buscar pedido",exact:true}).fill(String(sale.saleNumber));await page.getByRole("button",{name:"Buscar",exact:true}).click();
  await page.getByRole("button",{name:"Ver detalle",exact:true}).click();const panel=page.getByRole("region",{name:"Seguimiento del despacho",exact:true});
  await panel.getByLabel("Referencia de preparación o comprobante de recepción",{exact:true}).fill("Bulto sintético inspeccionado UI");await panel.getByRole("button",{name:"Confirmar preparación",exact:true}).click();await expect(panel.getByRole("button",{name:"Generar OT",exact:true})).toBeVisible();await panel.getByRole("button",{name:"Generar OT",exact:true}).click();
  const label=panel.getByRole("link",{name:"Obtener / imprimir etiqueta de prueba",exact:true});await expect(label).toBeVisible();const popup=page.waitForEvent("popup");await label.click();const labelPage=await popup;await expect(labelPage.getByText("PRUEBA SINTÉTICA · NO VÁLIDA PARA TRANSPORTE",{exact:true})).toBeVisible();await labelPage.close();
  await panel.getByLabel("Referencia de preparación o comprobante de recepción",{exact:true}).fill("Comprobante transportista SINTÉTICO UI");await panel.getByRole("button",{name:"Registrar entrega al transportista",exact:true}).click();await expect(panel.getByText("Entregado al transportista",{exact:true})).toBeVisible();await panel.getByRole("button",{name:"Actualizar seguimiento",exact:true}).click();await expect(panel.getByText("En tránsito",{exact:true})).toBeVisible();
  expect(await prisma.inventory_movements.count({where:{sale_id:sale.id,product_id:productId,kind:"SALE"}})).toBe(1);
  await page.goto(`/checkout/mercado-pago/pending?orderId=${sale.id}`);await expect(page.getByRole("region",{name:"Seguimiento del despacho",exact:true})).toContainText("En tránsito SINTÉTICO");
});
