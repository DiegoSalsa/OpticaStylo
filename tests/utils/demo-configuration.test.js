import assert from "node:assert/strict";
import test from "node:test";
import { demoDate, demoInstant } from "../../scripts/demo-configuration.mjs";
import { spawnSync } from "node:child_process";

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

test("la preparación rechaza una base remota o local ajena antes de conectar", () => {
  for (const databaseUrl of ["postgresql://demo@production.invalid/opticastylo", "postgresql://demo@127.0.0.1/opticastylo"]) {
    const result = spawnSync(process.execPath, ["scripts/prepare-demo-data.mjs"], {
      env: { ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl, DEMO_PREPARE_CONFIRM: "YES", ACADEMIC_ISOLATION: "true" }, encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /esquema aislado|PostgreSQL local dedicado/);
  }
});

test("incluso una base con nombre aislado exige confirmación manual", () => {
  const schema = "stylo_e2e_0123456789abcdef";
  const result = spawnSync(process.execPath, ["scripts/prepare-demo-data.mjs"], {
    env: { ...process.env, NODE_ENV: "test", DATABASE_URL: `postgresql://demo@127.0.0.1/stylo_academic_0123456789abcdef?schema=${schema}`,
      STORE_E2E_SCHEMA: schema, ACADEMIC_ISOLATION: "true", DEMO_PREPARE_CONFIRM: "", DEMO_DATE: "2026-10-22" }, encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requiere DEMO_PREPARE_CONFIRM/);
});
