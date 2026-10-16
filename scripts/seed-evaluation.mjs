import { hashPassword } from "../src/auth/password.js";
import { prisma } from "../src/db/prisma.js";
import { evaluation as data, requireEvaluationDatabase } from "../tests/fixtures/evaluation-data.js";
import { seedStoreE2e, ids } from "./seed-store-e2e.mjs";

requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
try {
  // Reutiliza el catálogo sintético y su guardia de aislamiento existentes.
  await seedStoreE2e();
  const passwordHash = await hashPassword(data.password);
  for (const [id, email, roleCode] of [
    [data.adminId, data.adminEmail, "ADMIN"],
    [data.restrictedId, data.restrictedEmail, null],
    [data.professionalId, "evaluacion-profesional@example.invalid", "CLINICAL_PROFESSIONAL"],
  ]) {
    await prisma.users.create({ data: {
      id, email, password_hash: passwordHash, first_name: "Evaluación", last_name: roleCode ?? "Sin permisos",
    } });
    if (roleCode) {
      const role = await prisma.roles.findUniqueOrThrow({ where: { code: roleCode } });
      await prisma.user_roles.create({ data: { user_id: id, role_id: role.id } });
    }
  }
  await prisma.professional_profiles.create({ data: {
    user_id: data.professionalId, appointment_duration_minutes: 60, slot_interval_minutes: 60,
    created_by: data.adminId, updated_by: data.adminId,
  } });
  await prisma.patients.create({ data: {
    id: data.patientId, rut: data.patientRut, first_names: "PacienteEvaluacion", last_names: "Sintético",
    birth_date: new Date("1990-01-15"), email: "paciente-evaluacion@example.invalid",
    phone: "+56912345678", address: "Calle Sintética 123",
  } });
  await prisma.appointments.create({ data: {
    id: data.appointmentId, patient_id: data.patientId, professional_id: data.professionalId,
    start_at: new Date(data.startAt), end_at: new Date(data.endAt), status: "CONFIRMED",
    internal_notes: "Reserva sintética de evaluación", created_by: data.adminId,
  } });
  await prisma.customers.create({ data: {
    id: data.customerId, rut: data.customerRut, first_names: "ClientePedidoEvaluacion", last_names: "Sintético",
    email: "pedido-evaluacion@example.invalid", phone: "+56912345678", address: "Calle Sintética 456",
  } });
  await prisma.sales.create({ data: {
    id: data.saleId, customer_id: data.customerId, status: "PAID",
    subtotal_cents: 5000, total_cents: 5000, origin: "IN_STORE", fulfillment_method: "PICKUP",
    created_by: data.adminId,
    sale_items: { create: {
      product_id: ids.accessory, product_sku: "ESTUCHE-TEST", product_name: "Estuche de prueba",
      product_category: "ACCESSORY", requires_prescription: false, position: 1, quantity: 1, unit_price_cents: 5000,
    } },
    // Registro sintético, sin invocar proveedores ni cobrar dinero.
    sale_payments: { create: {
      amount_cents: 5000, payment_method: "BANK_TRANSFER", reference: "SINTETICO-EVALUACION",
      received_by: data.adminId,
    } },
  } });
  console.log("Datos sintéticos de evaluación preparados.");
} finally {
  await prisma.$disconnect();
}
