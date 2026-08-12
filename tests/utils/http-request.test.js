import assert from "node:assert/strict";
import test from "node:test";

import { readJsonBody } from "../../src/utils/http-request.js";

test("lee un cuerpo JSON válido", async () => {
  const request = new Request("http://localhost/api/users", {
    body: JSON.stringify({ email: "user@example.com" }),
    method: "POST",
  });

  assert.deepEqual(await readJsonBody(request), { email: "user@example.com" });
});

test("rechaza un cuerpo con JSON inválido", async () => {
  const request = new Request("http://localhost/api/users", {
    body: "{invalid",
    method: "POST",
  });

  await assert.rejects(
    () => readJsonBody(request),
    (error) => error.code === "INVALID_JSON" && error.status === 400,
  );
});

test("rechaza cuerpos que exceden el límite", async () => {
  const request = new Request("http://localhost/api/users", {
    body: JSON.stringify({ value: "contenido extenso" }),
    method: "POST",
  });

  await assert.rejects(
    () => readJsonBody(request, 5),
    (error) => error.code === "REQUEST_BODY_TOO_LARGE" && error.status === 413,
  );
});
