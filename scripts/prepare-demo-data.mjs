import { loadProjectEnvironment } from "./load-environment.mjs";

/*
 * Preparación manual de datos ficticios para la demostración presencial.
 *
 * Este script no se ejecuta durante instalación, despliegue ni arranque. La
 * confirmación explícita y el dominio .invalid evitan tocar datos reales o
 * poner direcciones de terceros en la cola de correo.
 */

const DEMO_MARKER = "[DEMO-OPTICA-STYLO-2026]";
const DEFAULT_EMAIL_DOMAIN = "demo.opticastylo.invalid";
const DEMO_DATE = process.env.DEMO_DATE ?? "2026-09-22";
const emailDomain = (process.env.DEMO_EMAIL_DOMAIN ?? DEFAULT_EMAIL_DOMAIN)
  .trim()
  .toLowerCase();

function fail(message) {
  throw new Error(`[demo] ${message}`);
}

function assertDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} debe usar AAAA-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} no es válida.`);
  }
  return value;
}

function dateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

// Las fechas de la demo corresponden a Chile continental durante septiembre.
function chileDate(value, time) {
  return new Date(`${value}T${time}:00-03:00`);
}

function addDays(value, days) {
  const result = dateOnly(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function rutFromBody(body) {
  const digits = String(body).replace(/\D/g, "");
  let factor = 2;
  let sum = 0;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    sum += Number(digits[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = 11 - (sum % 11);
  const check = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return `${digits}-${check}`;
}

function safeEmail(localPart) {
  return `${localPart}@${emailDomain}`;
}

function sameIdentity(actual, expected, fields) {
  return fields.every((field) => actual[field] === expected[field]);
}

function appointmentMarker(key) {
  return `${DEMO_MARKER} ${key}`;
}

function reportAppointment(appointment, patient) {
  return {
    date: appointment.start_at.toISOString(),
    patient: `${patient.first_names} ${patient.last_names}`,
    status: appointment.status,
  };
}

function requireConfirmation() {
  if (process.env.NODE_ENV === "production") {
    fail("se niega a ejecutarse con NODE_ENV=production.");
  }
  if (process.env.DEMO_PREPARE_CONFIRM !== "YES") {
    fail("es manual y requiere DEMO_PREPARE_CONFIRM=YES.");
  }
  if (!emailDomain.endsWith(".invalid")) {
    fail("DEMO_EMAIL_DOMAIN debe terminar en .invalid para bloquear envíos reales.");
  }
}

const patientData = [
  {
    key: "juan-perez-soto",
    first_names: "Juan",
    last_names: "Pérez Soto",
    rut: rutFromBody("17234568"),
    birth_date: "1988-04-19",
    phone: "+56961234587",
    email: safeEmail("jperez"),
    address: "Avenida Los Carrera 1250, Concepción",
  },
  {
    key: "camila-gonzalez",
    first_names: "Camila",
    last_names: "González Rojas",
    rut: rutFromBody("18765432"),
    birth_date: "1992-11-07",
    phone: "+56973412856",
    email: safeEmail("camila.gonzalez"),
    address: "Janequeo 742, Concepción",
  },
  {
    key: "felipe-rojas",
    first_names: "Felipe",
    last_names: "Rojas Pino",
    rut: rutFromBody("15987643"),
    birth_date: "1985-08-26",
    phone: "+56984527613",
    email: safeEmail("felipe.rojas"),
    address: "San Martín 980, Concepción",
  },
  {
    key: "daniela-munoz",
    first_names: "Daniela",
    last_names: "Muñoz Herrera",
    rut: rutFromBody("19345672"),
    birth_date: "1996-02-15",
    phone: "+56967821435",
    email: safeEmail("dmunoz"),
    address: "Chacabuco 615, Concepción",
  },
  {
    key: "nicolas-soto",
    first_names: "Nicolás",
    last_names: "Soto Vidal",
    rut: rutFromBody("16432875"),
    birth_date: "1990-06-30",
    phone: "+56991236748",
    email: safeEmail("nicolas.soto"),
    address: "Tucapel 1040, Concepción",
  },
  {
    key: "valentina-sepulveda",
    first_names: "Valentina",
    last_names: "Sepúlveda Díaz",
    rut: rutFromBody("20123456"),
    birth_date: "1999-09-12",
    phone: "+56955678124",
    email: safeEmail("valentina.sepulveda"),
    address: "O'Higgins 835, Concepción",
  },
  {
    key: "andres-contreras",
    first_names: "Andrés",
    last_names: "Contreras Silva",
    rut: rutFromBody("14678923"),
    birth_date: "1981-12-03",
    phone: "+56982314567",
    email: safeEmail("andres.contreras"),
    address: "Barros Arana 420, Concepción",
  },
  {
    key: "carolina-martinez",
    first_names: "Carolina",
    last_names: "Martínez Leiva",
    rut: rutFromBody("17890234"),
    birth_date: "1987-03-22",
    phone: "+56976543218",
    email: safeEmail("carolina.martinez"),
    address: "Las Heras 560, Concepción",
  },
];

const appointmentPlan = [
  ["camila-gonzalez", 0, "09:00", "CONFIRMED"],
  ["felipe-rojas", 0, "10:00", "CHECKED_IN"],
  ["daniela-munoz", 0, "11:30", "NO_SHOW"],
  ["nicolas-soto", 0, "14:00", "CANCELLED"],
  ["valentina-sepulveda", 0, "15:30", "CONFIRMED"],
  ["andres-contreras", 1, "09:00", "CONFIRMED"],
  ["carolina-martinez", 1, "10:30", "CONFIRMED"],
];

loadProjectEnvironment();
requireConfirmation();
assertDate(DEMO_DATE, "DEMO_DATE");

const { prisma, disconnectPrisma } = await import("../src/db/prisma.js");

try {
  const professional = await prisma.professional_profiles.findFirst({
    include: { users_professional_profiles_user_idTousers: true },
    orderBy: { created_at: "asc" },
    where: {
      is_bookable: true,
      users_professional_profiles_user_idTousers: { is_active: true },
    },
  });
  if (!professional) {
    fail("no existe un profesional activo y reservable para la demostración.");
  }

  const actor = professional.user_id;
  const professionalName = `${professional.users_professional_profiles_user_idTousers.first_name} ${professional.users_professional_profiles_user_idTousers.last_name}`;
  const result = await prisma.$transaction(async (client) => {
    const patients = new Map();
    const createdPatients = [];
    for (const data of patientData) {
      const existing = await client.patients.findUnique({ where: { rut: data.rut } });
      if (existing) {
        if (existing.email !== data.email) {
          fail(`el RUT demo ${data.rut} ya pertenece a otra identidad; no se modifica.`);
        }
        const current = sameIdentity(existing, data, ["first_names", "last_names", "email", "phone", "address"])
          ? existing
          : await client.patients.update({
            data: {
              address: data.address,
              birth_date: dateOnly(data.birth_date),
              first_names: data.first_names,
              last_names: data.last_names,
              phone: data.phone,
            },
            where: { id: existing.id },
          });
        patients.set(data.key, current);
        continue;
      }
      const created = await client.patients.create({
        data: {
          address: data.address,
          birth_date: dateOnly(data.birth_date),
          email: data.email,
          first_names: data.first_names,
          last_names: data.last_names,
          phone: data.phone,
          rut: data.rut,
        },
      });
      patients.set(data.key, created);
      createdPatients.push(`${data.first_names} ${data.last_names}`);
    }

    const mainData = patientData[0];
    const customerData = {
      address: mainData.address,
      email: mainData.email,
      first_names: mainData.first_names,
      last_names: mainData.last_names,
      patient_id: patients.get(mainData.key).id,
      phone: mainData.phone,
      rut: mainData.rut,
    };
    let customer = await client.customers.findUnique({ where: { patient_id: customerData.patient_id } });
    let createdCustomer = false;
    if (customer) {
      if (customer.email !== customerData.email || customer.rut !== customerData.rut) {
        fail("el cliente vinculado al paciente principal no coincide; no se modifica.");
      }
      if (!sameIdentity(customer, customerData, ["first_names", "last_names", "email", "phone", "address", "rut"])) {
        customer = await client.customers.update({
          data: customerData,
          where: { id: customer.id },
        });
      }
    } else {
      customer = await client.customers.create({ data: customerData });
      createdCustomer = true;
    }

    const historicalDate = addDays(DEMO_DATE, -7);
    const historicalStart = chileDate(historicalDate, "11:00");
    const historicalEnd = new Date(historicalStart.getTime() + professional.appointment_duration_minutes * 60_000);
    let historicalAppointment = await client.appointments.findFirst({ where: { internal_notes: appointmentMarker("juan-historica") } });
    let createdHistorical = false;
    if (!historicalAppointment) {
      historicalAppointment = await client.appointments.create({
        data: {
          created_by: actor,
          end_at: historicalEnd,
          internal_notes: appointmentMarker("juan-historica"),
          patient_id: patients.get(mainData.key).id,
          professional_id: actor,
          source: "INTERNAL",
          start_at: historicalStart,
          status: "COMPLETED",
          updated_by: actor,
        },
      });
      await client.appointment_events.create({
        data: {
          appointment_id: historicalAppointment.id,
          details: "Atención histórica preparada para la demostración.",
          event_type: "CREATED",
          new_status: "COMPLETED",
          performed_by: actor,
          created_at: historicalStart,
        },
      });
      createdHistorical = true;
    }

    let encounter = await client.clinical_encounters.findUnique({ where: { appointment_id: historicalAppointment.id } });
    let createdEncounter = false;
    if (!encounter) {
      encounter = await client.clinical_encounters.create({
        data: {
          anamnesis: "Refiere cansancio visual al final de la jornada.",
          created_at: historicalStart,
          created_by: actor,
          diagnosis: "Astigmatismo leve; control optométrico estable.",
          examination: "Agudeza visual mejorada con corrección habitual.",
          finalized_at: new Date(historicalStart.getTime() + 35 * 60_000),
          indications: "Usar la corrección para lectura y trabajo frente a pantallas.",
          patient_id: patients.get(mainData.key).id,
          professional_id: actor,
          reason_for_visit: "Control visual anual",
          status: "FINALIZED",
          updated_at: new Date(historicalStart.getTime() + 35 * 60_000),
          updated_by: actor,
          appointment_id: historicalAppointment.id,
        },
      });
      await client.clinical_encounter_events.createMany({
        data: [
          { changed_fields: ["reasonForVisit", "anamnesis", "examination", "diagnosis", "indications"], encounter_id: encounter.id, event_type: "CREATED", performed_by: actor, created_at: historicalStart },
          { changed_fields: [], encounter_id: encounter.id, event_type: "FINALIZED", performed_by: actor, created_at: new Date(historicalStart.getTime() + 35 * 60_000) },
        ],
      });
      createdEncounter = true;
    }

    let medicalRecord = await client.medical_records.findUnique({
      where: { patient_id: patients.get(mainData.key).id },
    });
    let createdMedicalRecord = false;
    if (!medicalRecord) {
      medicalRecord = await client.medical_records.create({
        data: {
          allergies: "Niega alergias conocidas.",
          created_by: actor,
          current_medications: "Ninguno informado.",
          family_ocular_history: "Sin antecedentes familiares relevantes informados.",
          general_medical_history: "Sin antecedentes generales relevantes para esta atención.",
          ocular_history: "Usa lentes para lejos desde hace tres años.",
          patient_id: patients.get(mainData.key).id,
          updated_by: actor,
        },
      });
      await client.medical_record_events.create({
        data: {
          changed_fields: ["generalMedicalHistory", "ocularHistory", "familyOcularHistory", "allergies", "currentMedications"],
          event_type: "CREATED",
          medical_record_id: medicalRecord.id,
          performed_by: actor,
        },
      });
      createdMedicalRecord = true;
    }

    let prescription = await client.optical_prescriptions.findFirst({ where: { encounter_id: encounter.id, version: 1 } });
    let createdPrescription = false;
    if (!prescription) {
      prescription = await client.optical_prescriptions.create({
        data: {
          encounter_id: encounter.id,
          fulfillment_notes: "Cristales monofocales con filtro UV.",
          issued_at: new Date(historicalStart.getTime() + 35 * 60_000),
          issued_by: actor,
          left_axis: 95,
          left_cylinder: -0.5,
          left_sphere: -0.75,
          pupillary_distance: 63,
          right_axis: 85,
          right_cylinder: -0.25,
          right_sphere: -1.0,
          status: "ACTIVE",
          version: 1,
        },
      });
      createdPrescription = true;
    }

    const appointmentReports = [];
    for (const [patientKey, dayOffset, time, status] of appointmentPlan) {
      const marker = appointmentMarker(`agenda-${patientKey}-${dayOffset}-${time.replace(":", "")}`);
      let appointment = await client.appointments.findFirst({ where: { internal_notes: marker } });
      if (!appointment) {
        const date = addDays(DEMO_DATE, dayOffset);
        const startAt = chileDate(date, time);
        const endAt = new Date(startAt.getTime() + professional.appointment_duration_minutes * 60_000);
        const conflict = await client.appointments.findFirst({
          where: {
            end_at: { gt: startAt },
            professional_id: actor,
            start_at: { lt: endAt },
            status: { not: "CANCELLED" },
          },
        });
        if (conflict) {
          appointmentReports.push({ conflict: true, date: startAt.toISOString(), patient: patientKey, status: "NO CREADA" });
          continue;
        }
        appointment = await client.appointments.create({
          data: {
            cancellation_reason: status === "CANCELLED" ? "El paciente avisó que no podía asistir." : null,
            cancelled_at: status === "CANCELLED" ? new Date() : null,
            created_by: actor,
            end_at: endAt,
            internal_notes: marker,
            patient_id: patients.get(patientKey).id,
            professional_id: actor,
            source: "INTERNAL",
            start_at: startAt,
            status,
            updated_by: actor,
          },
        });
        await client.appointment_events.create({
          data: {
            appointment_id: appointment.id,
            details: "Reserva ficticia preparada para la demostración.",
            event_type: status === "CANCELLED" ? "CANCELLED" : "CREATED",
            new_status: status,
            performed_by: actor,
          },
        });
      }
      appointmentReports.push(reportAppointment(appointment, patients.get(patientKey)));
    }

    let sale = await client.sales.findFirst({ where: { request_key: `${DEMO_MARKER}-venta-juan` } });
    let createdSale = false;
    const frame = await client.products.findFirst({ orderBy: { created_at: "asc" }, where: { category: "FRAME", is_active: true } });
    if (!sale && frame) {
      const total = Number(frame.unit_price_cents);
      sale = await client.sales.create({
        data: {
          created_by: actor,
          customer_id: customer.id,
          discount_cents: 0,
          origin: "IN_STORE",
          patient_id: patients.get(mainData.key).id,
          payment_method: "CASH",
          prescription_id: prescription.id,
          request_key: `${DEMO_MARKER}-venta-juan`,
          shipping_fee_cents: 0,
          status: "PAID",
          subtotal_cents: total,
          total_cents: total,
          updated_by: actor,
        },
      });
      await client.sale_items.create({
        data: {
          position: 1,
          product_category: frame.category,
          product_id: frame.id,
          product_name: frame.name,
          product_sku: frame.sku,
          quantity: 1,
          requires_prescription: frame.requires_prescription,
          sale_id: sale.id,
          unit_price_cents: frame.unit_price_cents,
        },
      });
      const payment = await client.sale_payments.create({
        data: {
          amount_cents: total,
          cash_received_cents: total,
          change_cents: 0,
          paid_at: new Date(historicalStart.getTime() + 45 * 60_000),
          payment_method: "CASH",
          received_by: actor,
          reference: "Pago presencial de demostración",
          request_key: `${DEMO_MARKER}-pago-juan`,
          sale_id: sale.id,
        },
      });
      await client.sale_events.create({
        data: {
          details: JSON.stringify({ demo: true, note: "Venta histórica ficticia" }),
          event_type: "CREATED",
          new_status: "PAID",
          performed_by: actor,
          sale_id: sale.id,
        },
      });
      await client.sale_receipts.create({
        data: {
          generated_by: actor,
          issued_at: new Date(historicalStart.getTime() + 45 * 60_000),
          payload: { demo: true, paymentId: payment.id, saleNumber: Number(sale.sale_number), totalCents: total },
          receipt_type: "FINAL",
          sale_id: sale.id,
        },
      });
      createdSale = true;
    }

    return {
      appointmentReports,
      createdCustomer,
      createdEncounter,
      createdHistorical,
      createdPatients,
      createdPrescription,
      createdMedicalRecord,
      createdSale,
      customer,
      encounter,
      historicalAppointment,
      prescription,
      professionalName,
      sale,
    };
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });

  console.log(JSON.stringify({
    emailDomain,
    marker: DEMO_MARKER,
    patientPrincipal: {
      address: patientData[0].address,
      email: patientData[0].email,
      name: `${patientData[0].first_names} ${patientData[0].last_names}`,
      rut: patientData[0].rut,
    },
    professional: result.professionalName,
    created: {
      patients: result.createdPatients,
      customer: result.createdCustomer,
      historicalAppointment: result.createdHistorical,
      clinicalEncounter: result.createdEncounter,
      medicalRecord: result.createdMedicalRecord,
      prescription: result.createdPrescription,
      sale: result.createdSale,
    },
    appointments: result.appointmentReports,
    saleNumber: result.sale ? Number(result.sale.sale_number) : null,
    prescriptionId: result.prescription.id,
    nextAvailableDemoDate: addDays(DEMO_DATE, 1),
  }, null, 2));
} finally {
  await disconnectPrisma();
}
