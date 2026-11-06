import {test,expect} from "@playwright/test";
import {prisma} from "../../src/db/prisma.js";
import {isolated,product,order} from "../shipping/helpers.js";

test.beforeEach(async()=>{isolated();await prisma.public_request_rate_limits.deleteMany();});
test.afterAll(async()=>{await prisma.$disconnect();});

test("Catálogo conserva URL y muestra inventario confirmado; reservar la última unidad elimina su disponibilidad",async({page})=>{
  const id=await product(1000,[1,0,0]);
  await page.goto(`/tienda?search=SHIP-${id}`);
  const card=page.locator('article').filter({has:page.getByRole("heading",{name:`Despacho sintético ${id}`,exact:true})});
  await expect(card.getByText("Disponible",{exact:true})).toBeVisible();await expect(card.getByText("Producto de prueba",{exact:true})).toBeVisible();
  await order({id,method:"PICKUP"});await page.reload();await expect(card.getByText("Agotado",{exact:true})).toBeVisible();
  await page.getByRole("checkbox",{name:"Mostrar disponibles",exact:true}).check();await expect(page).toHaveURL(/availability=available/);
  await expect(page.getByRole("heading",{name:"No encontramos productos",exact:true})).toBeVisible();
  await page.goBack();await expect(card.getByText("Agotado",{exact:true})).toBeVisible();
});
