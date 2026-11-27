import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../src/db/prisma.js";
import { PROFESSIONAL_APPOINTMENT_EMAIL as template } from "../../src/repositories/appointment-email-repository.js";
import { claimTransactionalEmailBatch, mapEmail, getTransactionalEmailEligibility, renewAppointmentEmailClaim } from "../../src/repositories/transactional-email-repository.js";
import { changeAppointmentStatus, createAppointment, updateAppointment } from "../../src/services/appointment-service.js";
import { manageCustomerAppointment } from "../../src/services/customer-appointment-service.js";
import { createPublicBooking } from "../../src/services/public-booking-service.js";
import { processTransactionalEmailById } from "../../src/services/transactional-email-service.js";
import { ids, seedAcademicData } from "../fixtures/academic-data.js";

const first = "academic-profesional@example.invalid";
const second = "academic-profesionalajeno@example.invalid";
const booking = (day, time = "09:00") => `2030-08-${day}T${time}:00-04:00`;
const dependencies = { currentDate: new Date("2030-08-01T00:00:00Z") };
const rowsFor = (appointment_id) => prisma.transactional_email_outbox.findMany({ where: { appointment_id } });
const notice = (id, action) => prisma.transactional_email_outbox.findFirstOrThrow({
  where: { appointment_id: id, template_code: template, payload: { path: ["action"], equals: action } },
});
const dispatchDependencies = {
  config: {
    mode: "live", apiKey: "clave-completamente-sintetica", from: "Prueba <prueba@example.invalid>",
    timeoutMs: 1000, batchSize: 1, lockSeconds: 60, maxAttempts: 3,
    retryBaseSeconds: 30, maxRetrySeconds: 3600, timeZone: "America/Santiago",
  },
  logger: { info() {} },
};

test("avisos a profesionales con una cola PostgreSQL exclusiva y proveedor simulado", {
  skip: process.env.ACADEMIC_ISOLATION !== "true",
}, async (t) => {
  const { admin, professional } = await seedAcademicData();
  const create = (day) => createAppointment({
    branchId: ids.branch, patientId: ids.patient, professionalId: ids.professional,
    startAt: booking(day), internalNotes: "Nota clínica ficticia y privada",
  }, admin, dependencies);

  try {
    await t.test("crear en Agenda agrega solo un aviso profesional y conserva el par del paciente", async () => {
      const appointment = await create("12");
      const rows = await rowsFor(appointment.id);
      assert.deepEqual(rows.map((row) => row.template_code).sort(), ["APPOINTMENT_CONFIRMED", template, "APPOINTMENT_REMINDER"]);
      const email = await notice(appointment.id, "confirmed");
      assert.equal(email.recipient_email, first);
      assert.equal(email.status, "PENDING");
      assert.deepEqual(Object.keys(email.payload).sort(), ["action", "professionalId", "startAt"]);
      assert.ok(rows.filter((row) => row.template_code !== template).every((row) => row.recipient_email === "pacienteficticio@example.invalid"));
      await assert.rejects(create("12"), { code: "APPOINTMENT_TIME_NOT_AVAILABLE" });
      assert.equal((await rowsFor(appointment.id)).length, 3);
      assert.equal(await prisma.appointments.count({ where: { professional_id: ids.professional, start_at: appointment.startAt } }), 1);
    });

    await t.test("la reserva pública y Mis horas mantienen los correos del paciente y suprimen los avisos antiguos", async () => {
      const patient = await prisma.patients.findUniqueOrThrow({ where: { id: ids.patient } });
      const { appointment } = await createPublicBooking({
        acceptsPrivacy: true, branchId: ids.branch, professionalId: ids.professional, startAt: booking("13"),
        patient: { rut: patient.rut, firstNames: patient.first_names, lastNames: patient.last_names,
          birthDate: patient.birth_date.toISOString().slice(0, 10), phone: patient.phone, email: patient.email, address: patient.address },
      }, dependencies);
      assert.equal((await notice(appointment.id, "confirmed")).recipient_email, first);
      await prisma.customers.update({ where: { id: ids.customer }, data: { patient_id: ids.patient } });
      const account = await prisma.customer_accounts.create({ data: {
        customer_id: ids.customer, email: "cuenta-profesionales@example.invalid",
        password_hash: (await prisma.users.findUniqueOrThrow({ where: { id: ids.admin } })).password_hash,
      } });
      const expectedStartAt = appointment.startAt.toISOString();
      const startAt = booking("14");
      const rebook = { action: "RESCHEDULE", expectedStartAt, startAt };
      await assert.rejects(manageCustomerAppointment({ id: ids.otherPatient }, appointment.id, rebook), { code: "CUSTOMER_APPOINTMENT_NOT_FOUND" });
      await manageCustomerAppointment(account, appointment.id, rebook);
      const update = await notice(appointment.id, "rescheduled");
      assert.equal(update.payload.previousStartAt, expectedStartAt);
      assert.equal(update.payload.startAt, new Date(startAt).toISOString());
      assert.equal((await notice(appointment.id, "confirmed")).status, "SUPPRESSED");
      const updatedPatient = (await rowsFor(appointment.id)).filter((row) => row.template_code !== template && row.status === "PENDING");
      assert.deepEqual(updatedPatient.map((row) => row.template_code).sort(), ["APPOINTMENT_CONFIRMED", "APPOINTMENT_REMINDER"]);
      await manageCustomerAppointment(account, appointment.id, { action: "CANCEL", expectedStartAt: new Date(startAt).toISOString() });
      const cancelled = await notice(appointment.id, "cancelled");
      assert.equal(cancelled.recipient_email, first);
      const rows = await rowsFor(appointment.id);
      assert.deepEqual(rows.filter((row) => row.status !== "SUPPRESSED").map((row) => row.id), [cancelled.id]);
      assert.equal(await prisma.transactional_email_transitions.count({
        where: { email_id: update.id, to_status: "SUPPRESSED", reason_code: "APPOINTMENT_CANCELLED" },
      }), 1);
    });

    await t.test("reasigna al profesional correcto, avisa al anterior y cancela sin reactivar correos", async () => {
      const appointment = await create("15");
      await assert.rejects(updateAppointment(appointment.id, { professionalId: ids.otherProfessional }, professional, dependencies),
        { code: "INSUFFICIENT_PERMISSIONS" });
      await assert.rejects(updateAppointment(appointment.id, { professionalId: ids.sales }, admin, dependencies));
      assert.equal((await rowsFor(appointment.id)).length, 3);
      await updateAppointment(appointment.id, { startAt: booking("15", "10:30") }, admin, dependencies);
      assert.equal((await notice(appointment.id, "rescheduled")).recipient_email, first);
      const result = await updateAppointment(appointment.id, {
        professionalId: ids.otherProfessional, startAt: booking("15", "11:30"),
      }, admin, dependencies);
      assert.equal(result.professional.id, ids.otherProfessional);
      const assigned = await notice(appointment.id, "assigned");
      const released = await notice(appointment.id, "released");
      assert.equal(assigned.recipient_email, second);
      assert.equal(released.recipient_email, first);
      assert.equal(released.payload.startAt, new Date(booking("15", "10:30")).toISOString());
      assert.equal(released.payload.previousStartAt, undefined);
      assert.equal((await notice(appointment.id, "rescheduled")).status, "SUPPRESSED");
      const wrong = await getTransactionalEmailEligibility({ ...mapEmail(assigned), recipientEmail: first });
      assert.equal(wrong.reason, "APPOINTMENT_PROFESSIONAL_RECIPIENT_CHANGED");
      assert.equal((await getTransactionalEmailEligibility(mapEmail(released))).eligible, true);
      await updateAppointment(appointment.id, { professionalId: ids.otherProfessional }, admin, dependencies);
      assert.equal((await rowsFor(appointment.id)).filter((row) => row.payload.action === "assigned").length, 1);
      await changeAppointmentStatus(appointment.id, { status: "CANCELLED", cancellationReason: "Motivo privado sintético" }, admin, dependencies);
      assert.equal((await notice(appointment.id, "cancelled")).recipient_email, second);
      assert.equal((await notice(appointment.id, "assigned")).status, "SUPPRESSED");
      assert.equal((await getTransactionalEmailEligibility(mapEmail(assigned))).eligible, false);
      assert.equal((await notice(appointment.id, "cancelled")).payload.cancellationReason, undefined);
    });

    await t.test("la dirección profesional no utilizable omite el aviso y conserva la reserva", async () => {
      await prisma.users.update({ where: { id: ids.professional }, data: { email: "sin-correo-sintetico" } });
      try {
        const appointment = await create("16");
        assert.equal(appointment.status, "CONFIRMED");
        assert.deepEqual((await rowsFor(appointment.id)).map((row) => row.template_code).sort(), ["APPOINTMENT_CONFIRMED", "APPOINTMENT_REMINDER"]);
      } finally {
        await prisma.users.update({ where: { id: ids.professional }, data: { email: first } });
      }
    });

    await t.test("un envío activo impide que se confirme un cambio obsoleto y un claim vencido no se renueva", async () => {
      const appointment = await create("19");
      const email = await notice(appointment.id, "confirmed");
      const workerId = "af700000-0000-4000-8000-000000000001";
      const { emails } = await claimTransactionalEmailBatch({ deliveryMode: "live", emailId: email.id, limit: 1, lockSeconds: 60, workerId });
      assert.equal(emails.length, 1);
      const cancel = () => changeAppointmentStatus(appointment.id, { status: "CANCELLED", cancellationReason: "Prueba sintética" }, admin, dependencies);
      await assert.rejects(cancel(), { code: "APPOINTMENT_EMAIL_PROCESSING" });
      assert.equal((await prisma.appointments.findUniqueOrThrow({ where: { id: appointment.id } })).status, "CONFIRMED");
      await prisma.transactional_email_outbox.update({ where: { id: email.id }, data: { lock_expires_at: new Date() } });
      await cancel();
      assert.equal((await notice(appointment.id, "confirmed")).status, "SUPPRESSED");
      assert.equal(await renewAppointmentEmailClaim(email.id, workerId, 60), null);
    });

    await t.test("Resend 503 deja un reintento con la misma clave y la reserva confirmada", async () => {
      const appointment = await create("17");
      const email = await notice(appointment.id, "confirmed");
      const requests = [];
      const dispatch = () => processTransactionalEmailById(email.id, {
        ...dispatchDependencies,
        providerDependencies: { async fetch(url, init) {
          requests.push({ url, key: init.headers["Idempotency-Key"], body: JSON.parse(init.body) });
          return requests.length === 1
            ? Response.json({ name: "internal_server_error" }, { status: 503 })
            : Response.json({ id: "resend-sintetico-503" });
        } },
      });
      assert.equal((await dispatch()).failed, 1);
      const failed = await notice(appointment.id, "confirmed");
      assert.equal(failed.status, "FAILED");
      assert.ok(failed.next_attempt_at > new Date());
      assert.equal((await dispatch()).claimed, 0);
      assert.equal((await prisma.appointments.findUniqueOrThrow({ where: { id: appointment.id } })).status, "CONFIRMED");
      await prisma.transactional_email_outbox.update({ where: { id: email.id }, data: { next_attempt_at: new Date(0) } });
      assert.equal((await dispatch()).sent, 1);
      assert.equal((await dispatch()).claimed, 0);
      assert.equal(requests.length, 2);
      assert.equal(requests[0].key, requests[1].key);
      assert.deepEqual(requests[1].body.to, [first]);
      assert.match(requests[1].body.text, /PacienteFicticio Demostración/);
      assert.match(requests[1].body.text, /Sucursal clínica de pruebas/);
      assert.doesNotMatch(requests[1].body.text, /Nota clínica ficticia|Dirección ficticia/);
      assert.equal((await notice(appointment.id, "confirmed")).provider_message_id, "resend-sintetico-503");
    });
  } finally {
    await prisma.$disconnect();
  }
});
