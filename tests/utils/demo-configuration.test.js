import assert from "node:assert/strict";
import test from "node:test";
import { demoDate, demoInstant } from "../../scripts/demo-configuration.mjs";

test("la demo usa mañana en Santiago y permite elegir el 22 de octubre", () => {
  assert.equal(demoDate(undefined, new Date("2026-10-22T01:00:00Z")), "2026-10-22");
  assert.equal(demoDate("2026-10-22"), "2026-10-22");
  assert.throws(() => demoDate("2026-02-30"), /fecha válida/);
});

test("los horarios de demostración respetan verano e invierno de Chile", () => {
  assert.equal(demoInstant("2026-10-22", "09:00").toISOString(), "2026-10-22T12:00:00.000Z");
  assert.equal(demoInstant("2026-07-22", "09:00").toISOString(), "2026-07-22T13:00:00.000Z");
  assert.equal(new Intl.DateTimeFormat("es-CL", { weekday: "long", timeZone: "America/Santiago" }).format(demoInstant("2026-10-22", "09:00")), "jueves");
});
