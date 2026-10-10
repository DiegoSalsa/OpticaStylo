import { test, expect } from "@playwright/test";
import { prisma } from "../src/db/prisma.js";
import { requireIsolatedStoreDatabase } from "../scripts/seed-store-e2e.mjs";
import { adminId, salesUserId, managementId, fixtureRut } from "../tests/fixtures/management-data.js";
import { createSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "../src/auth/session-token.js";

test.beforeAll(() => requireIsolatedStoreDatabase());
test.afterAll(async () => prisma.$disconnect());

async function authenticate(context, userId = adminId) {
  requireIsolatedStoreDatabase();
  const token = createSessionToken();
  await prisma.user_sessions.create({ data: {user_id:userId, token_hash:hashSessionToken(token), expires_at:new Date(Date.now()+3600000)} });
  await context.addCookies([{name:SESSION_COOKIE_NAME,value:token,url:process.env.STORE_E2E_BASE_URL,httpOnly:true,sameSite:"Lax"}]);
}
test.beforeEach(async ({context}) => authenticate(context));
async function search(page, name, query) {
  await page.getByRole("textbox",{name}).fill(query);
  await page.locator("form").filter({has:page.getByRole("textbox",{name})}).getByRole("button",{name:"Buscar",exact:true}).click();
}
async function openDirectory(page, slug, query) {
  await page.goto(`/app/${slug}`);
  await search(page,`Buscar ${slug}`,query);
  await expect(page.getByText("Mostrando 1–20 de 123",{exact:true})).toBeVisible();
}

for (const [slug,query] of [["clientes","Cliente"],["pacientes","Paciente"],["usuarios","Usuario"],["productos","Producto"]]) {
  test(`directorio ${slug}: páginas posteriores, búsqueda completa y vacío`,async({page})=>{
    const searches=[];
    page.on("request",(request)=>{const url=new URL(request.url());if(url.searchParams.get("search")===`${query}122`) searches.push(url);});
    await openDirectory(page,slug,query);
    await page.getByRole("button",{name:"Siguiente",exact:true}).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Mostrando 21–40 de 123",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Página 5",exact:true}).click();
    await page.getByRole("button",{name:"Página 7",exact:true}).click();
    await expect(page.getByText("Mostrando 121–123 de 123",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Siguiente",exact:true})).toBeDisabled();
    await search(page,`Buscar ${slug}`,`${query}122`);
    await expect(page.getByText("Mostrando 1–1 de 1",{exact:true})).toBeVisible();
    await search(page,`Buscar ${slug}`,`${query}122`);
    await page.waitForTimeout(150);
    expect(searches).toHaveLength(1);
    await search(page,`Buscar ${slug}`,"inexistente");
    await expect(page.getByText("Mostrando 0–0 de 0",{exact:true})).toBeVisible();
    await expect(page.getByText(/No hay coincidencias/)).toBeVisible();
  });
}

test("filtros de productos reinician página y total decreciente se ajusta conservando editor",async({page})=>{
  await openDirectory(page,"productos","Producto");
  await page.getByRole("button",{name:"Página 5",exact:true}).click();
  await page.getByRole("button",{name:"Página 7",exact:true}).click();
  await page.getByLabel("Estado del listado").selectOption("true");
  await page.getByLabel("Categoría del listado").selectOption("FRAME");
  await expect(page.getByText("Mostrando 1–20 de 62",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Página 4",exact:true}).click();
  await expect(page.getByText("Mostrando 61–62 de 62",{exact:true})).toBeVisible();
  try {
    for(const name of ["Producto120","Producto122"]) {
      await page.locator(".management-item").filter({hasText:name}).click();
      await page.getByLabel("Producto visible y vendible").uncheck();
      await page.getByRole("button",{name:"Guardar cambios",exact:true}).click();
      await expect(page.getByRole("status").filter({hasText:"Producto actualizado"})).toBeVisible();
    }
    await expect(page.getByText("Página 3 de 3",{exact:true})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Producto122",exact:true})).toBeVisible();
  } finally {
    await prisma.products.updateMany({where:{id:{in:[managementId(4120),managementId(4122)]}},data:{is_active:true}});
  }
});

test("crear y modificar un cliente desde página avanzada conserva selección y contexto",async({page})=>{
  await openDirectory(page,"clientes","Cliente");
  await page.getByRole("button",{name:"Página 5",exact:true}).click();
  await page.getByRole("button",{name:"Página 7",exact:true}).click();
  await page.locator(".management-item").filter({hasText:"Cliente122"}).click();
  await page.getByLabel("Dirección comercial").fill("Dirección actualizada de prueba");
  await page.getByRole("button",{name:"Guardar cambios",exact:true}).click();
  await expect(page.getByText("Página 7 de 7",{exact:true})).toBeVisible();
  await expect(page.getByLabel("Dirección comercial")).toHaveValue("Dirección actualizada de prueba");
  await page.getByRole("button",{name:"Nuevo cliente",exact:true}).click();
  for(const [label,value] of [["Nombres","ClienteNuevo"],["Apellidos","Prueba"],["RUT",fixtureRut(6000)],["Teléfono","+56912345678"],["Correo","nuevo@example.invalid"],["Dirección comercial","Calle de prueba 123"]]) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole("button",{name:"Crear cliente",exact:true}).click();
  await expect(page.getByText("Mostrando 121–124 de 124",{exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"ClienteNuevo Prueba",exact:true})).toBeVisible();
});

for(const [slug,endpoint,name] of [["clientes","customers","Cliente"],["pacientes","patients","Paciente"]]) {
  test(`${slug}: una respuesta atrasada de detalle no reemplaza la selección`,async({page})=>{
    const idA=managementId(endpoint==="customers"?1000:2000);
    let release;
    const blocked = new Promise((resolve)=>{release=resolve;});
    await page.route(`**/api/${endpoint}/${idA}`,async(route)=>{
      const response=await route.fetch();
      await blocked;
      await route.fulfill({response}).catch(()=>{});
    });
    await page.goto(`/app/${slug}`);
    await search(page,`Buscar ${slug}`,`${name}00`);
    await page.locator(".management-item").filter({hasText:`${name}000`}).click();
    await page.locator(".management-item").filter({hasText:`${name}001`}).click();
    await expect(page.getByRole("heading",{name:`${name}001 Prueba`,exact:true})).toBeVisible();
    release();
    await page.waitForTimeout(250);
    await expect(page.getByLabel("Nombres",{exact:true})).toHaveValue(`${name}001`);
  });
}

test("productos: formularios independientes, archivo reiniciado e imágenes sin carreras",async({page})=>{
  const idA=managementId(4000);
  let release, uploads=0, productWrites=0;
  const blocked=new Promise((resolve)=>{release=resolve;});
  await page.route("**/api/products/*/images",async(route)=>{
    const url=route.request().url();
    const id=url.split("/").at(-2);
    if(route.request().method()==="POST") {
      uploads+=1;
      await route.fulfill({json:{data:{id:"new-image",alt:"Imagen nueva",url:"/icon.png"}},status:201});return;
    }
    if(id===idA) await blocked;
    await route.fulfill({json:{data:[{id:`image-${id}`,alt:id===idA?"Imagen A":"Imagen B",url:"/icon.png"}]}}).catch(()=>{});
  });
  page.on("request",(request)=>{if(request.method()==="PATCH"&&request.url().includes("/api/products/")) productWrites+=1;});
  await page.goto("/app/productos");
  await search(page,"Buscar productos","Producto00");
  await page.locator(".management-item").filter({hasText:"Producto000"}).click();
  await page.locator(".management-item").filter({hasText:"Producto001"}).click();
  await expect(page.getByAltText("Imagen B",{exact:true})).toBeVisible();
  release();
  await page.waitForTimeout(250);
  await expect(page.getByAltText("Imagen A",{exact:true})).toHaveCount(0);
  expect(await page.locator("form form").count()).toBe(0);
  await page.getByRole("button",{name:"Guardar cambios",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Producto actualizado"})).toBeVisible();
  expect(productWrites).toBe(1);expect(uploads).toBe(0);
  const upload=page.getByRole("form",{name:"Subir imagen",exact:true});
  await upload.getByLabel("Imagen del producto",{exact:true}).setInputFiles({name:"test.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAUVORK5CYII=","base64")});
  await upload.getByLabel("Descripción de la imagen").fill("Imagen nueva");
  await upload.getByRole("button",{name:"Agregar imagen"}).click();
  await expect(page.getByAltText("Imagen nueva",{exact:true})).toBeVisible();
  expect(uploads).toBe(1);expect(productWrites).toBe(1);
  expect(await upload.locator('input[type="file"]').evaluate((element)=>element.files.length)).toBe(0);
});

test("pedidos: conteos globales, columnas independientes, detalle y transición",async({page})=>{
  await page.goto("/app/pedidos");
  const paid=page.getByRole("region",{name:"Pagado",exact:true});
  await expect(paid.getByText("Mostrando 1–20 de 123",{exact:true})).toBeVisible();
  await expect(page.getByRole("region",{name:"Listo",exact:true}).locator(".order-card")).toHaveCount(1);
  await paid.getByRole("button",{name:"Página 5",exact:true}).click();
  await paid.getByRole("button",{name:"Página 7",exact:true}).click();
  await expect(paid.getByText("Mostrando 121–123 de 123",{exact:true})).toBeVisible();
  await expect(page.getByRole("region",{name:"Listo",exact:true}).locator(".order-card")).toHaveCount(1);
  await search(page,"Buscar pedido","Cliente000 Prueba");
  await expect(paid.getByText("Mostrando 1–1 de 1",{exact:true})).toBeVisible();
  await paid.getByRole("button",{name:"Ver detalle"}).click();
  const dialog=page.getByRole("dialog");
  await expect(dialog.getByText("Estuche de prueba",{exact:true})).toBeVisible();
  await expect(dialog.getByText("Total pagado",{exact:true})).toBeVisible();
  await expect(dialog.getByText("Historial de cambios",{exact:true})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await paid.getByRole("button",{name:"Iniciar preparación"}).click();
  await expect(page.getByRole("status").filter({hasText:"actualizado correctamente"})).toBeVisible();
  await expect(paid.locator(".order-card")).toHaveCount(0);
  await expect(page.getByRole("region",{name:"En preparación",exact:true}).locator(".order-card")).toHaveCount(1);
  await prisma.sales.update({where:{id:managementId(5000)},data:{status:"PAID"}});
});

test("pedidos: rechazo del backend conserva estado y una acción no se duplica",async({page})=>{
  let writes=0;
  await page.route("**/api/sales/*/status",async(route)=>{writes+=1;await page.waitForTimeout(150);await route.fulfill({status:409,json:{error:{message:"Transición rechazada por prueba"}}});});
  await page.goto("/app/pedidos");
  await search(page,"Buscar pedido","Cliente000");
  const button=page.getByRole("button",{name:"Iniciar preparación",exact:true});
  await button.evaluate((element)=>{element.click();element.click();});
  await expect(page.getByRole("alert").filter({hasText:"Transición rechazada"})).toBeVisible();
  expect(writes).toBe(1);
  await expect(page.getByRole("region",{name:"Pagado",exact:true}).locator(".order-card")).toHaveCount(1);
});

test("dashboard reconoce ventas y reportes comerciales; errores no aparentan cero",async({page,context})=>{
  await context.clearCookies();await authenticate(context,salesUserId);
  await page.goto("/app");
  await expect(page.locator(".dashboard-metric").filter({hasText:"Pedidos en proceso"}).locator("strong")).toHaveText("125");
  await expect(page.locator(".dashboard-metric").filter({hasText:"Ventas del mes"}).locator("strong")).not.toHaveText(/Cargando|Sin acceso|No disponible/);
  await page.route("**/api/sales/summary?*",async(route)=>route.fulfill({status:500,json:{error:{message:"Fallo de conteo simulado"}}}));
  await page.reload();
  await expect(page.locator(".dashboard-metric").filter({hasText:"Pedidos en proceso"}).locator("strong")).toHaveText("No disponible");
  await expect(page.getByRole("alert").filter({hasText:"Fallo de conteo simulado"})).toBeVisible();
});

test("roles mantienen restricciones de usuarios y operaciones",async({page,context})=>{
  await context.clearCookies();await authenticate(context,salesUserId);
  await page.goto("/app/usuarios");
  await expect(page.getByRole("heading",{name:"Acceso no disponible"})).toBeVisible();
  expect((await page.request.get("/api/users?page=1&pageSize=20")).status()).toBe(403);
});

test("POS recupera cotizaciones posteriores y mantiene importes",async({page})=>{
  await page.goto("/app/ventas");
  await page.getByRole("button",{name:"Cotizaciones",exact:true}).click();
  const panel=page.locator(".quotation-panel");
  await expect(panel.getByText("Mostrando 1–20 de 123",{exact:true})).toBeVisible();
  await panel.getByRole("button",{name:"Página 5",exact:true}).click();
  await panel.getByRole("button",{name:"Página 7",exact:true}).click();
  await expect(panel.getByText("Mostrando 121–123 de 123",{exact:true})).toBeVisible();
  const number=await panel.locator("article strong").first().innerText();
  await panel.getByRole("button",{name:"Cargar para vender"}).first().click();
  await expect(page.locator(".ticket-head h2")).toHaveText(number.replace("Cotización","Venta"));
  await expect(page.locator(".ticket-lines").getByText("Estuche de prueba",{exact:true})).toBeVisible();
  await expect(page.locator(".ticket-totals")).toContainText("5.000");
  await page.getByRole("button",{name:"Cotizaciones",exact:true}).click();
  await search(page,"Buscar cotizaciones","Cliente000");
  await expect(panel.getByText("Mostrando 1–1 de 1",{exact:true})).toBeVisible();
});

test("listado comunica fallos y permite reintento sin quedar cargando",async({page})=>{
  let fail=true;
  await page.route("**/api/products?*",async(route)=>{
    if(fail) await route.fulfill({status:500,json:{error:{message:"Fallo temporal"}}});else await route.continue();
  });
  await page.goto("/app/productos");
  await expect(page.getByRole("alert").filter({hasText:"Fallo temporal"})).toBeVisible();
  fail=false;
  await page.getByRole("button",{name:"Reintentar",exact:true}).click();
  await expect(page.locator(".management-item").first()).toBeVisible();
});

test("catálogo sin registros se diferencia de una búsqueda sin coincidencias",async({page})=>{
  await page.route("**/api/products?*",async(route)=>route.fulfill({json:{data:{items:[],page:1,pageSize:20,total:0,totalPages:0}}}));
  await page.goto("/app/productos");
  await expect(page.getByText("No hay productos registrados.",{exact:true})).toBeVisible();
  await search(page,"Buscar productos","Marco");
  await expect(page.getByText("No hay coincidencias para estos filtros.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Anterior",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Siguiente",exact:true})).toBeDisabled();
});

test("cliente invitado con datos comerciales opcionales puede consultarse",async({page})=>{
  const customer=await prisma.customers.create({data:{first_names:"Compradora Invitada"}});
  try {
    await page.goto("/app/clientes");
    await search(page,"Buscar clientes","Compradora Invitada");
    await page.locator(".management-item").filter({hasText:"Compradora Invitada"}).click();
    await expect(page.getByRole("heading",{name:"Compradora Invitada",exact:true})).toBeVisible();
    await expect(page.getByLabel("Correo",{exact:true})).toHaveValue("");
    await expect(page.getByLabel("RUT",{exact:true})).toHaveValue("");
  } finally {await prisma.customers.delete({where:{id:customer.id}});}
});

test("validación visual 1440, 1280, 390 y 360 sin desbordamiento ni hidratación inválida",async({page})=>{
  test.setTimeout(180000);
  const errors=[];
  page.on("pageerror",(error)=>errors.push(error.message));
  page.on("console",(message)=>{if(message.type()==="error"&&/hydration|cannot be a descendant|nested|validateDOMNesting/i.test(message.text())) errors.push(message.text());});
  for(const width of [1440,1280,390,360]) {
    await page.setViewportSize({width,height:900});
    for(const slug of ["productos","clientes","pacientes","usuarios","pedidos","ventas",""]) {
      await page.goto(`/app/${slug}`);
      if(slug==="ventas") {await page.getByRole("button",{name:"Cotizaciones",exact:true}).click();await expect(page.locator(".quotation-list article").first()).toBeVisible();}
      else if(slug==="pedidos") {await page.getByLabel("Estado operativo").selectOption("READY");await expect(page.locator(".order-card")).toHaveCount(1);}
      else if(slug) await expect(page.locator(".management-item").first()).toBeVisible();
      else await expect(page.locator(".dashboard-metric strong").first()).not.toHaveText("Cargando…");
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${slug} a ${width}px`).toBe(true);
      await page.screenshot({path:`tmp/store-e2e/management-${slug||"dashboard"}-${width}.png`});
    }
  }
  expect(errors).toEqual([]);
});
