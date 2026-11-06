import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { database, data, cart, addItems, configure, prescription } from "../prescriptions/helpers.js";
import { evaluation } from "../evaluation-data.js";
import { inventoryDemo as inv } from "../inventory/data.js";
import { clinicalDemo } from "../clinical/data.js";
import { commercialDemo as d } from "./data.js";
import { fixtureRut } from "../rut-fixture.js";
let db, admin, staff, staffB, professional, accountCookie, guestOrder, guestCookie, sessionA, sessionB, saleA, saleB;
async function http(path, {
  body,
  cookie = admin,
  method = "GET",
  key = randomUUID()
} = {}) {
  assert.match(process.env.EVALUATION_HTTP_URL, /^http:\/\/127\.0\.0\.1:3119$/);
  return fetch(process.env.EVALUATION_HTTP_URL + path, {
    method,
    headers: {
      ...(cookie ? {
        cookie
      } : {}),
      "Content-Type": "application/json",
      "X-Idempotency-Key": key
    },
    ...(body ? {
      body: JSON.stringify(body)
    } : {})
  });
}
async function login(email) {
  const r = await http("/api/auth/login", {
    cookie: null,
    method: "POST",
    body: {
      email,
      password: evaluation.password
    }
  });
  await data(r);
  return r.headers.getSetCookie()[0].split(";")[0];
}
async function open(branchId) {
  const t = await data(await http("/api/cash-register/terminals", {
    method: "POST",
    body: {
      branchId,
      name: "Caja clientes " + randomUUID()
    }
  }), 201);
  return data(await http("/api/cash-register", {
    method: "POST",
    body: {
      branchId,
      terminalId: t.id,
      openingAmountCents: 0
    }
  }), 201);
}
async function sell(session, customerId, operation = "SALE") {
  const sale = await data(await http("/api/sales", {
    method: "POST",
    body: {
      operation,
      branchId: session.branchId,
      cashSessionId: session.id,
      customerId,
      items: [{
        productId: d.products[0],
        quantity: 1
      }]
    }
  }), 201);
  return operation === "QUOTATION" ? sale : data(await http(`/api/sales/${sale.id}/payments`, {
    method: "POST",
    body: {
      cashSessionId: session.id,
      payments: [{
        paymentMethod: "CASH",
        amountCents: 1000,
        cashReceivedCents: 1000
      }]
    }
  }), 201);
}
async function checkout(customer, cookie) {
  const g = await cart(cookie);
  await addItems(g.cookie);
  await data(await http("/api/store/cart/prescription/manual", {
    cookie: g.cookie,
    method: "PUT",
    body: prescription
  }));
  await configure(g.cookie, customer);
  const order = await data(await http("/api/store/cart/checkout", {
    cookie: g.cookie,
    method: "POST"
  }), 201);
  return {
    ...g,
    order: order.order
  };
}
async function otp(challengeId) {
  const row = await db.transactional_email_outbox.findUniqueOrThrow({
    where: {
      deduplication_key: "CUSTOMER_COMMERCE_OTP:" + challengeId
    }
  });
  return row.payload.code;
}
before(async () => {
  db = database();
  await db.public_request_rate_limits.deleteMany();
  [admin, staff, staffB, professional] = await Promise.all([login(evaluation.adminEmail), login(inv.staffEmail), login(d.staffBEmail), login(clinicalDemo.email)]);
  sessionA = await open(inv.branches[0]);
  sessionB = await open(inv.branches[1]);
});
beforeEach(async () => {
  await db.public_request_rate_limits.deleteMany();
});
after(async () => {
  for (const session of [sessionA, sessionB]) if (session) {
    const current = await data(await http(`/api/cash-register/${session.id}`));
    await data(await http(`/api/cash-register/${session.id}/close`, {
      method: "POST",
      body: {
        closingCountedCents: current.expectedAmountCents,
        closingNotes: "Fin de prueba comercial sintética"
      }
    }));
  }
  await db.$disconnect();
});
test("Administración registra cliente con datos mínimos y auditoría", async () => {
  const c = await data(await http("/api/customers", {
    method: "POST",
    body: {
      firstNames: "Ocasional sintético"
    }
  }), 201);
  assert.equal(c.email, null);
  const e = await db.customer_commercial_events.findFirst({
    where: {
      customer_id: c.id
    }
  });
  assert.equal(e.performed_by, evaluation.adminId);
  assert.equal(e.snapshot.patient_id, undefined);
});
test("Dos ventas reales en sucursales distintas conservan una identidad", async () => {
  saleA = await sell(sessionA, d.customerId);
  saleB = await sell(sessionB, d.customerId);
  assert.equal(saleA.customer.id, d.customerId);
  assert.equal(saleB.customer.id, d.customerId);
  const p = await data(await http(`/api/customers/${d.customerId}/profile`));
  assert.equal(p.summary.purchaseCount, 2);
  assert.equal(p.summary.totalSpentCents, 2000);
  assert.equal(p.summary.branches.length, 2);
  assert.equal(await db.customers.count({
    where: {
      rut: d.customer.rut
    }
  }), 1);
});
test("Venta anónima no se atribuye a un cliente identificado", async () => {
  const s = await sell(sessionA, null);
  assert.equal(s.customer, null);
  const p = await data(await http(`/api/customers/${d.customerId}/profile`));
  assert.equal(p.summary.purchaseCount, 2);
});
test("Nombre completo, RUT normalizado, teléfono y correo encuentran al mismo cliente", async () => {
  for (const search of [d.customer.firstNames + " " + d.customer.lastNames, d.customer.rut.replace("-", ""), "+56 9 8111 2222", d.customer.email]) {
    const p = await data(await http("/api/customers?search=" + encodeURIComponent(search)));
    assert.ok(p.items.some(c => c.id === d.customerId), search);
  }
});
test("Creación concurrente y distintas representaciones del RUT no duplican", async () => {
  const rut = fixtureRut(9701),
    body = {
      firstNames: "Concurrencia sintética",
      rut
    };
  const rs = await Promise.all([http("/api/customers", {
    method: "POST",
    body
  }), http("/api/customers", {
    method: "POST",
    body: {
      ...body,
      rut: rut.replace(/(\d)(?=(\d{3})+-)/g, "$1.")
    }
  })]);
  assert.deepEqual(rs.map(r => r.status).sort(), [201, 409]);
  assert.equal(await db.customers.count({
    where: {
      rut
    }
  }), 1);
});

test("RUT heredado con cero inicial conserva identidad y evidencia el conflicto sin fusionar", async () => {
  const legacy = await db.customers.create({data:{first_names:"Identidad heredada sintética",rut:"01234567-4",email:"identidad-heredada@example.invalid"}});
  assert.equal((await http("/api/customers",{method:"POST",body:{firstNames:"Misma identidad",rut:"1234567-4"}})).status,409);
  const proof = await data(await http("/api/store/accounts/register/request-code",{cookie:null,method:"POST",body:{rut:"1234567-4",email:legacy.email}}));
  assert.equal((await db.customer_commerce_challenges.findUniqueOrThrow({where:{id:proof.challengeId}})).customer_id,legacy.id);
  const duplicate = await db.customers.create({data:{first_names:"Conflicto heredado sintético",rut:"1234567-4"}});
  const search = await data(await http("/api/customers?search=01234567-4"));
  assert.ok([legacy.id,duplicate.id].every(id=>search.items.some(row=>row.id===id)));
  const conflicts = await data(await http("/api/customers/conflicts"));
  assert.ok(conflicts.items.some(row=>row.ids.includes(legacy.id)&&row.ids.includes(duplicate.id)));
  assert.equal((await http("/api/customers",{method:"POST",body:{firstNames:"Conflicto",rut:"1234567-4"}})).status,409);
  assert.equal((await db.customers.findUniqueOrThrow({where:{id:legacy.id}})).rut,"01234567-4");
});
test("Nombres y correos compartidos no fusionan identidades", async () => {
  const body = {
    firstNames: "Nombre compartido sintético",
    email: "familia@example.invalid"
  };
  const a = await data(await http("/api/customers", {
      method: "POST",
      body
    }), 201),
    b = await data(await http("/api/customers", {
      method: "POST",
      body
    }), 201);
  assert.notEqual(a.id, b.id);
});
test("Historial paginado conserva artículos y precios históricos", async () => {
  const original = await db.products.findUniqueOrThrow({
    where: {
      id: d.products[0]
    }
  });
  await db.products.update({
    where: {
      id: original.id
    },
    data: {
      is_active: false,
      unit_price_cents: 2000
    }
  });
  try {
    const h = await data(await http(`/api/customers/${d.customerId}/history?page=1&pageSize=1`));
    assert.equal(h.items.length, 1);
    assert.equal(h.total, 2);
    assert.equal(h.totalPages, 2);
    assert.equal(h.items[0].items[0].unitPriceCents, 1000);
    assert.equal(h.items[0].items[0].name, original.name);
    const h2 = await data(await http(`/api/customers/${d.customerId}/history?page=2&pageSize=1`));
    assert.notEqual(h.items[0].id, h2.items[0].id);
  } finally {
    await db.products.update({
      where: {
        id: original.id
      },
      data: {
        is_active: true,
        unit_price_cents: 1000
      }
    });
  }
});
test("Empleado comparte identidad pero solo ve operaciones de su sucursal", async () => {
  for (const [cookie, sale] of [[staff, saleA], [staffB, saleB]]) {
    const p = await data(await http(`/api/customers/${d.customerId}/profile`, {
      cookie
    }));
    assert.equal(p.summary.purchaseCount, 1);
    assert.equal(p.summary.totalSpentCents, 1000);
    const h = await data(await http(`/api/customers/${d.customerId}/history`, {
      cookie
    }));
    assert.deepEqual(h.items.map(r => r.id), [sale.id]);
  }
  assert.equal((await http(`/api/sales/${saleB.id}`, {
    cookie: staff
  })).status, 403);
});
test("Cotizaciones y pedidos no pagados se recuperan y no suman compras", async () => {
  const quote = await sell(sessionA, d.customerId, "QUOTATION");
  const g = await checkout(d.customer);
  guestOrder = g.order;
  guestCookie = g.cookie;
  assert.equal(guestOrder.status, "PENDING");
  const p = await data(await http(`/api/customers/${d.customerId}/profile`));
  assert.equal(p.summary.purchaseCount, 2);
  assert.equal(p.summary.totalSpentCents, 2000);
  assert.equal(p.summary.quotationCount, 1);
  const h = await data(await http(`/api/customers/${d.customerId}/history?status=QUOTATION`));
  assert.equal(h.items[0].id, quote.id);
  assert.equal(guestOrder.customer.id, d.customerId);
});
test("Preferencias explícitas y notas persisten con responsable, fecha y versión", async () => {
  const p = await data(await http(`/api/customers/${d.customerId}/profile`));
  const body = {
    expectedVersion: p.customer.version,
    preferences: {
      brands: ["Marca declarada"],
      models: ["Modelo consultado"],
      notes: "Preferencia comercial sintética"
    }
  };
  await data(await http(`/api/customers/${d.customerId}/preferences`, {
    method: "POST",
    body
  }), 201);
  assert.equal((await http(`/api/customers/${d.customerId}/preferences`, {
    method: "POST",
    body
  })).status, 409);
  await data(await http(`/api/customers/${d.customerId}/notes`, {
    method: "POST",
    cookie: staff,
    body: {
      content: "Cotización consultada, sin datos clínicos",
      branchId: inv.branches[0]
    }
  }), 201);
  const after = await data(await http(`/api/customers/${d.customerId}/profile`));
  assert.deepEqual(after.preferences, body.preferences);
  const n = await data(await http(`/api/customers/${d.customerId}/notes`, {
    cookie: staff
  }));
  assert.equal(n.items[0].author, "Empleado Sintético");
  await assert.rejects(db.customer_commercial_notes.delete({
    where: {
      id: n.items[0].id
    }
  }));
});
test("Compra no equivale a publicidad: autorización, revocación y cambio de contacto", async () => {
  const path = `/api/customers/${d.customerId}/contact`;
  let p = await data(await http(`/api/customers/${d.customerId}/profile`));
  assert.equal(p.contact.channels[0].state, "UNKNOWN");
  assert.equal((await http(path, {
    method: "POST",
    body: {
      channel: "EMAIL",
      decision: "GRANTED",
      source: "IN_PERSON"
    }
  })).status, 400);
  await data(await http(path, {
    method: "POST",
    body: {
      channel: "EMAIL",
      decision: "GRANTED",
      source: "WRITTEN",
      evidence: "Registro sintético de autorización",
      confirm: true
    }
  }), 201);
  await data(await http(path, {
    method: "POST",
    body: {
      channel: "EMAIL",
      decision: "REVOKED",
      source: "IN_PERSON",
      evidence: "Oposición sintética"
    }
  }), 201);
  p = await data(await http(`/api/customers/${d.customerId}/profile`));
  assert.equal(p.contact.channels[0].state, "REVOKED");
  assert.equal(await db.customer_contact_events.count({
    where: {
      customer_id: d.customerId
    }
  }), 2);
  await data(await http(path, {
    method: "POST",
    body: {
      channel: "PHONE",
      decision: "GRANTED",
      source: "IN_PERSON",
      evidence: "Autorización telefónica sintética presencial",
      confirm: true
    }
  }), 201);
  await data(await http(`/api/customers/${d.customerId}`, {
    method: "PATCH",
    body: {
      phone: "+56981113333",
      expectedVersion: p.customer.version
    }
  }));
  p = await data(await http(`/api/customers/${d.customerId}/profile`));
  assert.equal(p.contact.channels.find(c => c.channel === "PHONE").state, "CONTACT_CHANGED");
});
test("Cuenta nueva y RUT coincidente no obtienen pedidos previos sin código", async () => {
  const body = {
    ...d.customer,
    password: evaluation.password
  };
  assert.equal((await http("/api/store/accounts/register", {
    cookie: null,
    method: "POST",
    body
  })).status, 409);
  const challenge = await data(await http("/api/store/accounts/register/request-code", {
    cookie: null,
    method: "POST",
    body: {
      rut: d.customer.rut,
      email: d.customer.email
    }
  }));
  const code = await otp(challenge.challengeId);
  assert.equal(JSON.stringify(challenge).includes(code), false);
  const r = await http("/api/store/accounts/register", {
    cookie: null,
    method: "POST",
    body: {
      ...body,
      challengeId: challenge.challengeId,
      verificationCode: code
    }
  });
  const a = await data(r, 201);
  accountCookie = r.headers.getSetCookie()[0].split(";")[0];
  assert.equal(a.account.customerId, d.customerId);
  assert.deepEqual(await data(await http("/api/store/orders", {
    cookie: accountCookie
  })), []);
  assert.equal((await http(`/api/store/orders/${guestOrder.id}`, {
    cookie: accountCookie
  })).status, 404);
});
test("Recuperación de pedido individual exige código, cuenta e identidad exactos", async () => {
  const challenge = await data(await http("/api/store/accounts/me/orders-link/request-code", {
    cookie: accountCookie,
    method: "POST",
    body: {
      orderId: String(guestOrder.saleNumber)
    }
  }));
  assert.equal((await http("/api/store/accounts/me/orders-link", {
    cookie: accountCookie,
    method: "POST",
    body: {
      challengeId: challenge.challengeId,
      code: "wrong"
    }
  })).status, 409);
  await data(await http("/api/store/accounts/me/orders-link", {
    cookie: accountCookie,
    method: "POST",
    body: {
      challengeId: challenge.challengeId,
      code: await otp(challenge.challengeId)
    }
  }));
  assert.equal((await http(`/api/store/orders/${guestOrder.id}`, {
    cookie: accountCookie
  })).status, 200);
  assert.equal((await http(`/api/store/orders/${guestOrder.id}/prescription`, {
    cookie: accountCookie
  })).status, 200);
  const h = await data(await http("/api/store/orders?page=1&pageSize=1", {
    cookie: accountCookie
  }));
  assert.equal(h.items[0].id, guestOrder.id);
  assert.equal((await http("/api/store/accounts/me/orders-link", {
    cookie: accountCookie,
    method: "POST",
    body: {
      challengeId: challenge.challengeId,
      code: await otp(challenge.challengeId)
    }
  })).status, 409);
  assert.equal((await db.store_carts.findUniqueOrThrow({
    where: {
      sale_id: guestOrder.id
    }
  })).customer_account_id, null);
});
test("Compra registrada conserva corrección invitado → cuenta antes del checkout", async () => {
  const g = await checkout(d.customer, accountCookie);
  const orders = await data(await http("/api/store/orders?page=1&pageSize=1", {
    cookie: accountCookie
  }));
  assert.equal(orders.total, 2);
  assert.equal(orders.items[0].id, g.order.id);
  assert.equal((await db.store_carts.findUniqueOrThrow({
    where: {
      sale_id: g.order.id
    }
  })).customer_account_id, (await db.customer_accounts.findUniqueOrThrow({
    where: {
      customer_id: d.customerId
    }
  })).id);
});
test("Roles y cuentas ajenas no leen perfiles, notas ni fichas clínicas", async () => {
  for (const path of [`/api/customers/${d.customerId}/profile`, `/api/customers/${d.customerId}/history`, `/api/customers/${d.customerId}/notes`]) {
    assert.equal((await http(path, {
      cookie: professional
    })).status, 403);
    assert.equal((await http(path, {
      cookie: accountCookie
    })).status, 401);
    assert.equal((await http(path, {
      cookie: null
    })).status, 401);
  }
  for (const cookie of [admin, staff, staffB]) assert.equal((await http(`/api/patients/${clinicalDemo.patientId}/clinical-history`, {
    cookie
  })).status, 403);
  assert.equal((await http(`/api/store/orders/${guestOrder.id}`, {
    cookie: null
  })).status, 404);
  assert.equal((await http(`/api/store/orders/${guestOrder.id}`, {
    cookie: guestCookie
  })).status, 200);
});
test("Segmentos, reporte real y paginación del directorio", async () => {
  const repeat = await data(await http("/api/customers?segment=REPEAT&pageSize=1"));
  assert.ok(repeat.items.some(c => c.id === d.customerId));
  const quotes = await data(await http("/api/customers?segment=QUOTED"));
  assert.ok(quotes.items.some(c => c.id === d.customerId));
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago"
  }).format(new Date());
  const r = await data(await http(`/api/reports/customers?from=${today}&to=${today}`));
  assert.ok(r.recurringCustomers >= 1);
  assert.ok(r.anonymousPurchases >= 1);
  const first = await data(await http("/api/customers?page=1&pageSize=1")),
    second = await data(await http("/api/customers?page=2&pageSize=1"));
  assert.equal(first.items.length, 1);
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.ok(first.total > 1);
});
test("Cancelaciones, saldos parciales y reembolsos informados no inflan indicadores", async () => {
  const customer = await data(await http("/api/customers", {
    method: "POST",
    body: {
      firstNames: "Métricas sintéticas"
    }
  }), 201);
  for (const kind of ["VALID", "CANCELLED", "PARTIAL", "REFUNDED"]) {
    const s = await db.sales.create({
      data: {
        customer_id: customer.id,
        branch_id: inv.branches[0],
        origin: "ONLINE",
        fulfillment_method: "PICKUP",
        status: kind === "CANCELLED" ? "CANCELLED" : kind === "PARTIAL" ? "PENDING" : "PAID",
        subtotal_cents: 1000,
        total_cents: 1000,
        ...(kind === "CANCELLED" ? {
          cancellation_reason: "Cancelación histórica sintética",
          cancelled_at: new Date()
        } : {})
      }
    });
    const attempt = kind === "REFUNDED" ? await db.payment_attempts.create({
      data: {
        sale_id: s.id,
        provider: "MERCADO_PAGO",
        amount_cents: 1000,
        provider_status: "refunded",
        expires_at: new Date(Date.now() + 86400000)
      }
    }) : null;
    if (kind !== "CANCELLED") await db.sale_payments.create({
      data: {
        sale_id: s.id,
        reference: "HISTORICO-SINTETICO",
        amount_cents: kind === "PARTIAL" ? 500 : 1000,
        payment_method: attempt ? "MERCADO_PAGO" : "BANK_TRANSFER",
        provider_attempt_id: attempt?.id,
        source: attempt ? "PROVIDER" : "MANUAL",
        received_by: attempt ? null : evaluation.adminId
      }
    });
  }
  const p = await data(await http(`/api/customers/${customer.id}/profile`));
  assert.equal(p.summary.purchaseCount, 1);
  assert.equal(p.summary.totalSpentCents, 1000);
  assert.equal(p.summary.refundReviewCount, 1);
});
test("Recuperar identidad comercial vinculada a paciente exige otra verificación clínica", async () => {
  // Esta identidad pertenece a fase 5; no reutilizar los RUT de recetas o fichas clínicas.
  const patient = await db.patients.create({data:{rut:fixtureRut(9720),first_names:"Paciente recuperación comercial",last_names:"Sintético",birth_date:new Date("1990-01-01"),email:"recuperacion-clinica@example.invalid",phone:"+56912345678",address:"Dirección sintética de recuperación"}});
  const customer = await db.customers.create({
    data: {
      first_names: patient.first_names,
      last_names: patient.last_names,
      rut: patient.rut,
      email: patient.email,
      phone: patient.phone,
      address: patient.address,
      patient_id: patient.id
    }
  });
  const challenge = await data(await http("/api/store/accounts/register/request-code", {
    cookie: null,
    method: "POST",
    body: {
      rut: patient.rut,
      email: patient.email
    }
  }));
  const r = await http("/api/store/accounts/register", {
    cookie: null,
    method: "POST",
    body: {
      rut: patient.rut,
      email: patient.email,
      firstNames: patient.first_names,
      lastNames: patient.last_names,
      phone: patient.phone,
      address: patient.address,
      password: evaluation.password,
      challengeId: challenge.challengeId,
      verificationCode: await otp(challenge.challengeId)
    }
  });
  await data(r, 201);
  const cookie = r.headers.getSetCookie()[0].split(";")[0];
  const overview = await data(await http("/api/store/accounts/me/clinical", {
    cookie
  }));
  assert.equal(overview.linked, false);
  assert.equal(overview.patient, null);
  assert.deepEqual(overview.prescriptions.active, []);
  assert.equal((await db.customer_accounts.findUniqueOrThrow({
    where: {
      customer_id: customer.id
    }
  })).clinical_link_recheck_required, true);
});
test("Búsqueda comercial limita enumeración y la auditoría no se borra", async () => {
  const first = await db.customer_commercial_events.findFirst({
    where: {
      customer_id: d.customerId
    }
  });
  await assert.rejects(db.customer_commercial_events.delete({
    where: {
      id: first.id
    }
  }));
  for (let i = 0; i < 120; i++) assert.equal((await http("/api/customers?pageSize=1", {
    cookie: staff
  })).status, 200);
  assert.equal((await http("/api/customers?pageSize=1", {
    cookie: staff
  })).status, 429);
});
test("Cuenta ajena no recupera pedidos aunque conozca su número", async () => {
  const r = await http("/api/store/accounts/register", {
    cookie: null,
    method: "POST",
    body: {
      ...d.customer,
      rut: fixtureRut(9707),
      email: "otra-cuenta@example.invalid",
      password: evaluation.password
    }
  });
  await data(r, 201);
  const cookie = r.headers.getSetCookie()[0].split(";")[0];
  const challenge = await data(await http("/api/store/accounts/me/orders-link/request-code", {
    cookie,
    method: "POST",
    body: {
      orderId: String(guestOrder.saleNumber)
    }
  }));
  assert.equal(await db.customer_commerce_challenges.count({
    where: {
      id: challenge.challengeId
    }
  }), 0);
  assert.equal((await http(`/api/store/orders/${guestOrder.id}`, {
    cookie
  })).status, 404);
  assert.equal((await http(`/api/store/orders/${guestOrder.id}/prescription`, {
    cookie
  })).status, 404);
});
test("Recetas comerciales se paginan y respetan la sucursal autorizada",async()=>{
 const endpoint=`/api/external-prescriptions?customerId=${d.customerId}&pageSize=1`;
 const first=await data(await http(endpoint+"&page=1")),second=await data(await http(endpoint+"&page=2"));
 assert.equal(first.total,2);assert.equal(first.items.length,1);assert.notEqual(first.items[0].id,second.items[0].id);
 const allowed=await data(await http(endpoint+"&page=1",{cookie:staff}));assert.equal(allowed.total,2);
 const denied=await data(await http(endpoint+"&page=1",{cookie:staffB}));assert.equal(denied.total,0);
 assert.equal((await http(`/api/external-prescriptions/${first.items[0].id}`,{cookie:staffB})).status,404);
});
test("Identifica conflictos sin fusiones y protege códigos en respuestas administrativas", async () => {
  const conflicts = await data(await http("/api/customers/conflicts"));
  assert.equal(conflicts.total, 1);
  assert.equal(conflicts.items[0].identity, "12345674");
  assert.equal(conflicts.items[0].count, 2);
  assert.equal((await http("/api/customers/conflicts", {
    cookie: staff
  })).status, 403);
  const emails = await http("/api/admin/transactional-emails?templateCode=CUSTOMER_COMMERCE_OTP");
  assert.equal(emails.status, 200);
  const payload = await emails.text();
  assert.doesNotMatch(payload, /"code"\s*:|"challengeId"\s*:/);
});
