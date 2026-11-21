import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { hashPassword } from "../../src/auth/password.js";
import { fixtureRut } from "../evaluation-support/rut-fixture.js";

function assertSyntheticDatabase(environment, academic) {
  const rawUrl = environment.DATABASE_URL ?? "";
  const databaseUrl = URL.canParse(rawUrl) ? new URL(rawUrl) : null;
  const database = academic ? environment.ACADEMIC_DB_NAME : "opticastylo_demo";
  const user = academic ? environment.ACADEMIC_DB_USER : "stylo_demo";
  const postgresIdentifier = /^[a-z_][a-z0-9_]{0,62}$/;
  const academicTarget = environment.DEPLOYMENT_ENVIRONMENT === "university"
    && postgresIdentifier.test(database ?? "") && postgresIdentifier.test(user ?? "")
    && !["postgres", "template0", "template1"].includes(database)
    && /^[A-Za-z0-9._~-]+$/.test(databaseUrl?.password ?? "");

  if (databaseUrl?.protocol === "postgresql:" && databaseUrl.host === "db:5432"
    && databaseUrl.pathname === `/${database}` && databaseUrl.username === user
    && databaseUrl.search === "?schema=public" && !databaseUrl.hash
    && (!academic || academicTarget)) return;

  throw new Error("La inicialización requiere la base sintética del servicio db de Compose.");
}

assertSyntheticDatabase(process.env, process.argv[2] === "--academico");

const migrate = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
  stdio: "inherit",
});
if (migrate.error || migrate.status !== 0) {
  throw migrate.error ?? new Error("Prisma no pudo aplicar las migraciones locales.");
}

async function passwordHash(account) {
  const file = `/var/lib/stylo-private/${account}-password`;
  try {
    await writeFile(file, randomBytes(24).toString("base64url"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return hashPassword(await readFile(file, "utf8"));
}

const prisma = new PrismaClient();
try {
  const seeded = await prisma.$transaction(async (db) => {
    // Serializa la inicialización y confirma todos los datos en una sola transacción.
    await db.$executeRaw`SELECT pg_advisory_xact_lock(48321007)`;
    const email = "admin-demo@example.invalid";
    if (await db.users.findFirst({ where: { email } })) return false;

    const admin = await db.users.create({ data: {
      email, password_hash: await passwordHash("admin"), first_name: "Administración", last_name: "Demo",
    } });
    const professional = await db.users.create({ data: {
      email: "profesional-demo@example.invalid", password_hash: await passwordHash("profesional"),
      first_name: "Profesional", last_name: "Demo",
    } });
    for (const [user, code] of [[admin, "ADMIN"], [professional, "CLINICAL_PROFESSIONAL"]]) {
      const role = await db.roles.findUniqueOrThrow({ where: { code } });
      await db.user_roles.create({ data: { user_id: user.id, role_id: role.id } });
    }
    await db.professional_profiles.create({ data: {
      user_id: professional.id, appointment_duration_minutes: 60, slot_interval_minutes: 60,
      created_by: admin.id, updated_by: admin.id,
    } });
    await db.professional_weekly_schedules.createMany({
      data: Array.from({ length: 7 }, (_, day_of_week) => ({
        professional_id: professional.id, day_of_week,
        start_time: new Date("1970-01-01T09:00:00Z"), end_time: new Date("1970-01-01T17:00:00Z"),
      })),
    });

    // Sustituye las ubicaciones reales que carga la migración de inventario.
    await db.branches.deleteMany({ where: { code: { in: ["BARROS_ROMANO", "GALERIA_PALET", "CENTRO_MEDICO"] } } });
    const branch = await db.branches.create({ data: {
      code: "DEMO-CENTRO", name: "Sucursal Demo Centro", address: "Calle de Demostración 100",
      information_source: "Datos sintéticos de Docker", pickup_enabled: true,
    } });
    const products = [];
    for (const [sku, name, category, price, quantity] of [
      ["DEMO-ESTUCHE", "Estuche Demo", "ACCESSORY", 5000, 15],
      ["DEMO-MARCO", "Marco Óptico Demo", "FRAME", 29990, 8],
      ["DEMO-LENTE", "Cristal Monofocal Demo", "PRESCRIPTION_LENS", 19990, 12],
    ]) {
      const product = await db.products.create({ data: {
        sku, name, category, unit_price_cents: price, requires_prescription: category === "PRESCRIPTION_LENS",
        is_test_data: true, inventory_mode: "TRACKED", created_by: admin.id, updated_by: admin.id,
      } });
      products.push(product);
      await db.inventory_stocks.create({ data: {
        branch_id: branch.id, product_id: product.id, on_hand: quantity,
        inventory_movements: { create: {
          stock_version: 1, kind: "COUNT", after_on_hand: quantity, before_reserved: 0, after_reserved: 0,
          reason: "Conteo inicial sintético", actor_id: admin.id,
        } },
      } });
    }

    const patient = await db.patients.create({ data: {
      rut: fixtureRut(9751), first_names: "Paciente", last_names: "Demo", birth_date: new Date("1995-01-15"),
      email: "paciente-demo@example.invalid", phone: "+56900000001", address: "Pasaje Sintético 1",
      created_by: admin.id,
    } });
    const customer = await db.customers.create({ data: {
      rut: fixtureRut(9752), first_names: "Cliente", last_names: "Demo", email: "cliente-demo@example.invalid",
      phone: "+56900000002", address: "Pasaje Sintético 2", created_by: admin.id,
    } });
    const today = formatInTimeZone(new Date(), "America/Santiago", "yyyy-MM-dd");
    const appointment = await db.appointments.create({ data: {
      patient_id: patient.id, professional_id: professional.id, created_by: admin.id,
      start_at: fromZonedTime(`${today}T11:00:00`, "America/Santiago"),
      end_at: fromZonedTime(`${today}T12:00:00`, "America/Santiago"), status: "CONFIRMED",
      internal_notes: "Reserva ficticia para la demostración local",
    } });
    await db.clinical_care_assignments.create({ data: {
      patient_id: patient.id, professional_id: professional.id, assigned_by: admin.id,
      reason: "Atención de un paciente sintético para la demostración",
    } });
    const encounter = await db.clinical_encounters.create({ data: {
      patient_id: patient.id, professional_id: professional.id, appointment_id: appointment.id,
      encounter_date: new Date(today), reason_for_visit: "Control visual de demostración",
      anamnesis: "Ejemplo ficticio sin validez clínica", created_by: professional.id, updated_by: professional.id,
    } });
    await db.$executeRaw`
      INSERT INTO clinical_encounter_events (encounter_id, event_type, performed_by, record_version, record_snapshot)
      SELECT id, 'CREATED', updated_by, record_version, clinical_record_snapshot(e)
      FROM clinical_encounters e WHERE id = ${encounter.id}::uuid
    `;

    const [accessory] = products;
    await db.sales.create({ data: {
      customer_id: customer.id, branch_id: branch.id, status: "PAID", origin: "IN_STORE",
      fulfillment_method: "PICKUP", subtotal_cents: accessory.unit_price_cents,
      total_cents: accessory.unit_price_cents, created_by: admin.id,
      sale_items: { create: {
        product_id: accessory.id, product_sku: accessory.sku, product_name: accessory.name,
        product_category: accessory.category, requires_prescription: accessory.requires_prescription,
        position: 1, quantity: 1, unit_price_cents: accessory.unit_price_cents,
      } },
      sale_payments: { create: {
        amount_cents: accessory.unit_price_cents, payment_method: "BANK_TRANSFER",
        reference: "SOLO-DEMO-SINTETICO", received_by: admin.id,
      } },
    } });
    return true;
  });
  if (seeded) console.log("Datos sintéticos de demostración preparados.");
} finally {
  await prisma.$disconnect();
}
