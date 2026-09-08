import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("../../prisma/schema.prisma", import.meta.url);
const clientUrl = new URL("../../src/db/prisma.js", import.meta.url);
const packageUrl = new URL("../../package.json", import.meta.url);
const environmentUrl = new URL("../../.env.example", import.meta.url);

test("configura PostgreSQL exclusivamente mediante DATABASE_URL", async () => {
  const schema = await readFile(schemaUrl, "utf8");
  assert.match(schema, /provider\s*=\s*"postgresql"/);
  assert.match(schema, /url\s*=\s*env\("DATABASE_URL"\)/);
});

test("centraliza Prisma Client en una única instancia", async () => {
  const source = await readFile(clientUrl, "utf8");
  assert.match(source, /new PrismaClient/);
  assert.match(source, /globalThis/);
});

test("elimina la configuración del pool pg", async () => {
  const environment = await readFile(environmentUrl, "utf8");
  assert.doesNotMatch(environment, /DATABASE_POOL_MAX|DATABASE_IDLE_TIMEOUT_MS/);
});

test("deja TLS bajo control de la URL PostgreSQL", async () => {
  const environment = await readFile(environmentUrl, "utf8");
  assert.match(environment, /DATABASE_URL=postgresql:\/\//);
  assert.doesNotMatch(environment, /DATABASE_SSL=/);
});

test("no declara pg como dependencia", async () => {
  const manifest = JSON.parse(await readFile(packageUrl, "utf8"));
  assert.equal(manifest.dependencies.pg, undefined);
});

test("genera Prisma Client durante la instalación", async () => {
  const manifest = JSON.parse(await readFile(packageUrl, "utf8"));
  assert.equal(manifest.scripts.postinstall, "prisma generate");
});

test("no habilita APIs raw de Prisma", async () => {
  const source = await readFile(clientUrl, "utf8");
  assert.doesNotMatch(source, /\$(?:query|execute)Raw/);
});
