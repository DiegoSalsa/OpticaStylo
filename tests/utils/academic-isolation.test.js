import assert from "node:assert/strict";
import test from "node:test";
import { requireAcademicIsolation } from "../fixtures/academic-data.js";

test("fixtures académicos rechazan bases remotas, schemas ordinarios y falta de aislamiento",()=>{
  const original={DATABASE_URL:process.env.DATABASE_URL,STORE_E2E_SCHEMA:process.env.STORE_E2E_SCHEMA,ACADEMIC_ISOLATION:process.env.ACADEMIC_ISOLATION};
  const schema="stylo_e2e_0123456789abcdef";
  try {
    process.env.ACADEMIC_ISOLATION="true";process.env.STORE_E2E_SCHEMA=schema;
    for(const url of [`postgresql://test:test@example.invalid/stylo_academic_0123456789abcdef?schema=${schema}`,"postgresql://test:test@127.0.0.1/operativa?schema=public",`postgresql://test:test@127.0.0.1/operativa?schema=${schema}`]) {
      process.env.DATABASE_URL=url;assert.throws(()=>requireAcademicIsolation());
    }
    process.env.DATABASE_URL=`postgresql://test:test@127.0.0.1/stylo_academic_0123456789abcdef?schema=${schema}`;
    assert.doesNotThrow(()=>requireAcademicIsolation());
    process.env.ACADEMIC_ISOLATION="false";assert.throws(()=>requireAcademicIsolation());
  } finally {
    for(const [key,value] of Object.entries(original)) if(value===undefined) delete process.env[key];else process.env[key]=value;
  }
});
