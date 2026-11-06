import { test, expect } from "@playwright/test";
import { prisma } from "../../src/db/prisma.js";
import { evaluation } from "../evaluation-data.js";
import { isolated } from "../shipping/helpers.js";

test.afterAll(async()=>{await prisma.$disconnect();});
test.beforeAll(()=>isolated());
test("Navegación integrada accesible y sin desbordamiento en catálogo, cuenta, inventario, POS y clínica",async({page},info)=>{
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await prisma.public_request_rate_limits.deleteMany();
  const auth=await page.request.post("/api/auth/login",{data:{email:evaluation.adminEmail,password:evaluation.password}});expect(auth.status()).toBe(200);
  for(const route of ["/tienda","/cuenta","/app/inventario","/pos","/app/clientes","/app/ficha-clinica"]){
    await page.goto(route);await expect(page.locator("main")).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(2);
    await expect(page.locator("body")).not.toContainText("Application error");
    await page.screenshot({path:info.outputPath(`${route.replaceAll("/","_")}.png`),fullPage:true});
  }
  expect(errors).toEqual([]);
});

test("Pedido histórico sin OT explica conciliación y termina el indicador de carga",async({page})=>{
  await prisma.public_request_rate_limits.deleteMany();
  const sale=await prisma.sales.create({data:{status:"PENDING",origin:"ONLINE",subtotal_cents:1000,total_cents:1300,shipping_fee_cents:300,shipping_quote_source:"MOCK",fulfillment_method:"DELIVERY",delivery_address:"Dirección sintética heredada",delivery_city:"Comuna sintética",delivery_region:"Región sintética"}});
  await page.request.post("/api/auth/login",{data:{email:evaluation.adminEmail,password:evaluation.password}});
  await page.goto("/app/pedidos");await page.getByRole("textbox",{name:"Buscar pedido",exact:true}).fill(String(sale.sale_number));await page.getByRole("button",{name:"Buscar",exact:true}).click();await page.getByRole("button",{name:"Ver detalle",exact:true}).click();
  const panel=page.getByRole("region",{name:"Seguimiento del despacho",exact:true});
  await expect(panel).toContainText("Los pedidos históricos sin despacho registrado requieren revisión");
  await expect(panel).not.toContainText("Consultando despacho…");
  await expect(panel.getByRole("button",{name:"Generar OT",exact:true})).toHaveCount(0);
  // The customer projection can successfully return null for a legacy order.
  await page.route(`**/api/sales/${sale.id}/shipment`,route=>route.fulfill({json:{success:true,data:null}}));
  await page.reload();await page.getByRole("textbox",{name:"Buscar pedido",exact:true}).fill(String(sale.sale_number));await page.getByRole("button",{name:"Buscar",exact:true}).click();await page.getByRole("button",{name:"Ver detalle",exact:true}).click();
  await expect(panel).toContainText("Los pedidos históricos sin despacho registrado requieren revisión");await expect(panel).not.toContainText("Consultando despacho…");
});
