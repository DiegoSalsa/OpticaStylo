import { prisma } from "../db/prisma.js";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { retryTransaction } from "../db/retry-transaction.js";
import { clinicalInvalid,hasClinicalValue,validateClinicalFormData } from "../validations/clinical-form-validation.js";

const profileUser = "users_professional_profiles_user_idTousers";
const MEDICAL_RECORD_COLUMNS = Object.freeze({
  allergies: "allergies", currentMedications: "current_medications",
  familyOcularHistory: "family_ocular_history",
  generalMedicalHistory: "general_medical_history", ocularHistory: "ocular_history",
});
const ENCOUNTER_COLUMNS = Object.freeze({
  anamnesis: "anamnesis", diagnosis: "diagnosis", examination: "examination",
  indications: "indications", reasonForVisit: "reason_for_visit",
});

function mapMedicalRecord(row) {
  return row ? {
    revision:row.medical_record_revisions?.[0]?.revision??0,
    allergies: row.allergies, createdAt: row.created_at,
    currentMedications: row.current_medications,
    familyOcularHistory: row.family_ocular_history,
    generalMedicalHistory: row.general_medical_history, id: row.id,
    ocularHistory: row.ocular_history, patientId: row.patient_id, updatedAt: row.updated_at,
  } : null;
}

export function mapMedicalRecordRevision(row) {
  const user = row.professional_profiles[profileUser];
  return {
    allergies: row.allergies, changedFields: row.changed_fields,
    currentMedications: row.current_medications,
    familyOcularHistory: row.family_ocular_history,
    // BIGSERIAL debe conservarse como texto para el contrato JSON, sin perder precisión.
    generalMedicalHistory: row.general_medical_history, id: String(row.id),
    ocularHistory: row.ocular_history, recordedAt: row.recorded_at,
    recordedBy: { firstName: user.first_name, id: row.recorded_by, lastName: user.last_name },
    revision: row.revision,
  };
}

function mapAddendum(row) {
  const user = row.professional_profiles[profileUser];
  return {
    authoredBy: { firstName: user.first_name, id: row.authored_by, lastName: user.last_name },
    content: row.content, createdAt: row.created_at, encounterId: row.encounter_id,
    id: row.id, reason: row.reason,
  };
}

function mapEncounter(row, additions = {}) {
  if (!row) return null;
  const professional = row.professional_profiles_clinical_encounters_professional_idToprofessional_profiles[profileUser];
  return {
    type:row.encounter_type,encounterDate:row.encounter_date?.toISOString().slice(0,10)??null,
    recordNumber:row.record_number==null?null:String(row.record_number),formVersion:row.form_version,formData:row.form_data,
    version:row.record_version,patientSnapshot:row.patient_snapshot,professionalSnapshot:row.professional_snapshot,
    anamnesis: row.anamnesis, appointmentId: row.appointment_id, createdAt: row.created_at,
    diagnosis: row.diagnosis, examination: row.examination, finalizedAt: row.finalized_at,
    id: row.id, indications: row.indications,
    patient: {
      firstNames: row.patients.first_names, id: row.patient_id,
      lastNames: row.patients.last_names, rut: row.patients.rut,
      birthDate:row.patients.birth_date.toISOString().slice(0,10),phone:row.patients.phone,email:row.patients.email,
    },
    professional: {
      firstName: professional.first_name, id: row.professional_id, lastName: professional.last_name,
    },
    reasonForVisit: row.reason_for_visit, status: row.status, updatedAt: row.updated_at,
    ...additions,
  };
}

const encounterInclude = {
  appointments:{select:{id:true,start_at:true,status:true}},
  patients: true,
  professional_profiles_clinical_encounters_professional_idToprofessional_profiles: {
    include: { [profileUser]: true },
  },
};

async function findEncounterWithClient(client, encounterId) {
  return mapEncounter(await client.clinical_encounters.findUnique({
    include: encounterInclude, where: { id: encounterId },
  }));
}

export async function hasClinicalAssignment(patientId, professionalId, statuses = ["CONFIRMED", "CHECKED_IN", "COMPLETED"],client=prisma) {
  return (await client.appointments.count({
    where: { patient_id: patientId, professional_id: professionalId, status: { in: statuses } },
  })) > 0 || (await client.clinical_care_assignments.count({where:{patient_id:patientId,professional_id:professionalId,revoked_at:null}}))>0;
}

export async function findMedicalRecordByPatientId(patientId) {
  return mapMedicalRecord(await prisma.medical_records.findUnique({ where: { patient_id: patientId },include:{medical_record_revisions:{orderBy:{revision:"desc"},take:1}} }));
}

export async function listMedicalRecordRevisions(patientId) {
  const rows = await prisma.medical_record_revisions.findMany({
    include: { professional_profiles: { include: { [profileUser]: true } } },
    orderBy: { revision: "desc" }, where: { medical_records: { patient_id: patientId } },
  });
  return rows.map(mapMedicalRecordRevision);
}

export async function upsertMedicalRecord(patientId, changes, actorUserId,expectedRevision) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  return retryTransaction(prisma,async (client) => {
    await client.$queryRaw`SELECT id FROM patients WHERE id=${patientId}::uuid FOR UPDATE`;
    const patient = await client.patients.findUnique({ select: { id: true }, where: { id: patientId } });
    if (!patient) return null;
    const current = await client.medical_records.findUnique({ where: { patient_id: patientId },include:{medical_record_revisions:{orderBy:{revision:"desc"},take:1}} });
    if(expectedRevision!==undefined&&expectedRevision!==(current?.medical_record_revisions[0]?.revision??0))clinicalInvalid("Los antecedentes cambiaron en otra sesión. Consulte la revisión vigente antes de guardar.","MEDICAL_RECORD_VERSION_CONFLICT",409);
    const data = Object.fromEntries(Object.entries(changes).map(([field, value]) => [MEDICAL_RECORD_COLUMNS[field], value]));
    if (current && Object.entries(data).every(([field, value]) => current[field] === value)) {
      return mapMedicalRecord(current);
    }
    const record = current
      ? await client.medical_records.update({ data: { ...data, updated_by: actorUserId }, where: { id: current.id } })
      : await client.medical_records.create({ data: {
        allergies: changes.allergies ?? null, created_by: actorUserId,
        current_medications: changes.currentMedications ?? null,
        family_ocular_history: changes.familyOcularHistory ?? null,
        general_medical_history: changes.generalMedicalHistory ?? null,
        ocular_history: changes.ocularHistory ?? null, patient_id: patientId, updated_by: actorUserId,
      } });
    // Registrar el evento de dominio para conservar la trazabilidad histórica de la operación
    await client.medical_record_events.create({ data: {
      changed_fields: Object.keys(changes), event_type: current ? "UPDATED" : "CREATED",
      medical_record_id: record.id, performed_by: actorUserId,
    } });
    return mapMedicalRecord(await client.medical_records.findUnique({where:{id:record.id},include:{medical_record_revisions:{orderBy:{revision:"desc"},take:1}}}));
  // Usar aislamiento serializable para reducir conflictos entre operaciones concurrentes
  }, { isolationLevel: "Serializable" }).catch((error)=>{if(error.code==="P2002")clinicalInvalid("Los antecedentes fueron creados en otra sesión. Consulte la revisión vigente.","MEDICAL_RECORD_VERSION_CONFLICT",409);throw error;});
}

export async function recordClinicalAccess(encounterId,actorId,eventType="VIEWED",client=prisma) {
  await client.clinical_encounter_events.create({data:{encounter_id:encounterId,performed_by:actorId,event_type:eventType}});
}
async function recordVersion(client,id,actorId,eventType,changedFields=[]) {
  await client.$executeRaw`INSERT INTO clinical_encounter_events(encounter_id,event_type,changed_fields,performed_by,record_version,record_snapshot)
    SELECT id,${eventType},${changedFields}::text[],${actorId}::uuid,record_version,clinical_record_snapshot(clinical_encounters) FROM clinical_encounters WHERE id=${id}::uuid`;
}
function versionConflict(){clinicalInvalid("La ficha cambió en otra sesión. Conserve sus cambios y consulte la versión vigente antes de volver a guardar.","CLINICAL_VERSION_CONFLICT",409);}
function checkBirthDate(date,patient) {
  const birth=patient.birth_date instanceof Date?patient.birth_date.toISOString().slice(0,10):patient.birthDate;
  if(date&&birth&&date<birth)clinicalInvalid("La fecha de atención no puede ser anterior al nacimiento.");
}
export async function createClinicalEncounter(data,actorId,requestKey) {
  const hash=createHash("sha256").update(JSON.stringify(data)).digest("hex");
  const repeated=async(client,row)=>{if(row.professional_id!==actorId||row.request_hash!==hash)clinicalInvalid("El identificador de operación corresponde a otra ficha.","IDEMPOTENCY_CONFLICT",409);return {encounter:await findEncounterWithClient(client,row.id),reason:null};};
  return retryTransaction(prisma,async(client)=>{
    if(requestKey){
      await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"clinical:"+requestKey},0))::text`;
      const previous=await client.clinical_encounters.findUnique({where:{request_key:requestKey}});
      if(previous)return repeated(client,previous);
    }
    let appointment=null;
    if(data.appointmentId){
      await client.$queryRaw`SELECT id FROM appointments WHERE id=${data.appointmentId}::uuid FOR UPDATE`;
      appointment=await client.appointments.findUnique({where:{id:data.appointmentId}});
      if(!appointment)return {encounter:null,reason:"APPOINTMENT_NOT_FOUND"};
      if(appointment.professional_id!==actorId||(data.patientId&&appointment.patient_id!==data.patientId))return {encounter:null,reason:"NOT_ASSIGNED"};
      if(appointment.status!=="CHECKED_IN")return {encounter:null,reason:"INVALID_APPOINTMENT_STATUS"};
      if(await client.clinical_encounters.findUnique({where:{appointment_id:appointment.id}}))return {encounter:null,reason:"ENCOUNTER_ALREADY_EXISTS"};
    }
    const patientId=appointment?.patient_id??data.patientId;
    if(!await hasClinicalAssignment(patientId,actorId,["CONFIRMED","CHECKED_IN","COMPLETED"],client))return {encounter:null,reason:"NOT_ASSIGNED"};
    const patient=await client.patients.findUnique({where:{id:patientId}});
    const profile=await client.professional_profiles.findUnique({where:{user_id:actorId},include:{[profileUser]:true}});
    if(!patient||!profile)return {encounter:null,reason:"NOT_FOUND"};
    checkBirthDate(data.encounterDate,patient);
    const identity={id:patient.id,firstNames:patient.first_names,lastNames:patient.last_names,rut:patient.rut,birthDate:patient.birth_date.toISOString().slice(0,10),phone:patient.phone,email:patient.email};
    const professional={id:actorId,firstName:profile[profileUser].first_name,lastName:profile[profileUser].last_name};
    const created=await client.clinical_encounters.create({data:{
      appointment_id:appointment?.id??null,patient_id:patientId,professional_id:actorId,created_by:actorId,updated_by:actorId,
      encounter_type:data.encounterType,encounter_date:new Date(data.encounterDate+"T00:00:00Z"),form_version:data.formVersion,
      form_data:data.formData??Prisma.DbNull,patient_snapshot:identity,professional_snapshot:professional,
      request_key:requestKey??null,request_hash:requestKey?hash:null,
      reason_for_visit:data.reasonForVisit,anamnesis:data.anamnesis,examination:data.examination,diagnosis:data.diagnosis,indications:data.indications,
    }});
    await recordVersion(client,created.id,actorId,"CREATED",["encounterType","encounterDate","formData","reasonForVisit","anamnesis"]);
    return {encounter:await findEncounterWithClient(client,created.id),reason:null};
  },{isolationLevel:"Serializable"}).catch(async(error)=>{
    if(error.code==="P2002"){
      if(requestKey){const row=await prisma.clinical_encounters.findUnique({where:{request_key:requestKey}});if(row)return repeated(prisma,row);}
      clinicalInvalid("Ya existe una atención para esta reserva u operación.","CLINICAL_ENCOUNTER_ALREADY_EXISTS",409);
    }throw error;
  });
}
async function loadAddenda(client,id){
  return (await client.clinical_encounter_addenda.findMany({where:{encounter_id:id},include:{professional_profiles:{include:{[profileUser]:true}}},orderBy:[{created_at:"asc"},{id:"asc"}]})).map(mapAddendum);
}
export async function findClinicalEncounterById(id) {
  const [row,addenda,revisions]=await Promise.all([
    prisma.clinical_encounters.findUnique({where:{id},include:encounterInclude}),loadAddenda(prisma,id),
    prisma.clinical_encounter_events.findMany({where:{encounter_id:id,record_version:{not:null}},include:{professional_profiles:{include:{[profileUser]:true}}},orderBy:[{record_version:"desc"},{id:"desc"}]})
  ]);
  return row?mapEncounter(row,{addenda,revisions:revisions.map((r)=>({version:r.record_version,recordedAt:r.created_at,eventType:r.event_type,changedFields:r.changed_fields,actor:{id:r.performed_by,firstName:r.professional_profiles[profileUser].first_name,lastName:r.professional_profiles[profileUser].last_name},snapshot:r.record_snapshot}))}):null;
}
export async function findClinicalEncounterByAppointmentId(appointmentId){
  const row=await prisma.clinical_encounters.findUnique({where:{appointment_id:appointmentId},select:{id:true}});
  return row?findClinicalEncounterById(row.id):null;
}
export async function updateClinicalEncounter(id,input,actorId) {
  return retryTransaction(prisma,async(client)=>{
    await client.$queryRaw`SELECT id FROM clinical_encounters WHERE id=${id}::uuid FOR UPDATE`;
    const row=await client.clinical_encounters.findUnique({where:{id}});
    if(!row)return {encounter:null,reason:"NOT_FOUND"};
    if(row.professional_id!==actorId||!await hasClinicalAssignment(row.patient_id,actorId,undefined,client))return {encounter:null,reason:"NOT_ASSIGNED"};
    if(row.status!=="DRAFT")return {encounter:null,reason:"FINALIZED"};
    if(row.record_version!==input.expectedVersion)versionConflict();
    const changes=input.changes;
    if(row.encounter_type==="GENERAL"&&Object.hasOwn(changes,"reasonForVisit")&&!changes.reasonForVisit.trim())clinicalInvalid("El motivo de consulta es obligatorio para la ficha general.");
    if(changes.encounterDate)checkBirthDate(changes.encounterDate,row.patient_snapshot??await client.patients.findUnique({where:{id:row.patient_id}}));
    const data=Object.fromEntries(Object.entries(changes).filter(([key])=>Object.hasOwn(ENCOUNTER_COLUMNS,key)).map(([key,value])=>[ENCOUNTER_COLUMNS[key],value]));
    if(Object.hasOwn(changes,"formData"))data.form_data=validateClinicalFormData(row.encounter_type,changes.formData)??Prisma.DbNull;
    if(Object.hasOwn(changes,"encounterDate"))data.encounter_date=new Date(changes.encounterDate+"T00:00:00Z");
    await client.clinical_encounters.update({where:{id},data:{...data,record_version:row.record_version+1,updated_by:actorId}});
    await recordVersion(client,id,actorId,"UPDATED",Object.keys(changes));
    return {encounter:await findEncounterWithClient(client,id),reason:null};
  },{isolationLevel:"Serializable"});
}
export async function finalizeClinicalEncounter(id,actorId,finalizedAt,input) {
  return retryTransaction(prisma,async(client)=>{
    await client.$queryRaw`SELECT id FROM clinical_encounters WHERE id=${id}::uuid FOR UPDATE`;
    const row=await client.clinical_encounters.findUnique({where:{id},include:{appointments:true}});
    if(!row)return {encounter:null,reason:"NOT_FOUND"};
    if(row.professional_id!==actorId||!await hasClinicalAssignment(row.patient_id,actorId,undefined,client))return {encounter:null,reason:"NOT_ASSIGNED"};
    if(row.status==="FINALIZED")return {encounter:await findEncounterWithClient(client,id),reason:null};
    if(row.record_version!==input.expectedVersion)versionConflict();
    if(row.appointments&&row.appointments.status!=="CHECKED_IN")return {encounter:null,reason:"INVALID_APPOINTMENT_STATUS"};
    if(row.appointments&&(row.appointments.patient_id!==row.patient_id||row.appointments.professional_id!==actorId))return {encounter:null,reason:"NOT_ASSIGNED"};
    if(row.encounter_type==="GENERAL"&&(!row.examination||!row.diagnosis))return {encounter:null,reason:"INCOMPLETE"};
    if(row.encounter_type==="OPTOMETRY"&&!row.reason_for_visit.trim())clinicalInvalid("Registre el motivo de consulta antes de finalizar.","INCOMPLETE_CLINICAL_ENCOUNTER",409);
    if(row.encounter_type==="CONTACTOLOGY"&&!row.anamnesis&&!hasClinicalValue(row.form_data))clinicalInvalid("Registre información de la evaluación antes de finalizar.","INCOMPLETE_CLINICAL_ENCOUNTER",409);
    validateClinicalFormData(row.encounter_type,row.form_data,{final:true});
    await client.clinical_encounters.update({where:{id},data:{status:"FINALIZED",finalized_at:finalizedAt,updated_by:actorId,record_version:row.record_version+1}});
    if(row.appointment_id){
      await client.appointments.update({where:{id:row.appointment_id},data:{status:"COMPLETED",updated_by:actorId}});
      await client.appointment_events.create({data:{appointment_id:row.appointment_id,event_type:"STATUS_CHANGED",new_status:"COMPLETED",previous_status:"CHECKED_IN",performed_by:actorId,details:"Atención clínica finalizada."}});
    }
    await recordVersion(client,id,actorId,"FINALIZED",["status"]);
    return {encounter:await findEncounterWithClient(client,id),reason:null};
  },{isolationLevel:"Serializable"});
}
export async function addClinicalEncounterAddendum(id,data,actorId,requestKey) {
  return retryTransaction(prisma,async(client)=>{
    await client.$queryRaw`SELECT id FROM clinical_encounters WHERE id=${id}::uuid FOR SHARE`;
    const row=await client.clinical_encounters.findUnique({where:{id}});
    if(!row)return {addendum:null,reason:"NOT_FOUND"};
    if(row.professional_id!==actorId)return {addendum:null,reason:"NOT_ASSIGNED"};
    if(row.status!=="FINALIZED")return {addendum:null,reason:"NOT_FINALIZED"};
    await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"clinical-addendum:"+requestKey},0))::text`;
    const existing=await client.clinical_encounter_addenda.findUnique({where:{request_key:requestKey},include:{professional_profiles:{include:{[profileUser]:true}}}});
    if(existing){
      if(existing.encounter_id!==id||existing.authored_by!==actorId||existing.reason!==data.reason||existing.content!==data.content)clinicalInvalid("El identificador corresponde a otra adenda.","IDEMPOTENCY_CONFLICT",409);
      return {addendum:mapAddendum(existing),reason:null};
    }
    const created=await client.clinical_encounter_addenda.create({data:{encounter_id:id,authored_by:actorId,content:data.content,reason:data.reason,request_key:requestKey},include:{professional_profiles:{include:{[profileUser]:true}}}});
    await client.clinical_encounter_events.create({data:{encounter_id:id,event_type:"ADDENDUM_ADDED",performed_by:actorId,changed_fields:["addendum:"+created.id]}});
    return {addendum:mapAddendum(created),reason:null};
  });
}
export async function listPatientClinicalHistory(patientId,professionalId,page=1){
  const where={patient_id:patientId,OR:[{status:"FINALIZED"},...(professionalId?[{status:"DRAFT",professional_id:professionalId}]:[])]};
  const [rows,total]=await prisma.$transaction([prisma.clinical_encounters.findMany({where,include:encounterInclude,orderBy:[{encounter_date:{sort:"desc",nulls:"last"}},{created_at:"desc"},{id:"desc"}],take:20,skip:(page-1)*20}),prisma.clinical_encounters.count({where})]);
  return {encounters:rows.map((row)=>{const result=mapEncounter(row);return {id:result.id,type:result.type,recordNumber:result.recordNumber,encounterDate:result.encounterDate,createdAt:result.createdAt,status:result.status,professional:result.professional,version:result.version,appointmentId:result.appointmentId};}),page,total,totalPages:Math.ceil(total/20)};
}
