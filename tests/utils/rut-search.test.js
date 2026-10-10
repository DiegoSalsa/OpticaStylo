import assert from "node:assert/strict";
import test from "node:test";
import {rutSearchValues} from "../../src/utils/rut-search.js";
test("RUT de búsqueda admite puntos, guion y dígito K sin perder formato almacenado",()=>{
  for(const text of ["12.345.678-5","123456785","12345678-5"]) assert.ok(rutSearchValues(text).includes("12345678-5"));
  assert.ok(rutSearchValues("12345678k").includes("12345678-K"));
  assert.ok(!rutSearchValues("...").includes(""));
});
