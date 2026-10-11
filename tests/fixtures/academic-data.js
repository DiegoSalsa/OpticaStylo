import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { prisma } from "../../src/db/prisma.js";
import { hashPassword } from "../../src/auth/password.js";
import { requireIsolatedStoreDatabase, seedStoreE2e } from "../../scripts/seed-store-e2e.mjs";
import { fixtureRut } from "./management-data.js";

export const academicId = (index) => `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
export const ids = { admin: academicId(1), sales: academicId(2), professional: academicId(3), otherProfessional: academicId(4),
  patient: academicId(10), otherPatient: academicId(11), customer: academicId(20) };

export function requireAcademicIsolation() {
  requireIsolatedStoreDatabase();
  const url = new URL(process.env.DATABASE_URL);
  if (process.env.ACADEMIC_ISOLATION !== "true" || url.hostname !== "127.0.0.1"
    || !/^\/stylo_academic_[0-9a-f]{16}$/.test(url.pathname)) {
    throw new Error("Fixture académico permitido únicamente en PostgreSQL local dedicado.");
  }
}

export async function actorFor(userId) {
  requireAcademicIsolation();
  const roleRows = await prisma.user_roles.findMany({where:{user_id:userId},include:{roles:{include:{role_permissions:{include:{permissions:true}}}}}});
  return { userId, roles:roleRows.map((row)=>row.roles.code), permissions:[...new Set(roleRows.flatMap((row)=>row.roles.role_permissions.map((permission)=>permission.permissions.code)))] };
}

export async function seedAcademicData() {
  requireAcademicIsolation();
  await seedStoreE2e();
  let credentials;
  try { credentials = JSON.parse(await readFile("tmp/academic-validation/demo-credentials.json","utf8")); }
  catch { credentials = { password: `Local_${randomBytes(20).toString("hex")}!` }; await writeFile("tmp/academic-validation/demo-credentials.json",JSON.stringify(credentials)); }
  const passwordHash = await hashPassword(credentials.password);
  for(const [id,role,firstName] of [[ids.admin,"ADMIN","Administrador"],[ids.sales,"SALES","Ventas"],[ids.professional,"CLINICAL_PROFESSIONAL","Profesional"],[ids.otherProfessional,"CLINICAL_PROFESSIONAL","ProfesionalAjeno"]]) {
    const email = `academic-${firstName.toLowerCase()}@example.invalid`;
    await prisma.users.upsert({where:{id},update:{},create:{id,email,password_hash:passwordHash,first_name:firstName,last_name:"Demostración"}});
    const storedRole = await prisma.roles.findUnique({where:{code:role}});
    await prisma.user_roles.upsert({where:{user_id_role_id:{user_id:id,role_id:storedRole.id}},update:{},create:{user_id:id,role_id:storedRole.id}});
  }
  for(const id of [ids.professional,ids.otherProfessional]) {
    await prisma.professional_profiles.upsert({where:{user_id:id},update:{},create:{user_id:id,appointment_duration_minutes:30,slot_interval_minutes:30,created_by:ids.admin,updated_by:ids.admin}});
    for(let day=0;day<7;day++) await prisma.professional_weekly_schedules.upsert({where:{professional_id_day_of_week:{professional_id:id,day_of_week:day}},update:{},create:{professional_id:id,day_of_week:day,is_working:true,start_time:new Date("1970-01-01T09:00:00Z"),end_time:new Date("1970-01-01T18:00:00Z"),break_start:new Date("1970-01-01T13:00:00Z"),break_end:new Date("1970-01-01T14:00:00Z")}});
  }
  for(const [id,index,name] of [[ids.patient,22000,"PacienteFicticio"],[ids.otherPatient,22001,"PacienteAjeno"]]) {
    await prisma.patients.upsert({where:{id},update:{},create:{id,rut:fixtureRut(index),first_names:name,last_names:"Demostración",birth_date:new Date("1990-01-01"),phone:"+56912345678",email:`${name.toLowerCase()}@example.invalid`,address:"Dirección ficticia 123",created_by:ids.admin,updated_by:ids.admin}});
  }
  await prisma.customers.upsert({where:{id:ids.customer},update:{},create:{id:ids.customer,rut:fixtureRut(22002),first_names:"ClienteFicticio",last_names:"Demostración",email:"clienteficticio@example.invalid",phone:"+56912345678",address:"Dirección ficticia 123",created_by:ids.admin,updated_by:ids.admin}});
  return {admin:await actorFor(ids.admin),sales:await actorFor(ids.sales),professional:await actorFor(ids.professional),otherProfessional:await actorFor(ids.otherProfessional)};
}
