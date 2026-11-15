import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { formatInTimeZone } from "date-fns-tz";
import { PDFDocument } from "pdf-lib";
import { disconnectPrisma } from "../../src/db/prisma.js";
import { findRecipientSuppression, renewAppointmentEmailClaim } from "../../src/repositories/transactional-email-repository.js";
import { processTransactionalEmailById } from "../../src/services/transactional-email-service.js";
import { database, data, ids } from "../prescriptions/helpers.js";
import { evaluation } from "../evaluation-data.js";
import { fixtureRut } from "../rut-fixture.js";
import { readAccountPrescription } from "../../src/services/account-prescription-service.js";
import { claimAccountPrescriptionReading, finishAccountPrescriptionReading } from "../../src/repositories/account-prescription-repository.js";
import { createDependantLinkChallenge, verifyDependantLinkChallenge } from "../../src/repositories/account-family-repository.js";
import { image, prescription as opticalPrescription } from "../prescriptions/helpers.js";

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
    body: { firstNames: "Cliente", lastNames: "Sintético", birthDate: "1999-09-09", rut, email, password, phone: "+56912345678", address: "Dirección de prueba" },
  });
  const { account } = await data(response, 201);
  return { account, rut, email, cookie: response.headers.getSetCookie()[0].split(";")[0] };
}

test("Mi cuenta conserva los permisos al descargar y usar recetas, cambiar horas y editar contacto", { skip: !base }, async (t) => {
  const db = database();
  t.after(() => db.$disconnect());
  t.after(disconnectPrisma);
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

  await t.test("solo la cuenta vinculada puede descargar una receta vigente y asociarla a su carrito", async (t) => {
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

    await t.test("una receta anulada impide finalizar la compra y conserva el carrito configurado", async () => {
      const branches = await data(await request("/api/store/cart/pickup", { cookie }));
      const pickup = branches.find((branch) => branch.available);
      assert.ok(pickup);
      const configured = await data(await request("/api/store/cart", {
        cookie, method: "PATCH", body: {
          buyer: {
            rut: owner.rut, firstNames: "Cliente", lastNames: "Sintético", email: owner.email,
            phone: "+56912345678", address: "Dirección de prueba",
          },
          fulfillment: { method: "PICKUP", branchId: pickup.id },
          clinicalPrescriptionId: prescription.id,
        },
      }));
      assert.equal(configured.clinicalPrescriptionId, prescription.id);
      await db.optical_prescriptions.update({ where: { id: prescription.id }, data: { status: "VOIDED", voided_at: new Date() } });
      assert.equal((await request(pdfPath, { cookie: owner.cookie })).status, 404);

      const checkout = await request("/api/store/cart/checkout", { cookie, method: "POST" });
      const checkoutError = await checkout.json();
      assert.equal(checkout.status, 404, JSON.stringify(checkoutError));
      assert.equal(checkoutError.error.code, "CLINICAL_PRESCRIPTION_NOT_AVAILABLE");
      const preserved = await data(await request("/api/store/cart", { cookie }));
      assert.equal(preserved.status, "ACTIVE");
      assert.equal(preserved.saleId, null);
      assert.equal(preserved.clinicalPrescriptionId, prescription.id);
      assert.deepEqual(preserved.items, configured.items);
      assert.deepEqual(preserved.buyer, configured.buyer);
      assert.deepEqual(preserved.fulfillment, configured.fulfillment);
      assert.equal(await db.sales.count({ where: { customer_id: owner.account.customerId } }), 0);
    });
  });

  await t.test("actualiza únicamente el contacto comercial de la cuenta autenticada", async () => {
    const endpoint = "/api/store/accounts/me";
    assert.equal((await request(endpoint, { method: "PATCH", body: { address: "Sin sesión" } })).status, 401);
    await db.customer_accounts.update({ where: { id: owner.account.id }, data: { birth_date: null } });
    const profile = await data(await request(endpoint, { cookie: owner.cookie, method: "PATCH", body: { address: "Dirección sintética actualizada", email: other.email } }));
    assert.equal(profile.address, "Dirección sintética actualizada");
    assert.equal(profile.email, owner.email);
    assert.equal(profile.birthDate, "1999-09-09");
    assert.equal(profile.requiresAgeConfirmation, false);
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

    const reminder = await db.transactional_email_outbox.create({
      data: {
        appointment_id: appointment.id, template_code: "APPOINTMENT_REMINDER",
        deduplication_key: "portal-race:" + appointment.id, recipient_email: owner.email,
        payload: { appointmentId: appointment.id, startAt: from.startAt, endAt: from.endAt },
      },
    });
    await db.transactional_email_outbox.create({
      data: {
        appointment_id: appointment.id, template_code: "APPOINTMENT_CONFIRMED", status: "FAILED", delivery_mode: "live",
        deduplication_key: "portal-retry:" + appointment.id, recipient_email: owner.email,
        payload: { appointmentId: appointment.id, startAt: from.startAt, endAt: from.endAt },
      },
    });
    const claimRenewed = Promise.withResolvers();
    const allowSend = Promise.withResolvers();
    let deliveries = 0;
    const dispatch = processTransactionalEmailById(reminder.id, {
      config: {
        mode: "live", timeoutMs: 8000, batchSize: 1, lockSeconds: 60, maxAttempts: 3,
        retryBaseSeconds: 30, maxRetrySeconds: 3600, timeZone: "America/Santiago",
      },
      provider: { async send() {
        deliveries++;
        return { provider: "RESEND", providerMessageId: "synthetic-" + reminder.id };
      } },
      logger: { info() {} },
      async renewAppointmentClaim(...args) {
        const expiry = await renewAppointmentEmailClaim(...args);
        claimRenewed.resolve(expiry);
        await allowSend.promise;
        return expiry;
      },
    });
    try {
      const expiry = await Promise.race([claimRenewed.promise, dispatch.then(() => null)]);
      assert.ok(expiry, "el worker debe quedar detenido entre la última validación y el envío");
      const inProgress = await request(endpoint, { cookie: owner.cookie, method: "PATCH", body: reschedule });
      assert.equal(inProgress.status, 409);
      assert.equal((await inProgress.json()).error.code, "CUSTOMER_APPOINTMENT_EMAIL_PROCESSING");
      assert.equal((await db.appointments.findUniqueOrThrow({ where: { id: appointment.id } })).start_at.toISOString(), from.startAt);
      assert.equal(await db.appointment_events.count({ where: { appointment_id: appointment.id } }), 0);
      assert.equal(deliveries, 0);
    } finally {
      allowSend.resolve();
      await dispatch;
    }
    assert.equal(deliveries, 1);
    assert.equal((await db.transactional_email_outbox.findUniqueOrThrow({ where: { id: reminder.id } })).status, "SENT");

    await data(await request(endpoint, { cookie: owner.cookie, method: "PATCH", body: reschedule }));
    const confirmation = await db.transactional_email_outbox.findFirstOrThrow({
      where: { appointment_id: appointment.id, template_code: "APPOINTMENT_CONFIRMED", status: "PENDING" },
    });
    assert.equal(await findRecipientSuppression(confirmation.id, owner.email), null);
    assert.equal((await request(endpoint, { cookie: owner.cookie, method: "PATCH", body: reschedule })).status, 409);
    await data(await request(endpoint, { cookie: owner.cookie, method: "PATCH", body: { action: "CANCEL", expectedStartAt: to.startAt } }));
    const saved = await db.appointments.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(saved.status, "CANCELLED");
    assert.equal(saved.start_at.toISOString(), to.startAt);
    assert.equal(await db.appointment_events.count({ where: { appointment_id: appointment.id } }), 2);
    assert.equal(await db.transactional_email_outbox.count({ where: { appointment_id: appointment.id, status: "SUPPRESSED" } }), 3);
  });

  await t.test("guarda una receta externa sin agendar, reutiliza la lectura de OpenAI y conserva su copia al usarla en el carrito", async () => {
    const endpoint = "/api/store/accounts/me/prescriptions";
    const imageForm = new FormData();
    imageForm.set("image", new File([image], "receta-sintetica.png", { type: "image/png" }));
    const uploadedResponse = await fetch(base + endpoint, { method: "POST", headers: { cookie: owner.cookie }, body: imageForm });
    const uploaded = await data(uploadedResponse, 201);
    assert.equal(uploaded.status, "DRAFT");
    assert.equal((await data(await request(endpoint, { cookie: owner.cookie }))).length, 1);
    assert.deepEqual(await data(await request(endpoint, { cookie: other.cookie })), []);
    assert.equal((await request(endpoint + "/" + uploaded.id, { cookie: other.cookie })).status, 404);
    assert.equal((await request(endpoint + "/" + uploaded.id)).status, 401);
    assert.equal((await request(endpoint + "/" + uploaded.id, { cookie: owner.cookie })).status, 200);

    const unavailableReading = await request(endpoint + "/" + uploaded.id + "/read", { cookie: owner.cookie, method: "POST" });
    assert.equal(unavailableReading.status, 503);
    assert.match((await unavailableReading.json()).error.message, /archivo sigue guardado/);
    assert.equal((await db.external_prescriptions.findUniqueOrThrow({ where: { id: uploaded.id } })).extraction_status, "FAILED");
    const expiredWorker = await claimAccountPrescriptionReading(owner.account.id, uploaded.id);
    assert.equal((await claimAccountPrescriptionReading(owner.account.id, uploaded.id)).reason, "READING");
    const activeWorker = await claimAccountPrescriptionReading(owner.account.id, uploaded.id, new Date(Date.now() + 121_000));
    assert.ok(activeWorker.requestId);
    assert.notEqual(expiredWorker.requestId, activeWorker.requestId);
    assert.equal(await finishAccountPrescriptionReading(owner.account.id, uploaded.id, expiredWorker.requestId, { provider: "OPENAI_GPT_5_6_LUNA", data: opticalPrescription }), null);
    assert.equal(await finishAccountPrescriptionReading(owner.account.id, uploaded.id, expiredWorker.requestId, null), null);
    await finishAccountPrescriptionReading(owner.account.id, uploaded.id, activeWorker.requestId, null);

    let reads = 0;
    const dependencies = { readImage: async (source) => {
      reads++;
      assert.equal(source.mediaType, "image/png");
      return { provider: "OPENAI_GPT_5_6_LUNA", data: { ...opticalPrescription, confidence: "HIGH", warnings: [] } };
    } };
    const read = await readAccountPrescription(owner.account, uploaded.id, dependencies);
    assert.equal(read.extractionStatus, "COMPLETED");
    await readAccountPrescription(owner.account, uploaded.id, dependencies);
    assert.equal(reads, 1);
    await assert.rejects(() => readAccountPrescription(other.account, uploaded.id, dependencies), { status: 404 });
    assert.equal(reads, 1);
    const reviewed = await data(await request(endpoint + "/" + uploaded.id, {
      cookie: owner.cookie, method: "PATCH", body: { ...opticalPrescription, imageHash: uploaded.imageHash },
    }));
    assert.equal(reviewed.status, "READY");

    const cartResponse = await request("/api/store/cart", { cookie: owner.cookie, method: "POST" });
    const currentCart = await data(cartResponse, 201);
    const cookie = owner.cookie + "; " + cartResponse.headers.getSetCookie()[0].split(";")[0];
    const applied = await data(await request("/api/store/cart/prescription/saved", {
      cookie, method: "PUT", body: { prescriptionId: uploaded.id, replaceExisting: true },
    }));
    assert.equal(applied.externalPrescription.status, "READY");
    assert.deepEqual(applied.items, currentCart.items);
    assert.notEqual(applied.externalPrescription.id, uploaded.id);
    await data(await request("/api/store/cart/prescription/image", { cookie, method: "DELETE" }));
    assert.equal((await data(await request(endpoint, { cookie: owner.cookie })))[0].status, "READY");
    assert.equal((await request(endpoint + "/" + uploaded.id, { cookie: owner.cookie })).status, 200);
  });

  await t.test("solo el adulto registrado y verificado accede a recetas y atenciones del menor", async () => {
    const childRut = fixtureRut(9763);
    const child = await db.patients.create({ data: {
      rut: childRut, first_names: "Menor", last_names: "Sintético", birth_date: new Date("2015-05-10"),
      email: owner.email, phone: "+56912345678", address: "Dirección sintética",
      patient_guardians: { create: {
        rut: owner.rut, first_names: "Cliente", last_names: "Sintético", relationship: "Padre",
        email: owner.email, phone: "+56912345678",
      } },
    } });
    const childEncounter = await db.clinical_encounters.create({ data: {
      patient_id: child.id, professional_id: professionalId, reason_for_visit: "Evaluación sintética del menor",
      status: "FINALIZED", finalized_at: new Date(), created_by: professionalId, updated_by: professionalId,
    } });
    const childPrescription = await db.optical_prescriptions.create({ data: {
      encounter_id: childEncounter.id, issued_by: professionalId, version: 1,
      right_sphere: -1, right_cylinder: 0, left_sphere: -1, left_cylinder: 0,
    } });
    const childInput = { rut: childRut, firstNames: "Menor", lastNames: "Sintético", birthDate: "2015-05-10", relationship: "Padre" };
    const dependant = await data(await request("/api/store/accounts/me/dependants", { cookie: owner.cookie, method: "POST", body: childInput }), 201);
    const foreignDependant = await data(await request("/api/store/accounts/me/dependants", { cookie: other.cookie, method: "POST", body: childInput }), 201);
    const childPath = clinical + "?dependantId=" + dependant.id;
    assert.equal((await data(await request(childPath, { cookie: owner.cookie }))).linked, false);
    const environment = { CUSTOMER_PATIENT_OTP_SECRET: "secreto-sintetico-solo-para-la-prueba-9763" };
    const challenge = await createDependantLinkChallenge(owner.account.id, dependant.id, environment);
    const outbox = await db.transactional_email_outbox.findUniqueOrThrow({ where: { id: challenge.outboxId } });
    assert.equal(await createDependantLinkChallenge(other.account.id, foreignDependant.id, environment), null);
    assert.equal(await verifyDependantLinkChallenge(other.account.id, dependant.id, outbox.payload.code, environment), false);
    assert.equal(await verifyDependantLinkChallenge(owner.account.id, dependant.id, outbox.payload.code, environment), true);
    assert.equal(await verifyDependantLinkChallenge(owner.account.id, dependant.id, outbox.payload.code, environment), false);
    const childOverview = await data(await request(childPath, { cookie: owner.cookie }));
    assert.equal(childOverview.linked, true);
    assert.equal(childOverview.prescriptions.active[0].id, childPrescription.id);
    assert.equal(childOverview.encounters[0].reason, "Evaluación sintética del menor");
    assert.equal((await data(await request(childPath, { cookie: other.cookie }))).linked, false);
    const pdf = clinical + "/prescriptions/" + childPrescription.id + "/pdf";
    assert.equal((await request(pdf, { cookie: owner.cookie })).status, 200);
    assert.equal((await request(pdf, { cookie: other.cookie })).status, 404);
    const cartResponse = await request("/api/store/cart", { cookie: owner.cookie, method: "POST" });
    await data(cartResponse, 201);
    const cartCookie = owner.cookie + "; " + cartResponse.headers.getSetCookie()[0].split(";")[0];
    await data(await request("/api/store/cart/prescription/clinical", { cookie: cartCookie, method: "PUT", body: { prescriptionId: childPrescription.id } }));
    const branches = await data(await request("/api/store/cart/pickup", { cookie: cartCookie }));
    await data(await request("/api/store/cart", { cookie: cartCookie, method: "PATCH", body: {
      buyer: { rut: owner.rut, firstNames: "Cliente", lastNames: "Sintético", email: owner.email, phone: "+56912345678", address: "Dirección sintética" },
      fulfillment: { method: "PICKUP", branchId: branches.find((branch) => branch.available).id },
      clinicalPrescriptionId: childPrescription.id,
    } }));
    const checkout = await data(await request("/api/store/cart/checkout", { cookie: cartCookie, method: "POST" }), 201);
    const sale = await db.sales.findUniqueOrThrow({ where: { id: checkout.order.id } });
    assert.equal(sale.customer_id, owner.account.customerId);
    assert.equal(sale.patient_id, child.id);
    assert.equal(sale.prescription_id, childPrescription.id);
    await db.patient_guardians.update({ where: { patient_id: child.id }, data: { account_id: null, email: "otro-responsable@example.invalid" } });
    assert.equal((await data(await request(childPath, { cookie: owner.cookie }))).linked, false);
    assert.equal((await request(pdf, { cookie: owner.cookie })).status, 404);
  });

  await t.test("rechaza cuentas nuevas de menores y cierra el acceso si la ficha identifica un menor", async () => {
    const minorRegistration = await request("/api/store/accounts/register", { method: "POST", body: {
      rut: fixtureRut(9764), email: "menor-" + randomUUID() + "@example.invalid", birthDate: "2015-01-01",
      firstNames: "Menor", lastNames: "Sintético", password, phone: "+56912345678", address: "Dirección sintética",
    } });
    assert.equal(minorRegistration.status, 400);
    assert.equal((await minorRegistration.json()).error.code, "ADULT_ACCOUNT_REQUIRED");
    const legacy = await register(9765);
    const minorPatient = await db.patients.create({ data: {
      rut: legacy.rut, first_names: "Menor", last_names: "Sintético", birth_date: new Date("2015-01-01"),
      email: legacy.email, phone: "+56912345678", address: "Dirección sintética",
    } });
    await db.customers.update({ where: { id: legacy.account.customerId }, data: { patient_id: minorPatient.id } });
    assert.equal((await request("/api/store/accounts/me", { cookie: legacy.cookie })).status, 401);
    const login = await request("/api/store/accounts/login", { method: "POST", body: { email: legacy.email, password } });
    assert.equal(login.status, 403);
    assert.equal((await login.json()).error.code, "ADULT_ACCOUNT_REQUIRED");
  });
});
