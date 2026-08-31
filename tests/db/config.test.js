import assert from "node:assert/strict";
import test from "node:test";

import { getDatabaseConfig } from "../../src/db/config.js";

test("permite PostgreSQL local sin SSL fuera de producción", () => {
  const config = getDatabaseConfig({
    DATABASE_URL: "postgresql://postgres@localhost:5432/opticastylo",
  });

  assert.equal(config.application_name, "optica-stylo");
  assert.equal(config.connectionTimeoutMillis, 5_000);
  assert.equal(config.idleTimeoutMillis, 10_000);
  assert.equal(config.max, 10);
  assert.equal(config.ssl, false);
});

test("rechaza una configuración sin DATABASE_URL", () => {
  assert.throws(
    () => getDatabaseConfig({}),
    /La variable DATABASE_URL es obligatoria/,
  );
});

test("rechaza valores inválidos del pool", () => {
  assert.throws(
    () =>
      getDatabaseConfig({
        DATABASE_POOL_MAX: "0",
        DATABASE_URL: "postgresql://postgres@localhost:5432/opticastylo",
      }),
    /DATABASE_POOL_MAX debe ser un número entero positivo/,
  );
});

test("activa SSL con verificación de certificados", () => {
  const config = getDatabaseConfig({
    DATABASE_SSL: "true",
    DATABASE_URL: "postgresql://postgres@example.com:5432/opticastylo",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(new URL(config.connectionString).searchParams.get("sslmode"), "verify-full");
});

test("exige SSL para Neon y producción", () => {
  assert.throws(
    () => getDatabaseConfig({
      DATABASE_SSL: "false",
      DATABASE_URL: "postgresql://postgres@example.neon.tech:5432/opticastylo",
    }),
    /DATABASE_SSL debe ser true/,
  );
  assert.throws(
    () => getDatabaseConfig({
      DATABASE_SSL: "false",
      DATABASE_URL: "postgresql://postgres@localhost:5432/opticastylo",
      NODE_ENV: "production",
    }),
    /DATABASE_SSL debe ser true/,
  );
});

test("permite PostgreSQL local sin SSL únicamente en la universidad", () => {
  const config = getDatabaseConfig({
    DATABASE_SSL: "false",
    DATABASE_ALLOW_INSECURE_LOCAL: "true",
    DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/opticastylo",
    DEPLOYMENT_ENVIRONMENT: "university",
    NODE_ENV: "production",
  });

  assert.equal(config.ssl, false);
});

test("no permite habilitar conexiones inseguras contra un host remoto", () => {
  assert.throws(
    () => getDatabaseConfig({
      DATABASE_SSL: "false",
      DATABASE_ALLOW_INSECURE_LOCAL: "true",
      DATABASE_URL: "postgresql://postgres@db.institucional.cl:5432/opticastylo",
      DEPLOYMENT_ENVIRONMENT: "university",
      NODE_ENV: "production",
    }),
    /DATABASE_SSL debe ser true/,
  );
});
