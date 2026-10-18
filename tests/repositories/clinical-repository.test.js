import assert from "node:assert/strict";
import test from "node:test";
import { mapMedicalRecordRevision } from "../../src/repositories/clinical-repository.js";
import { createSuccessResponse } from "../../src/utils/api-response.js";

test("la ficha con revisiones BIGSERIAL se serializa por HTTP sin perder el identificador",async()=>{
  const revision=mapMedicalRecordRevision({id:9007199254740993n,revision:2,
    general_medical_history:"Antecedente ficticio",recorded_by:"20000000-0000-4000-8000-000000000003",
    recorded_at:new Date("2026-10-18T12:00:00Z"),changed_fields:["generalMedicalHistory"],
    professional_profiles:{users_professional_profiles_user_idTousers:{first_name:"Profesional",last_name:"Prueba"}}});
  const response=createSuccessResponse({revisions:[revision]});
  const payload=await response.json();
  assert.equal(payload.data.revisions[0].id,"9007199254740993");
  assert.equal(payload.data.revisions[0].generalMedicalHistory,"Antecedente ficticio");
});
