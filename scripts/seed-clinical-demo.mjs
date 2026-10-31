import { prisma } from "../src/db/prisma.js";
import { hashPassword } from "../src/auth/password.js";
import { evaluation, requireEvaluationDatabase } from "../tests/evaluation-data.js";
import { fixtureRut } from "../tests/rut-fixture.js";
import { clinicalDemo as d, optometryData, contactologyData } from "../tests/clinical/data.js";
import {clinicalDateToday} from "../src/config/clinical-forms.js";
import {createEncounter,finalizeEncounter} from "../src/services/clinical-service.js";
requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
if (process.env.CLINICAL_TEST_MODE !== "true") throw new Error("La demostración clínica solo se prepara en el entorno aislado.");
try {
  const role = await prisma.roles.findUniqueOrThrow({
    where: {
      code: "CLINICAL_PROFESSIONAL"
    }
  });
  for (const [i, id] of [d.professionalId, d.colleagueId].entries()) {
    await prisma.users.create({
      data: {
        id,
        email: i ? d.colleagueEmail : d.email,
        first_name: "Profesional sintético",
        last_name: i ? "B" : "A",
        password_hash: await hashPassword(evaluation.password)
      }
    });
    await prisma.user_roles.create({
      data: {
        user_id: id,
        role_id: role.id
      }
    });
    await prisma.professional_profiles.create({
      data: {
        user_id: id,
        appointment_duration_minutes: 60,
        slot_interval_minutes: 30,
        created_by: evaluation.adminId,
        updated_by: evaluation.adminId
      }
    });
  }
  for (const [i, id] of [d.patientId, d.otherPatientId].entries()) await prisma.patients.create({
    data: {
      id,
      rut: fixtureRut(9401 + i),
      first_names: "Paciente clínico sintético",
      last_names: i ? "Prueba B" : "Prueba A",
      birth_date: new Date("1995-10-31"),
      email: `paciente-clinico-${i}@example.invalid`,
      phone: "+56912345678",
      address: "Dirección sintética"
    }
  });
  for (const professionalId of [d.professionalId, d.colleagueId]) await prisma.clinical_care_assignments.create({
    data: {
      patient_id: d.patientId,
      professional_id: professionalId,
      assigned_by: evaluation.adminId,
      reason: "Identidad sintética verificada; atención local de prueba"
    }
  });
  const start = new Date();
  start.setUTCHours(14, 0, 0, 0);
  const end = new Date(start.getTime() + 3600000);
  await prisma.appointments.create({
    data: {
      id: d.appointmentId,
      patient_id: d.patientId,
      professional_id: d.professionalId,
      start_at: start,
      end_at: end,
      status: "CHECKED_IN",
      created_by: evaluation.adminId
    }
  });
  if(process.env.CLINICAL_DEMO_MODE==="true"){
    const actor={userId:d.professionalId,roles:["CLINICAL_PROFESSIONAL"],permissions:["medical_records.read_assigned","medical_records.write_assigned"]};
    const opt=await createEncounter({patientId:d.patientId,encounterType:"OPTOMETRY",encounterDate:clinicalDateToday(),reasonForVisit:"Evaluación optométrica de demostración sintética",anamnesis:"Ejemplo exclusivamente sintético; sin validez clínica.",formData:optometryData()},actor,{requestKey:"demo-optometria-fase4"});
    await finalizeEncounter(opt.id,{expectedVersion:opt.version,confirm:true},actor);
    await createEncounter({patientId:d.patientId,encounterType:"CONTACTOLOGY",encounterDate:clinicalDateToday(),reasonForVisit:"Adaptación de demostración sintética",anamnesis:"Borrador exclusivamente sintético; sin validez clínica.",formData:contactologyData()},actor,{requestKey:"demo-contactologia-fase4"});
  }
  console.log("Dos profesionales y dos pacientes exclusivamente sintéticos preparados para fichas oficiales.");
} finally {
  await prisma.$disconnect();
}
