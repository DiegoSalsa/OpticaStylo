import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { prisma } from "../../src/db/prisma.js";
import { hashPassword } from "../../src/auth/password.js";
import { fixtureRut } from "../rut-fixture.js";
import { ids, requireAcademicIsolation } from "./academic-data.js";

const past = new Date("2025-04-15T16:00:00Z");
const day = 86_400_000;
const adultDob = new Date("1989-02-10");
const childDob = new Date("2016-08-14");

export async function seedAccountHistory() {
  requireAcademicIsolation();
  const tag = randomBytes(4).toString("hex");
  const password = "CuentaLocal-" + randomBytes(18).toString("hex") + "!";
  const passwordHash = await hashPassword(password);
  let rutIndex = randomInt(500_000, 900_000);

  function person(name, email, minor = false) {
    return {
      id: randomUUID(), rut: fixtureRut(rutIndex++), first_names: name, last_names: "Sintético",
      email, address: "Dirección de ensayo", phone: "+56912345678", birth_date: minor ? childDob : adultDob,
    };
  }

  return prisma.$transaction(async (client) => {
    async function family(label) {
      const email = "paginacion-" + tag + "-" + label.toLowerCase() + "@example.invalid";
      const patient = person("Adulto " + label, email);
      const minor = person("Menor " + label, email, true);
      await client.patients.createMany({ data: [patient, minor] });
      const customer = await client.customers.create({ data: {
        patient_id: patient.id, rut: patient.rut, first_names: patient.first_names, last_names: patient.last_names,
        email, phone: patient.phone, address: patient.address,
      } });
      const account = await client.customer_accounts.create({ data: {
        customer_id: customer.id, email, password_hash: passwordHash, birth_date: adultDob, email_verified_at: new Date(),
      } });
      await client.patient_guardians.create({ data: {
        patient_id: minor.id, account_id: account.id, rut: patient.rut, first_names: patient.first_names,
        last_names: patient.last_names, relationship: "Madre", email, phone: patient.phone,
      } });
      const dependant = await client.customer_dependants.create({ data: {
        account_id: account.id, patient_id: minor.id, rut: minor.rut, first_names: minor.first_names,
        last_names: minor.last_names, birth_date: minor.birth_date, relationship: "Madre",
      } });
      return { account, patient, minor, dependant, email };
    }

    const owner = await family("A");
    const other = await family("B");
    const unverified = person("Menor sin verificación", other.email, true);
    await client.patients.create({ data: unverified });
    await client.patient_guardians.create({ data: {
      patient_id: unverified.id, rut: other.patient.rut, first_names: other.patient.first_names,
      last_names: other.patient.last_names, relationship: "Madre", email: other.email, phone: other.patient.phone,
    } });
    const unverifiedProfile = await client.customer_dependants.create({ data: {
      account_id: owner.account.id, patient_id: unverified.id, rut: unverified.rut, first_names: unverified.first_names,
      last_names: unverified.last_names, birth_date: unverified.birth_date, relationship: "Madre",
    } });

    const appointment = (patient, status, time) => ({
      id: randomUUID(), patient_id: patient.id, professional_id: ids.professional, status,
      start_at: time, end_at: new Date(time.getTime() + 30 * 60_000),
      internal_notes: "Nota privada sintética",
      ...(status === "CANCELLED" && { cancelled_at: past, cancellation_reason: "Motivo privado sintético" }),
    });
    const future = new Date(Date.now() + 12 * day);
    const cancelled = appointment(owner.patient, "CANCELLED", future);
    const history = [
      ...Array.from({ length: 121 }, () => appointment(owner.patient, "COMPLETED", past)),
      appointment(owner.patient, "NO_SHOW", past),
      cancelled,
    ];
    const upcoming = Array.from({ length: 22 }, (_, index) => appointment(owner.patient, "CONFIRMED", new Date(future.getTime() + index * day)));
    const otherAppointment = appointment(other.patient, "COMPLETED", past);
    await client.appointments.createMany({ data: [...history, ...upcoming, otherAppointment] });

    const encounter = (patient, label, when = past) => ({
      id: randomUUID(), patient_id: patient.id, professional_id: ids.professional,
      created_by: ids.professional, updated_by: ids.professional, status: "FINALIZED",
      finalized_at: when, reason_for_visit: label, diagnosis: "Diagnóstico privado sintético",
    });
    const minorHistory = Array.from({ length: 123 }, (_, index) => encounter(owner.minor, "Atención sintética " + (index + 1)));
    const otherEncounter = encounter(other.minor, "Atención exclusiva menor B");
    const unverifiedEncounter = encounter(unverified, "Atención con vínculo no verificado");
    const historicalEncounter = encounter(owner.patient, "Recetas anteriores");
    const activeEncounters = Array.from({ length: 23 }, () => encounter(owner.patient, "Receta vigente"));
    await client.clinical_encounters.createMany({
      data: [...minorHistory, otherEncounter, unverifiedEncounter, historicalEncounter, ...activeEncounters],
    });

    const prescription = (enc, version, issuedAt) => ({
      id: randomUUID(), encounter_id: enc.id, issued_by: ids.professional, version, issued_at: issuedAt,
      right_sphere: -1.25, right_cylinder: 0, left_sphere: -1, left_cylinder: 0,
      fulfillment_notes: "Valores sintéticos de prueba",
    });
    const old = Array.from({ length: 123 }, (_, index) => ({
      ...prescription(historicalEncounter, index + 1, past), status: "VOIDED", voided_at: new Date("2025-05-01"),
    }));
    const live = activeEncounters.map((enc, index) => prescription(enc, 1, new Date(past.getTime() - index * day)));
    const oldestActive = live.at(-1);
    const childPrescription = prescription(minorHistory[0], 1, past);
    await client.optical_prescriptions.createMany({ data: [...old, ...live, childPrescription] });

    const product = await client.products.create({ data: {
      sku: "CUENTA-" + tag.toUpperCase(), name: "Cristal sintético para recetas", category: "PRESCRIPTION_LENS",
      inventory_mode: "ON_DEMAND", requires_prescription: true, is_test_data: true, unit_price_cents: 1000,
      created_by: ids.admin, updated_by: ids.admin,
    } });
    const frame = await client.products.create({ data: {
      sku: "MARCO-" + tag.toUpperCase(), name: "Marco sintético para recetas", category: "FRAME",
      inventory_mode: "ON_DEMAND", is_test_data: true, unit_price_cents: 1000, created_by: ids.admin, updated_by: ids.admin,
    } });
    const ordered = (rows, field) => [...rows].sort((a, b) => b[field] - a[field] || b.id.localeCompare(a.id)).map((row) => row.id);
    return {
      owner, other, unverifiedProfile, password, product, frame, cancelled, upcoming, oldestActive, childPrescription,
      appointmentIds: ordered(history, "start_at"), prescriptionIds: old.map((row) => row.id).reverse(),
      encounterIds: ordered(minorHistory, "finalized_at"),
    };
  }, { timeout: 15000 });
}
