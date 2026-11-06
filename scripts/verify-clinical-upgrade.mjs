import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/db/prisma.js";
import { requireEvaluationDatabase } from "../tests/evaluation-data.js";
import { fixtureRut } from "../tests/rut-fixture.js";
requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
if (process.env.CLINICAL_TEST_MODE !== "true") throw new Error("Verificación exclusiva de la base sintética.");
const id = "41000000-0000-4000-8000-000000000001",
  patient = "41000000-0000-4000-8000-000000000002",
  appointment = "41000000-0000-4000-8000-000000000003",
  encounter = "41000000-0000-4000-8000-000000000004";
const file = path.join(process.env.PRESCRIPTION_TEST_OUTPUT, "clinical-legacy-before.json");
async function snapshot() {
  return prisma.$queryRaw`SELECT to_jsonb(e) AS encounter,(SELECT jsonb_agg(to_jsonb(a)) FROM clinical_encounter_addenda a WHERE a.encounter_id=e.id) AS addenda,(SELECT jsonb_agg(to_jsonb(p)) FROM optical_prescriptions p WHERE p.encounter_id=e.id) AS prescriptions,(SELECT jsonb_agg(to_jsonb(r)) FROM medical_record_revisions r JOIN medical_records m ON m.id=r.medical_record_id WHERE m.patient_id=e.patient_id) AS revisions FROM clinical_encounters e WHERE e.id=${encounter}::uuid`;
}
try {
  if (process.argv[2] === "before") {
    await prisma.$transaction(async c => {
      await c.$executeRaw`INSERT INTO users(id,email,first_name,last_name,password_hash) VALUES(${id}::uuid,'historico@example.invalid','Histórico sintético','Sin acceso','sin-clave-utilizable')`;
      await c.$executeRaw`INSERT INTO professional_profiles(user_id,appointment_duration_minutes,slot_interval_minutes,created_by,updated_by) VALUES(${id}::uuid,60,30,${id}::uuid,${id}::uuid)`;
      await c.$executeRaw`INSERT INTO patients(id,rut,first_names,last_names,birth_date,email,phone,address) VALUES(${patient}::uuid,${fixtureRut(9499)},'Paciente histórico','Sintético','1980-01-01','historico-paciente@example.invalid','+56912345678','Dirección sintética')`;
      await c.$executeRaw`INSERT INTO appointments(id,patient_id,professional_id,start_at,end_at,status,created_by) VALUES(${appointment}::uuid,${patient}::uuid,${id}::uuid,'2001-01-01 14:00Z','2001-01-01 15:00Z','COMPLETED',${id}::uuid)`;
      await c.$executeRaw`INSERT INTO clinical_encounters(id,appointment_id,patient_id,professional_id,reason_for_visit,anamnesis,examination,diagnosis,indications,status,finalized_at,created_by,updated_by) VALUES(${encounter}::uuid,${appointment}::uuid,${patient}::uuid,${id}::uuid,'Motivo histórico','Anamnesis histórica','Examen histórico','Diagnóstico histórico','Indicación histórica','FINALIZED','2001-01-01 15:00Z',${id}::uuid,${id}::uuid)`;
      await c.$executeRaw`INSERT INTO clinical_encounter_addenda(encounter_id,reason,content,authored_by) VALUES(${encounter}::uuid,'Adenda histórica','Contenido histórico íntegro',${id}::uuid)`;
      await c.$executeRaw`INSERT INTO optical_prescriptions(encounter_id,version,right_sphere,right_cylinder,left_sphere,left_cylinder,issued_by) VALUES(${encounter}::uuid,1,1.25,0,-1.35,0,${id}::uuid)`;
      await c.$executeRaw`INSERT INTO medical_records(patient_id,allergies,created_by,updated_by) VALUES(${patient}::uuid,'Antecedente histórico',${id}::uuid,${id}::uuid)`;
    });
    await writeFile(file, JSON.stringify(await snapshot()));
  } else {
    const before = JSON.parse(await readFile(file, "utf8")),
      after = await snapshot();
    for (const [key, value] of Object.entries(before[0].encounter)) assert.deepEqual(after[0].encounter[key], value, key);
    assert.deepEqual(after[0].encounter.encounter_type, "GENERAL");
    assert.equal(after[0].encounter.encounter_date, null);
    assert.equal(after[0].encounter.record_number, null);
    assert.equal(after[0].encounter.patient_snapshot, null);
    for (const key of ["prescriptions", "revisions"]) assert.deepEqual(after[0][key], before[0][key]);
    for (const [key, value] of Object.entries(before[0].addenda[0])) assert.deepEqual(after[0].addenda[0][key], value, key);
    console.log("Migración desde fase 3 verificada: atención finalizada, receta, addenda y antecedentes conservados campo por campo; sin inventar fecha ni identificación histórica.");
  }
} finally {
  await prisma.$disconnect();
}
