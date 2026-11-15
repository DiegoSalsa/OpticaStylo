import assert from "node:assert/strict";
import test from "node:test";
import { isAdultBirthDate, validateAccountBirthDate } from "../../src/utils/customer-account-age.js";

test("permite crear una cuenta desde el cumpleaños 18 en la fecha de Chile", () => {
  const now = new Date("2026-11-15T15:00:00Z");
  assert.equal(isAdultBirthDate("2008-11-15", now), true);
  assert.equal(isAdultBirthDate("2008-11-16", now), false);
  assert.equal(validateAccountBirthDate("2008-11-15", now), "2008-11-15");
});

test("el cambio de día UTC conserva el límite de edad en Chile", () => {
  const now = new Date("2026-11-16T01:00:00Z");
  assert.equal(isAdultBirthDate("2008-11-16", now), false);
  assert.throws(() => validateAccountBirthDate("2015-01-01", now), { code: "ADULT_ACCOUNT_REQUIRED" });
});

test("exige una fecha real para confirmar que el titular es adulto", () => {
  for (const value of [null, "", "1990-02-30", "fecha", "2999-01-01"]) {
    assert.throws(() => validateAccountBirthDate(value));
  }
});
