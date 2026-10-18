import { writeFile } from "node:fs/promises";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { prisma } from "../src/db/prisma.js";
import { ids, seedAcademicData } from "../tests/fixtures/academic-data.js";
import { createAppointment, changeAppointmentStatus } from "../src/services/appointment-service.js";
import { createEncounter, updateMedicalRecord, finalizeEncounter } from "../src/services/clinical-service.js";
import { createPrescription } from "../src/services/prescription-service.js";

try {
  const actors = await seedAcademicData();
  const tomorrow = new Date(Date.now()+86400000);
  const date = formatInTimeZone(tomorrow,"America/Santiago","yyyy-MM-dd");
  let clinicalTime="11:00";
  if(process.argv[2]==="refresh-e2e") {
    clinicalTime=null;
    for(const candidate of ["11:00","12:00","14:00","15:00","16:00","17:00"]) {
      const startAt=fromZonedTime(`${date}T${candidate}:00`,"America/Santiago");
      if(!await prisma.appointments.findFirst({where:{professional_id:ids.professional,start_at:startAt}})) {clinicalTime=candidate;break;}
    }
    if(!clinicalTime) throw new Error("No queda un cupo sintético para repetir el recorrido; conserve los anteriores.");
  }
  const created = [];
  for(const [time,patientId] of [["10:00",ids.patient],[clinicalTime,ids.otherPatient]]) {
    const startAt=fromZonedTime(`${date}T${time}:00`,"America/Santiago");
    const existing=await prisma.appointments.findFirst({where:{professional_id:ids.professional,start_at:startAt}});
    const appointment=existing??await createAppointment({patientId,professionalId:ids.professional,startAt:startAt.toISOString()},actors.admin);
    created.push({appointmentId:appointment.id,patientId,date,time});
    if(time==="10:00"&&!existing) {
      await changeAppointmentStatus(appointment.id,{status:"CHECKED_IN"},actors.professional);
      await updateMedicalRecord(patientId,{generalMedicalHistory:"DEMO FICTICIA: sin antecedentes reales.",ocularHistory:"Antecedente ocular sintético",allergies:"Sin alergias declaradas en este ejercicio"},actors.professional);
      const encounter=await createEncounter({appointmentId:appointment.id,reasonForVisit:"DEMOSTRACIÓN FICTICIA: control visual",anamnesis:"Paciente sintético; no corresponde a una evaluación clínica real.",examination:"Examen simulado para verificar el registro del software.",diagnosis:"Diagnóstico ficticio; sin uso asistencial.",indications:"Ejercicio académico, no usar para atención ni fabricación."},actors.professional);
      await createPrescription(encounter.id,{rightEye:{sphere:-1,cylinder:-0.5,axis:90,addition:null},leftEye:{sphere:-1.25,cylinder:0,axis:null,addition:null},pupillaryDistance:62,fulfillmentNotes:"RECETA FICTICIA; sin validez clínica ni comercial."},actors.professional);
      await finalizeEncounter(encounter.id,actors.professional);
    }
  }
  await writeFile("tmp/academic-validation/demo-records.json",JSON.stringify({created,professionalEmail:"academic-profesional@example.invalid"},null,2));
  console.log("Demostración clínica local preparada con dos pacientes sintéticos. Credenciales únicamente en tmp ignorado.");
} finally {await prisma.$disconnect();}
