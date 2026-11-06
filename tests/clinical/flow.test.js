import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { database, data, prescription } from "../prescriptions/helpers.js";
import { evaluation } from "../evaluation-data.js";
import { inventoryDemo } from "../inventory/data.js";
import { clinicalDemo as d, optometryData, contactologyData } from "./data.js";
import { clinicalDateToday } from "../../src/config/clinical-forms.js";
let db, professional, colleague, admin, sales, opt, contact;
async function request(path, {
  cookie = professional,
  body,
  method = "GET",
  key
} = {}) {
  return fetch(process.env.EVALUATION_HTTP_URL + path, {
    method,
    headers: {
      ...(cookie ? {
        cookie
      } : {}),
      ...(body ? {
        "Content-Type": "application/json"
      } : {}),
      ...(key ? {
        "X-Idempotency-Key": key
      } : {})
    },
    ...(body ? {
      body: JSON.stringify(body)
    } : {}),
    signal: AbortSignal.timeout(30000)
  });
}
async function login(email) {
  const r = await request("/api/auth/login", {
    cookie: null,
    method: "POST",
    body: {
      email,
      password: evaluation.password
    }
  });
  await data(r);
  return r.headers.getSetCookie()[0].split(";")[0];
}
const base = (type = "OPTOMETRY") => ({
  patientId: d.patientId,
  encounterType: type,
  encounterDate: clinicalDateToday(),
  reasonForVisit: "Evaluación clínica exclusivamente sintética",
  anamnesis: "Anamnesis sintética",
  formData: type === "OPTOMETRY" ? optometryData() : contactologyData()
});
async function create(body = base(), key = randomUUID()) {
  return data(await request("/api/clinical-encounters", {
    body,
    method: "POST",
    key
  }), 201);
}
before(async () => {
  db = database();
  await db.public_request_rate_limits.deleteMany();
  [professional, colleague, admin, sales] = await Promise.all([login(d.email), login(d.colleagueEmail), login(evaluation.adminEmail), login(inventoryDemo.staffEmail)]);
});
after(async () => {
  await db.$disconnect();
});
test("Antecedentes sin ficha devuelven vacío y un profesional clínico no opera caja",async()=>{
  const empty=await data(await request(`/api/patients/${d.patientId}/medical-record`));
  assert.equal(empty.record,null);assert.deepEqual(empty.revisions,[]);
  assert.equal((await request("/api/cash-register",{method:"POST",body:{branchId:inventoryDemo.branches[0],openingAmountCents:100}})).status,403);
});

test("Optometría sin reserva: todos los campos, autoría e idempotencia", async () => {
  const body = base(),
    key = randomUUID();
  opt = await create(body, key);
  assert.equal(opt.professional.id, d.professionalId);
  assert.equal(opt.patient.id, d.patientId);
  assert.equal(opt.appointmentId, null);
  assert.deepEqual(opt.formData, optometryData());
  assert.equal((await create(body, key)).id, opt.id);
  assert.equal((await request("/api/clinical-encounters", {
    method: "POST",
    key,
    body: {
      ...body,
      reasonForVisit: "Otra"
    }
  })).status, 409);
  const row = await db.clinical_encounters.findUniqueOrThrow({
    where: {
      id: opt.id
    }
  });
  assert.deepEqual(row.form_data, optometryData());
  assert.equal(row.record_version, 1);
  assert.equal(await db.clinical_encounter_events.count({
    where: {
      encounter_id: opt.id,
      record_version: 1
    }
  }), 1);
});
test("Contactología con reserva: persistencia estructurada y orden explícito", async () => {
  contact = await create({
    ...base("CONTACTOLOGY"),
    appointmentId: d.appointmentId
  });
  const expected = contactologyData();
  expected.overRefraction.rightEye.sphere = 0.3;
  assert.deepEqual(contact.formData, expected);
  assert.equal(contact.appointmentId, d.appointmentId);
  const row = await db.clinical_encounters.findUniqueOrThrow({
    where: {
      id: contact.id
    }
  });
  assert.deepEqual(row.form_data, expected);
  assert.equal((await request("/api/clinical-encounters", {
    body: {
      ...base(),
      appointmentId: d.appointmentId
    },
    method: "POST",
    key: randomUUID()
  })).status, 409);
});
test("Reserva recupera su ficha para el profesional y oculta el borrador a un colega",async()=>{
  const path=`/api/clinical-encounters?appointmentId=${d.appointmentId}`;
  assert.equal((await data(await request(path))).id,contact.id);
  assert.equal((await request(path,{cookie:colleague})).status,404);
  const notArrived=await db.appointments.create({data:{patient_id:d.otherPatientId,professional_id:d.professionalId,start_at:new Date("2042-02-01T12:00:00Z"),end_at:new Date("2042-02-01T12:30:00Z"),status:"CONFIRMED",created_by:evaluation.adminId}});
  await db.appointments.update({where:{id:d.appointmentId},data:{status:"CONFIRMED"}});
  try {
    assert.equal((await request("/api/clinical-encounters",{method:"POST",key:randomUUID(),body:{...base("CONTACTOLOGY"),appointmentId:d.appointmentId}})).status,409);
    assert.equal((await request(`/api/patients/${d.otherPatientId}/medical-record`,{method:"PATCH",body:{expectedRevision:0,allergies:"Intento sintético sin presencia ni asignación presencial"}})).status,403);
  }
  finally {await db.appointments.update({where:{id:d.appointmentId},data:{status:"CHECKED_IN"}});await db.appointments.delete({where:{id:notArrived.id}});}
});

test("Borrador incompleto se guarda, recupera y conserva versiones", async () => {
  const draft = await create({
    ...base("CONTACTOLOGY"),
    formData: {},
    anamnesis: ""
  });
  const saved = await data(await request(`/api/clinical-encounters/${draft.id}`, {
    method: "PATCH",
    body: {
      expectedVersion: 1,
      anamnesis: "Retomada"
    }
  }));
  assert.equal(saved.version, 2);
  const older = await data(await request(`/api/clinical-encounters/${draft.id}?revision=1`));
  assert.equal(older.anamnesis, null);
  assert.equal(older.isHistoricalVersion, true);
  assert.equal((await data(await request(`/api/clinical-encounters/${draft.id}`))).anamnesis, "Retomada");
});
test("Dos sesiones reales: una edición gana y la otra recibe conflicto", async () => {
  const results = await Promise.all(["Sesión A", "Sesión B"].map(anamnesis => request(`/api/clinical-encounters/${opt.id}`, {
    method: "PATCH",
    body: {
      expectedVersion: opt.version,
      anamnesis
    }
  })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const winner = await data(results.find(r => r.status === 200));
  opt = winner;
  assert.equal((await db.clinical_encounters.findUniqueOrThrow({
    where: {
      id: opt.id
    }
  })).record_version, 2);
});
test("Ventas, administración, anónimo y colega no leen borradores", async () => {
  for (const cookie of [admin, sales, colleague, null]) {
    const r = await request(`/api/clinical-encounters/${opt.id}`, {
      cookie
    });
    assert.ok([401, 403, 404].includes(r.status));
    assert.doesNotMatch(await r.text(), /AG sintético|Sesión/);
  }
  for (const cookie of [admin, sales]) assert.equal((await request(`/api/patients/${d.patientId}/clinical-history`, {
    cookie
  })).status, 403);
});
test("Identidad similar, IDs cruzados y paciente sin asignación quedan excluidos", async () => {
  const list = await data(await request("/api/clinical-encounters/patients?search=Paciente"));
  assert.equal(list.items.some(p => p.id === d.otherPatientId), false);
  assert.equal((await request(`/api/clinical-encounters/${opt.id}?patientId=${d.otherPatientId}`)).status, 404);
  assert.equal((await request(`/api/patients/${d.otherPatientId}/clinical-history`)).status, 403);
  assert.equal((await request("/api/clinical-encounters", {
    method: "POST",
    key: randomUUID(),
    body: {
      ...base(),
      patientId: d.otherPatientId
    }
  })).status, 403);
  assert.equal((await request("/api/clinical-encounters", {
    method: "POST",
    key: randomUUID(),
    body: {
      ...base(),
      professionalId: d.colleagueId
    }
  })).status, 400);
});
test("Antecedentes permanentes evitan sobrescritura y conservan revisión", async () => {
  const path = `/api/patients/${d.patientId}/medical-record`;
  const first = await data(await request(path, {
    method: "PATCH",
    body: {
      expectedRevision: 0,
      allergies: "Antecedente sintético"
    }
  }));
  assert.equal(first.revision, 1);
  assert.equal((await request(path, {
    method: "PATCH",
    body: {
      expectedRevision: 0,
      allergies: "Sobrescritura"
    }
  })).status, 409);
  const med = await data(await request(path));
  assert.equal(med.revisions.length, 1);
  assert.equal(med.record.allergies, "Antecedente sintético");
});
test("La identidad histórica y edad permanecen tras corregir el paciente central", async () => {
  const before = opt.patientSnapshot;
  await db.patients.update({
    where: {
      id: d.patientId
    },
    data: {
      first_names: "Nombre central corregido sintético",
      birth_date: new Date("1990-01-01")
    }
  });
  const saved = await data(await request(`/api/clinical-encounters/${opt.id}`));
  assert.deepEqual(saved.patientSnapshot, before);
  assert.notEqual(saved.patient.firstNames, before.firstNames);
  await db.patients.update({
    where: {
      id: d.patientId
    },
    data: {
      first_names: before.firstNames,
      birth_date: new Date(before.birthDate)
    }
  });
});
test("Finalización exige confirmación y versión, admite receta explícita sin automatizar", async () => {
  assert.equal((await request(`/api/clinical-encounters/${contact.id}/finalize`, {
    method: "POST",
    body: {
      expectedVersion: contact.version
    }
  })).status, 400);
  const salesBefore = await db.sales.count(),
    movesBefore = await db.inventory_movements.count();
  assert.equal(await db.optical_prescriptions.count({
    where: {
      encounter_id: contact.id
    }
  }), 0);
  assert.equal((await request(`/api/clinical-encounters/${contact.id}/finalize`,{method:"POST",body:{expectedVersion:contact.version,confirm:true,finalizedAt:"2000-01-01T00:00:00Z"}})).status,400);
  const beforeFinalization=Date.now();
  contact = await data(await request(`/api/clinical-encounters/${contact.id}/finalize`, {
    method: "POST",
    body: {
      expectedVersion: contact.version,
      confirm: true
    }
  }));
  assert.equal(contact.status, "FINALIZED");
  assert.ok(new Date(contact.finalizedAt).getTime()>=beforeFinalization-1000);
  assert.ok(new Date(contact.finalizedAt).getTime()<=Date.now()+1000);
  assert.equal((await db.appointments.findUniqueOrThrow({
    where: {
      id: d.appointmentId
    }
  })).status, "COMPLETED");
  assert.equal(await db.optical_prescriptions.count({
    where: {
      encounter_id: contact.id
    }
  }), 0);
  assert.equal(await db.sales.count(), salesBefore);
  assert.equal(await db.inventory_movements.count(), movesBefore);
  const rx = await data(await request(`/api/clinical-encounters/${opt.id}/prescriptions`, {
    method: "POST",
    body: prescription
  }), 201);
  assert.equal(rx.encounterId, opt.id);
  opt = await data(await request(`/api/clinical-encounters/${opt.id}/finalize`, {
    method: "POST",
    body: {
      expectedVersion: opt.version,
      confirm: true
    }
  }));
  const view = await data(await request(`/api/prescriptions/${rx.id}`, {
    cookie: sales
  }));
  assert.equal(view.encounterId, undefined);
  assert.equal(view.anamnesis, undefined);
  assert.deepEqual(view.rightEye, prescription.rightEye);
});
test("Ficha finalizada y auditoría inmutables en HTTP y PostgreSQL", async () => {
  assert.equal((await request(`/api/clinical-encounters/${contact.id}`, {
    method: "PATCH",
    body: {
      expectedVersion: contact.version,
      anamnesis: "Cambio indebido"
    }
  })).status, 409);
  await assert.rejects(db.clinical_encounters.update({
    where: {
      id: contact.id
    },
    data: {
      anamnesis: "Cambio directo"
    }
  }));
  await assert.rejects(db.clinical_encounters.delete({
    where: {
      id: contact.id
    }
  }));
  await assert.rejects(db.clinical_encounter_events.deleteMany({
    where: {
      encounter_id: contact.id
    }
  }));
});
test("Adenda permanente idempotente y detalle finalizado para colega asignado", async () => {
  const body = {
      reason: "Corrección sintética",
      content: "Se agrega hallazgo sin borrar original"
    },
    key = randomUUID(),
    path = `/api/clinical-encounters/${contact.id}/addenda`;
  const a = await data(await request(path, {
    method: "POST",
    body,
    key
  }), 201);
  assert.equal((await data(await request(path, {
    method: "POST",
    body,
    key
  }), 201)).id, a.id);
  await assert.rejects(db.clinical_encounter_addenda.update({
    where: {
      id: a.id
    },
    data: {
      content: "Reescritura"
    }
  }));
  assert.equal((await data(await request(`/api/clinical-encounters/${contact.id}`, {
    cookie: colleague
  }))).addenda.length, 1);
  assert.equal((await request(path, {
    cookie: colleague,
    method: "POST",
    body,
    key: randomUUID()
  })).status, 403);
});
test("Historial con ambos formatos, borradores propios y páginas acotadas", async () => {
  const h = await data(await request(`/api/patients/${d.patientId}/clinical-history`));
  assert.ok(h.encounters.some(e => e.id === opt.id && e.type === "OPTOMETRY"));
  assert.ok(h.encounters.some(e => e.id === contact.id && e.type === "CONTACTOLOGY"));
  assert.ok(h.encounters.some(e => e.status === "DRAFT"));
  const other = await data(await request(`/api/patients/${d.patientId}/clinical-history`, {
    cookie: colleague
  }));
  assert.ok(other.encounters.every(e => e.status === "FINALIZED"));
  assert.equal((await data(await request(`/api/patients/${d.patientId}/clinical-history?page=2`))).encounters.length, 0);
});
test("Impresión privada completa, sin ejecución de texto clínico y con auditoría", async () => {
  for (const e of [opt, contact]) {
    const r = await request(`/api/clinical-encounters/${e.id}/print`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control"), /private, no-store/);
    const html = await r.text();
    assert.match(html, /FINALIZADA|Finalizada/i);
    if (e.type === "OPTOMETRY") {
      assert.match(html, /&lt;script&gt;/);
      assert.doesNotMatch(html, /<script>alert/);
    } else {
      assert.match(html, /Hallazgo PRE/);
      assert.match(html, /Hallazgo POST/);
      assert.match(html, /Prueba sintética 3/);
      assert.match(html, /\+1.1/);
    }
    assert.equal((await request(`/api/clinical-encounters/${e.id}/print`, {
      cookie: sales
    })).status, 403);
    assert.equal((await request(`/api/clinical-encounters/${e.id}/print`, {
      cookie: null
    })).status, 401);
  }
  assert.ok((await db.clinical_encounter_events.count({
    where: {
      encounter_id: contact.id,
      event_type: "PRINTED"
    }
  })) > 0);
});
test("Recepción asigna y revoca atención sin acceder a sus datos clínicos", async () => {
  const path = "/api/clinical-care-assignments";
  const options = await data(await request(path + "?options=true", {
    cookie: admin
  }));
  assert.ok(options.some(p => p.id === d.professionalId));
  const a = await data(await request(path, {
    cookie: sales,
    method: "POST",
    body: {
      patientId: d.otherPatientId,
      professionalId: d.professionalId,
      reason: "Identidad sintética verificada",
      confirmPatient: true
    }
  }), 201);
  assert.equal((await request(`/api/clinical-encounters/patients?patientId=${d.otherPatientId}`)).status, 200);
  await data(await request(path, {
    cookie: admin,
    method: "POST",
    body: {
      action: "REVOKE",
      id: a.id,
      reason: "Prueba de revocación"
    }
  }), 201);
  assert.equal((await request(`/api/clinical-encounters/patients?patientId=${d.otherPatientId}`)).status, 404);
  await assert.rejects(db.clinical_care_assignments.delete({
    where: {
      id: a.id
    }
  }));
});
test("Ficha general heredada incompleta no se finaliza ni cambia su historial",async()=>{
  const legacy=await db.clinical_encounters.create({data:{patient_id:d.patientId,professional_id:d.professionalId,created_by:d.professionalId,updated_by:d.professionalId,reason_for_visit:"Ficha general heredada exclusivamente sintética"}});
  const response=await request(`/api/clinical-encounters/${legacy.id}/finalize`,{method:"POST",body:{expectedVersion:1,confirm:true}});
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,"CLINICAL_INCOMPLETE");
  const saved=await db.clinical_encounters.findUniqueOrThrow({where:{id:legacy.id}});assert.equal(saved.status,"DRAFT");assert.equal(saved.record_version,1);assert.equal(saved.finalized_at,null);
});

test("Cuenta clínica deshabilitada pierde inmediatamente consulta e impresión", async () => {
  await db.users.update({
    where: {
      id: d.colleagueId
    },
    data: {
      is_active: false
    }
  });
  try {
    assert.equal((await request(`/api/clinical-encounters/${contact.id}`, {
      cookie: colleague
    })).status, 401);
    assert.equal((await request(`/api/clinical-encounters/${contact.id}/print`, {
      cookie: colleague
    })).status, 401);
  } finally {
    await db.users.update({
      where: {
        id: d.colleagueId
      },
      data: {
        is_active: true
      }
    });
  }
});
