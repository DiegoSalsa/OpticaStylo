import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { formatInTimeZone } from "date-fns-tz";
import { PDFDocument } from "pdf-lib";
import { database, data, ids } from "../prescriptions/helpers.js";
import { evaluation } from "../evaluation-data.js";
import { fixtureRut } from "../rut-fixture.js";

const base = process.env.EVALUATION_HTTP_URL;
const password = "Portal-sintetico-pruebas-2026!";
const clinical = "/api/store/accounts/me/clinical";

async function request(path, { cookie, method = "GET", body } = {}) {
  assert.match(base, /^http:\/\/127\.0\.0\.1:(3117|3119|3129|3149)$/);
  return fetch(base + path, {
    method,
    headers: { ...(cookie && { cookie }), ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

async function register(index) {
  const rut = fixtureRut(index);
  const email = "portal-" + randomUUID() + "@example.invalid";
  const response = await request("/api/store/accounts/register", {
    method: "POST",
    body: { firstNames: "Cliente", lastNames: "Sintético", rut, email, password, phone: "+56912345678", address: "Dirección de prueba" },
  });
  const { account } = await data(response, 201);
  return { account, rut, email, cookie: response.headers.getSetCookie()[0].split(";")[0] };
}

test("Mi cuenta conserva los permisos al descargar y usar recetas, cambiar horas y editar contacto", { skip: !base }, async (t) => {
  const db = database();
  t.after(() => db.$disconnect());
  const owner = await register(9761);
  const other = await register(9762);
  const professionalId = evaluation.professionalId;
  const patient = await db.patients.create({
    data: { rut: owner.rut, first_names: "Paciente", last_names: "Sintético", birth_date: new Date("1999-09-09"), email: owner.email, phone: "+56912345678", address: "Dirección de prueba" },
  });
  await db.customers.update({ where: { id: owner.account.customerId }, data: { patient_id: patient.id } });
  const encounter = await db.clinical_encounters.create({
    data: {
      patient_id: patient.id, professional_id: professionalId, reason_for_visit: "Atención sintética",
      status: "FINALIZED", finalized_at: new Date(), created_by: professionalId, updated_by: professionalId,
    },
  });
  const prescription = await db.optical_prescriptions.create({
    data: {
      encounter_id: encounter.id, issued_by: professionalId, version: 1,
      right_sphere: -1.25, right_cylinder: -0.5, right_axis: 90,
      left_sphere: -1, left_cylinder: 0, pupillary_distance: 62,
    },
  });

  await t.test("solo la cuenta vinculada puede descargar una receta vigente y asociarla a su carrito", async () => {
    const definition = await data(await request(clinical, { cookie: owner.cookie }));
    assert.equal(definition.prescriptions.active[0].id, prescription.id);
    const pdfPath = clinical + "/prescriptions/" + prescription.id + "/pdf";
    assert.equal((await request(pdfPath, { cookie: other.cookie })).status, 404);
    assert.equal((await request(pdfPath)).status, 401);
    const pdf = await request(pdfPath, { cookie: owner.cookie });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get("cache-control"), /no-store/);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal((await PDFDocument.load(await pdf.arrayBuffer())).getPageCount(), 1);

    const create = await request("/api/store/cart", { method: "POST", cookie: owner.cookie });
    const cart = await data(create, 201);
    const cartCookie = create.headers.getSetCookie()[0].split(";")[0];
    const cookie = owner.cookie + "; " + cartCookie;
    await db.store_cart_items.createMany({ data: [
      { cart_id: cart.id, product_id: ids.frame, quantity: 1 },
      { cart_id: cart.id, product_id: ids.lens, mounted_on_product_id: ids.frame, quantity: 1 },
    ] });
    const choose = "/api/store/cart/prescription/clinical";
    assert.equal((await request(choose, { cookie: cartCookie, method: "PUT", body: { prescriptionId: prescription.id } })).status, 401);
    assert.equal((await request(choose, { cookie: other.cookie + "; " + cartCookie, method: "PUT", body: { prescriptionId: prescription.id } })).status, 404);
    const updated = await data(await request(choose, { cookie, method: "PUT", body: { prescriptionId: prescription.id } }));
    assert.equal(updated.clinicalPrescriptionId, prescription.id);
    assert.equal((await data(await request("/api/store/cart", { cookie }))).items.length, 2);
  });

  await t.test("actualiza únicamente el contacto comercial de la cuenta autenticada", async () => {
    const endpoint = "/api/store/accounts/me";
    assert.equal((await request(endpoint, { method: "PATCH", body: { address: "Sin sesión" } })).status, 401);
    const profile = await data(await request(endpoint, { cookie: owner.cookie, method: "PATCH", body: { address: "Dirección sintética actualizada", email: other.email } }));
    assert.equal(profile.address, "Dirección sintética actualizada");
    assert.equal(profile.email, owner.email);
    assert.equal((await data(await request(endpoint, { cookie: other.cookie }))).address, "Dirección de prueba");
    assert.equal((await db.patients.findUniqueOrThrow({ where: { id: patient.id } })).address, "Dirección de prueba");
  });

  await t.test("reagenda la propia hora usando disponibilidad real y la cancela sin exponer fichas ajenas", async () => {
    await db.professional_profiles.update({ where: { user_id: professionalId }, data: { is_bookable: true } });
    const schedule = { start_time: new Date("1970-01-01T09:00:00Z"), end_time: new Date("1970-01-01T14:00:00Z"), is_working: true };
    for (let day = 0; day < 7; day++) {
      await db.professional_weekly_schedules.upsert({
        where: { professional_id_day_of_week: { professional_id: professionalId, day_of_week: day } },
        update: schedule,
        create: { ...schedule, professional_id: professionalId, day_of_week: day },
      });
    }
    const dateAt = (offset) => formatInTimeZone(new Date(Date.now() + offset * 86_400_000), "America/Santiago", "yyyy-MM-dd");
    async function firstSlot(date) {
      const availability = await data(await request("/api/store/booking/professionals/" + professionalId + "/availability?date=" + date));
      assert.ok(availability.slots.length);
      return availability.slots[0];
    }
    const from = await firstSlot(dateAt(8));
    const to = await firstSlot(dateAt(9));
    const appointment = await db.appointments.create({
      data: { patient_id: patient.id, professional_id: professionalId, start_at: new Date(from.startAt), end_at: new Date(from.endAt) },
    });
    const endpoint = clinical + "/appointments/" + appointment.id;
    const reschedule = { action: "RESCHEDULE", expectedStartAt: from.startAt, startAt: to.startAt };
    assert.equal((await request(endpoint, { cookie: other.cookie, method: "PATCH", body: reschedule })).status, 404);
    assert.equal((await request(endpoint, { cookie: owner.cookie, method: "PATCH", body: { ...reschedule, startAt: to.endAt.slice(0, 10) + "T02:00:00.000Z" } })).status, 409);
    assert.equal((await db.appointments.findUniqueOrThrow({ where: { id: appointment.id } })).start_at.toISOString(), from.startAt);
    await data(await request(endpoint, { cookie: owner.cookie, method: "PATCH", body: reschedule }));
    assert.equal((await request(endpoint, { cookie: owner.cookie, method: "PATCH", body: reschedule })).status, 409);
    await data(await request(endpoint, { cookie: owner.cookie, method: "PATCH", body: { action: "CANCEL", expectedStartAt: to.startAt } }));
    const saved = await db.appointments.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(saved.status, "CANCELLED");
    assert.equal(saved.start_at.toISOString(), to.startAt);
    assert.equal(await db.appointment_events.count({ where: { appointment_id: appointment.id } }), 2);
    assert.equal(await db.transactional_email_outbox.count({ where: { appointment_id: appointment.id, status: "SUPPRESSED" } }), 2);
  });
});
