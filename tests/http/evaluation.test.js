import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { evaluation, connectEvaluationDatabase } from "../fixtures/evaluation-data.js";
import { ids } from "../../scripts/seed-store-e2e.mjs";
import { SESSION_COOKIE_NAME } from "../../src/auth/session-token.js";

const enabled = Boolean(process.env.EVALUATION_HTTP_URL);
let database;
let adminCookie;
let restrictedCookie;

async function request(path, { cookie, body, method = "GET" } = {}) {
  // Impide dirigir estas pruebas a un despliegue externo por configuración accidental.
  assert.match(process.env.EVALUATION_HTTP_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  return fetch(`${process.env.EVALUATION_HTTP_URL}${path}`, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const json = await response.json();
  assert.equal(json.success, false);
  assert.equal(json.error.code, code);
  assert.equal(typeof json.error.message, "string");
  assert.equal(json.data, undefined);
}

async function login(email = evaluation.adminEmail) {
  const response = await request("/api/auth/login", { method: "POST", body: { email, password: evaluation.password } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  return cookie.split(";")[0];
}

before(async () => {
  if (!enabled) return;
  database = await connectEvaluationDatabase();
  adminCookie = await login();
  restrictedCookie = await login(evaluation.restrictedEmail);
});

after(async () => {
  if (!database) return;
  try {
    await database.user_sessions.deleteMany({ where: { user_id: { in: [evaluation.adminId, evaluation.restrictedId] } } });
    await database.users.update({ where: { id: evaluation.adminId }, data: { failed_login_attempts: 0, locked_until: null } });
  } finally { await database.$disconnect(); }
});

async function checkAuthorization(path) {
  await expectError(await request(path), 401, "AUTHENTICATION_REQUIRED");
  await expectError(await request(path, { cookie: `${SESSION_COOKIE_NAME}=sesion-inexistente` }), 401, "AUTHENTICATION_REQUIRED");
  await expectError(await request(path, { cookie: restrictedCookie }), 403, "INSUFFICIENT_PERMISSIONS");
}

test("INT-01 · POST /api/auth/login: validación, credenciales, sesión y revocación HTTP", { skip: !enabled }, async () => {
  await expectError(await request("/api/auth/login", { method: "POST", body: {} }), 400, "INVALID_USER_DATA");
  const denied = await request("/api/auth/login", {
    method: "POST", body: { email: evaluation.adminEmail, password: "Clave-incorrecta-de-prueba-2026" },
  });
  assert.equal(denied.headers.get("set-cookie"), null);
  await expectError(denied, 401, "INVALID_CREDENTIALS");
  const response = await request("/api/auth/login", {
    method: "POST", body: { email: evaluation.adminEmail, password: evaluation.password },
  });
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.success, true);
  assert.equal(json.data.user.id, evaluation.adminId);
  assert.equal(json.data.user.email, evaluation.adminEmail);
  assert.deepEqual(json.data.user.roles, ["ADMIN"]);
  assert.ok(json.data.session.id);
  assert.ok(new Date(json.data.session.expiresAt) > new Date());
  assert.equal(json.data.token, undefined);
  assert.equal(json.data.user.passwordHash, undefined);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.split(";")[0];
  const me = await request("/api/auth/me", { cookie });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).data.userId, evaluation.adminId);
  assert.equal((await request("/api/auth/logout", { cookie, method: "POST" })).status, 204);
  await expectError(await request("/api/auth/me", { cookie }), 401, "AUTHENTICATION_REQUIRED");
});

test("INT-02 · GET /api/products: 401, 403, filtros y catálogo real 200", { skip: !enabled }, async () => {
  await checkAuthorization("/api/products");
  const response = await request("/api/products?search=ESTUCHE-TEST&category=ACCESSORY&isActive=true", { cookie: adminCookie });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const { success, data } = await response.json();
  assert.equal(success, true);
  assert.equal(data.total, 1);
  assert.equal(data.page, 1);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, ids.accessory);
  assert.equal(data.items[0].name, "Estuche de prueba");
  assert.equal(data.items[0].category, "ACCESSORY");
  assert.equal(data.items[0].unitPriceCents, 5000);
  assert.equal(data.items[0].isActive, true);
  const empty = await request("/api/products?search=sin-coincidencias-evaluacion", { cookie: adminCookie });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).data.items, []);
  await expectError(await request("/api/products?page=0", { cookie: adminCookie }), 400, "INVALID_PRODUCT_DATA");
});

test("INT-03 · GET /api/patients: 401, 403, paciente sintético y búsqueda vacía", { skip: !enabled }, async () => {
  await checkAuthorization("/api/patients");
  const response = await request(`/api/patients?search=${evaluation.patientRut}`, { cookie: adminCookie });
  assert.equal(response.status, 200);
  const { success, data } = await response.json();
  assert.equal(success, true);
  assert.equal(data.total, 1);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, evaluation.patientId);
  assert.equal(data.items[0].rut, evaluation.patientRut);
  assert.equal(data.items[0].firstNames, "PacienteEvaluacion");
  assert.equal(data.items[0].email, "paciente-evaluacion@example.invalid");
  assert.equal(data.items[0].birthDate, "1990-01-15");
  const empty = await request("/api/patients?search=sin-coincidencias-evaluacion", { cookie: adminCookie });
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).data.total, 0);
  await expectError(await request("/api/patients?page=0", { cookie: adminCookie }), 400, "INVALID_PATIENT_DATA");
});

test("INT-04 · GET /api/appointments: 401, 403, rango, filtro y reserva real 200", { skip: !enabled }, async () => {
  const path = `/api/appointments?${evaluation.appointmentQuery}`;
  await checkAuthorization(path);
  const response = await request(`${path}&patientId=${evaluation.patientId}&status=CONFIRMED`, { cookie: adminCookie });
  assert.equal(response.status, 200);
  const { success, data } = await response.json();
  assert.equal(success, true);
  assert.equal(data.length, 1);
  assert.equal(data[0].id, evaluation.appointmentId);
  assert.equal(data[0].status, "CONFIRMED");
  assert.equal(data[0].startAt, evaluation.startAt);
  assert.equal(data[0].endAt, evaluation.endAt);
  assert.equal(data[0].patient.id, evaluation.patientId);
  assert.equal(data[0].professional.id, evaluation.professionalId);
  const empty = await request(`${path}&status=CANCELLED`, { cookie: adminCookie });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).data, []);
  await expectError(await request("/api/appointments?from=2030-10-17T00:00:00Z&to=2030-10-16T00:00:00Z", {
    cookie: adminCookie,
  }), 400, "INVALID_APPOINTMENT_DATA");
});
