import {test,expect} from "@playwright/test";
import {prisma} from "../../src/db/prisma.js";
import {isolated,product,order,actor} from "../shipping/helpers.js";
import {inventoryDemo} from "../inventory/data.js";
import {mutateInventory} from "../../src/repositories/inventory-repository.js";

test.beforeEach(async()=>{isolated();await prisma.public_request_rate_limits.deleteMany();});
test.afterAll(async()=>{await prisma.$disconnect();});

test("Catálogo conserva URL y muestra inventario confirmado; reservar la última unidad elimina su disponibilidad",async({page})=>{
  const id=await product(1000,[1,0,0]);
  // El catálogo de main añade otra sucursal sintética. Confirmar su cero evita
  // confundir un conteo desconocido con el agotamiento de la única unidad.
  for(const branch of await prisma.branches.findMany({where:{is_active:true,id:{notIn:inventoryDemo.branches}},select:{id:true}}))await mutateInventory({productId:id,branchId:branch.id,kind:"COUNT",quantity:0,expectedVersion:null,reason:"Conteo cero del escenario sintético de última unidad"},actor,`rc:${id}:${branch.id}`);
  await page.goto(`/tienda?search=SHIP-${id}`);
  const card=page.locator('article').filter({has:page.getByRole("heading",{name:`Despacho sintético ${id}`,exact:true})});
  await expect(card.getByText("Disponible",{exact:true})).toBeVisible();await expect(card.getByText("Producto de prueba",{exact:true})).toBeVisible();
  await order({id,method:"PICKUP"});await page.reload();await expect(card.getByText("Agotado",{exact:true})).toBeVisible();
  await page.getByRole("checkbox",{name:"Mostrar disponibles",exact:true}).check();await expect(page).toHaveURL(/availability=available/);
  await expect(page.getByRole("heading",{name:"No encontramos productos",exact:true})).toBeVisible();
  await page.goBack();await expect(card.getByText("Agotado",{exact:true})).toBeVisible();
});
