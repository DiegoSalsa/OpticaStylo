import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../../src/auth/password.js";
import { prisma } from "../../src/db/prisma.js";
import { ids, requireAcademicIsolation } from "./academic-data.js";
import { fixtureRut } from "./management-data.js";

export async function seedBranchIsolation() {
  requireAcademicIsolation();
  const tag = randomBytes(4).toString("hex");
  const password = randomBytes(20).toString("hex");
  const passwordHash = await hashPassword(password);
  const branch = (name) => ({
    id: randomUUID(), code: tag + "-" + name, name: name + " sintética " + tag,
    information_source: "Datos sintéticos", address: "Dirección de prueba", pickup_enabled: true,
  });
  const romano = branch("Romano"), palet = branch("Palet"), barros = branch("Barros");
  const staff = (name, roles, sites) => ({ id: randomUUID(), email: name + "-" + tag + "@example.invalid", roles, sites, name });
  const adminA = staff("admina", ["BRANCH_ADMIN"], [romano]);
  const adminB = staff("adminb", ["BRANCH_ADMIN"], [palet]);
  const sales = staff("ventas", ["SALES"], [romano, barros]);
  const salesBarros = staff("ventasbarros", ["SALES"], [barros]);
  const doctorA = staff("clinicoa", ["CLINICAL_PROFESSIONAL"], [romano]);
  const doctorAB = staff("clinicoab", ["CLINICAL_PROFESSIONAL"], [romano, palet]);
  const customerA = randomUUID(), customerB = randomUUID(), patientAB = randomUUID(), patientB = randomUUID();
  const saleA = randomUUID(), saleB = randomUUID(), saleLegacy = randomUUID();
  const skuA = "ROM-" + tag.toUpperCase(), skuB = "PAL-" + tag.toUpperCase();
  const terminalId = randomUUID(), cashB = randomUUID();
  const buyerEmail = "comprador-" + tag + "@example.invalid";
  const buyerRut = fixtureRut(38000 + Number.parseInt(tag.slice(0, 5), 16));
  const otherBuyer = { id: randomUUID(), email: "otro-" + tag + "@example.invalid", rut: fixtureRut(4_000_000 + Number.parseInt(tag.slice(0, 5), 16)) };
  const now = new Date();
  const patient = (id, rut, name) => ({ id, rut, first_names: name, last_names: "Sintético", phone: "+56912345678", email: id + "@example.invalid", address: "Dirección de ensayo", birth_date: new Date("1990-01-01") });
  const sale = (id, customer_id, branch_id, amount) => ({
    id, customer_id, branch_id, status: "PAID", created_by: ids.admin, updated_by: ids.admin, subtotal_cents: amount, total_cents: amount,
  });
  const appointment = (site, professional, patient_id, offset) => ({
    id: randomUUID(), patient_id, professional_id: professional.id, branch_id: site.id,
    start_at: new Date(now.getTime() - offset * 86_400_000), end_at: new Date(now.getTime() - offset * 86_400_000 + 1_800_000),
    status: "COMPLETED", internal_notes: "Información sintética de agenda " + site.code,
  });
  const appointmentA = appointment(romano, doctorA, patientAB, 5);
  const appointmentOtherA = appointment(romano, doctorAB, patientAB, 4);
  const appointmentB = appointment(palet, doctorAB, patientAB, 3);
  const appointmentOnlyB = appointment(palet, doctorAB, patientB, 2);
  const encounter = (slot, label) => ({
    id: randomUUID(), appointment_id: slot.id, patient_id: slot.patient_id, professional_id: slot.professional_id,
    branch_id: slot.branch_id, created_by: slot.professional_id, updated_by: slot.professional_id,
    status: "FINALIZED", finalized_at: now, reason_for_visit: label,
  });
  const encounterA = encounter(appointmentA, "Atención privada de Romano");
  const encounterB = encounter(appointmentB, "Atención privada de Palet");
  await prisma.$transaction(async (client) => {
    await client.branches.createMany({ data: [romano, palet, barros] });
    for (const person of [adminA, adminB, sales, salesBarros, doctorA, doctorAB]) {
      await client.users.create({ data: { id: person.id, email: person.email, password_hash: passwordHash, first_name: person.name, last_name: "Sintético" } });
      const roles = await client.roles.findMany({ where: { code: { in: person.roles } } });
      await client.user_roles.createMany({ data: roles.map((role) => ({ user_id: person.id, role_id: role.id })) });
      await client.user_branches.createMany({ data: person.sites.map((site) => ({ user_id: person.id, branch_id: site.id })) });
      if (person.roles.includes("CLINICAL_PROFESSIONAL")) {
        await client.professional_profiles.create({ data: { user_id: person.id, appointment_duration_minutes: 30, slot_interval_minutes: 30, created_by: ids.admin, updated_by: ids.admin } });
        await client.professional_weekly_schedules.createMany({ data: person.sites.flatMap((site) =>
          Array.from({ length: 7 }, (_, day) => ({ professional_id: person.id, branch_id: site.id, day_of_week: day,
            is_working: true, start_time: new Date("1970-01-01T09:00:00Z"), end_time: new Date("1970-01-01T18:00:00Z") }))) });
      }
    }
    await client.patients.createMany({ data: [
      patient(patientAB, buyerRut, "Paciente compartido"),
      patient(patientB, fixtureRut(2_000_000 + Number.parseInt(tag.slice(0, 5), 16)), "Paciente solo Palet"),
    ] });
    await client.patient_branches.createMany({ data: [
      { patient_id: patientAB, branch_id: romano.id }, { patient_id: patientAB, branch_id: palet.id },
      { patient_id: patientB, branch_id: palet.id },
    ] });
    await client.customers.createMany({ data: [
      { id: customerA, patient_id: patientAB, rut: buyerRut, first_names: "Cliente compartido", last_names: "Sintético",
        email: buyerEmail, address: "Dirección de ensayo", phone: "+56912345678" },
      { id: customerB, first_names: "Cliente solo Palet", last_names: "Sintético" },
    ] });
    await client.customer_accounts.create({ data: {
      customer_id: customerA, email: buyerEmail, password_hash: passwordHash,
      birth_date: new Date("1990-01-01"), email_verified_at: now,
    } });
    await client.customers.create({ data: { id: otherBuyer.id, rut: otherBuyer.rut, email: otherBuyer.email,
      first_names: "Segundo comprador", last_names: "Sintético", address: "Dirección de ensayo", phone: "+56912345678" } });
    await client.customer_accounts.create({ data: { customer_id: otherBuyer.id, email: otherBuyer.email,
      password_hash: passwordHash, birth_date: new Date("1990-01-01"), email_verified_at: now } });
    await client.sales.createMany({ data: [
      sale(saleA, customerA, romano.id, 3100), sale(saleB, customerA, palet.id, 6300), sale(saleLegacy, customerB, null, 8900),
    ] });
    for (const [saleId, sku, price] of [[saleA, skuA, 3100], [saleB, skuB, 6300]]) {
      const product = await client.products.create({ data: { sku, name: "Artículo sintético " + sku, category: "ACCESSORY",
        unit_price_cents: price, is_test_data: true, created_by: ids.admin, updated_by: ids.admin } });
      await client.sale_items.create({ data: { sale_id: saleId, product_id: product.id, product_sku: sku,
        product_name: product.name, product_category: "ACCESSORY", requires_prescription: false, position: 1, quantity: 1, unit_price_cents: price } });
    }
    await client.customer_branches.create({ data: { customer_id: customerB, branch_id: palet.id } });
    await client.cash_register_terminals.create({ data: { id: terminalId, branch_id: palet.id, name: "Caja " + tag } });
    await client.cash_register_sessions.create({ data: { id: cashB, opened_by: adminB.id, branch_id: palet.id, terminal_id: terminalId, opening_amount_cents: 20000 } });
    await client.appointments.createMany({ data: [appointmentA, appointmentOtherA, appointmentB, appointmentOnlyB] });
    await client.clinical_encounters.createMany({ data: [encounterA, encounterB] });
  });
  return {
    romano, palet, barros, adminA, adminB, sales, salesBarros, doctorA, doctorAB, password,
    customerA, customerB, patientAB, patientB, saleA, saleB, saleLegacy, cashB, skuA, skuB,
    appointmentA, appointmentB, encounterA, encounterB, buyerEmail, buyerRut, otherBuyer,
  };
}
