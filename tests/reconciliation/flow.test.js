import assert from "node:assert/strict";
import { after,beforeEach,test } from "node:test";
import { prisma } from "../../src/db/prisma.js";
import { inventoryDemo } from "../inventory/data.js";
import { http,isolated,newCart,order,product,stock,value } from "../shipping/helpers.js";

beforeEach(async()=>{isolated();await prisma.public_request_rate_limits.deleteMany();});
after(async()=>{await prisma.$disconnect();});

test("La página de cámara de validación continúa bloqueada en el build de producción",async()=>{
  assert.equal((await http("/virtual-try-on/3d/validation/camera?vtoDebug=1")).status,404);
});

test("Disponibilidad se filtra antes de paginar y excluye reservas, locales cerrados y conteos desconocidos",async()=>{
  const id=await product(1000,[1,0,0]);
  const query=()=>http(`/api/store/products?search=SHIP-${id}&availability=available&pageSize=1`).then(value);
  assert.equal((await query()).total,1);
  const pending=await order({id,method:"PICKUP"});assert.equal((await stock(id)).reserved,1);
  const unavailable=await query();assert.equal(unavailable.total,0);assert.equal(unavailable.totalPages,0);assert.deepEqual(unavailable.items,[]);
  await prisma.inventory_reservations.updateMany({where:{sale_id:pending.sale.id},data:{expires_at:new Date(Date.now()-1)}});
  assert.equal((await query()).total,1,"El vencimiento se concilia antes de calcular el total filtrado");
  await prisma.products.update({where:{id},data:{inventory_mode:"UNCONFIGURED"}});assert.equal((await query()).total,0);
  await prisma.products.update({where:{id},data:{inventory_mode:"TRACKED"}});
  const branch=inventoryDemo.branches[0],previous=await prisma.branches.findUniqueOrThrow({where:{id:branch}});await prisma.branches.update({where:{id:branch},data:{pickup_enabled:false,shipping_enabled:false}});
  try {assert.equal((await query()).total,0);} finally {await prisma.branches.update({where:{id:branch},data:{pickup_enabled:previous.pickup_enabled,shipping_enabled:previous.shipping_enabled}});}
  const c=await newCart(id);assert.equal((await value(await http("/api/store/cart/pickup",{cookie:c.cookie}))).some(b=>b.available),true);
});

test("Catálogo aplica el filtro a todo el conjunto, mantiene total y orden y no publica fixtures al deshabilitarlos",async()=>{
  const {getStoreProducts}=await import("../../src/services/store-catalog-service.js");
  const pages=await Promise.all([1,2,3].map(page=>getStoreProducts(new URLSearchParams(`search=CatalogoDemo&availability=available&page=${page}&pageSize=24&sort=price-asc`))));
  assert.deepEqual(pages.map(p=>p.items.length),[24,24,7]);assert.ok(pages.every(p=>p.total===55));assert.equal(new Set(pages.flatMap(p=>p.items.map(i=>i.id))).size,55);
  const prices=pages.flatMap(p=>p.items.map(i=>i.unitPriceCents));assert.deepEqual(prices,[...prices].sort((a,b)=>a-b));
  const production=await getStoreProducts(new URLSearchParams("search=CatalogoDemo"),{includeTestData:false});assert.equal(production.total,0);assert.deepEqual(production.items,[]);
});
