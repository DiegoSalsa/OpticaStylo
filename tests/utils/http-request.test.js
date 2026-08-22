import assert from "node:assert/strict";
import test from "node:test";

import { readJsonBody, readMultipartFormData } from "../../src/utils/http-request.js";

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

test("lee una carga multipart dentro del límite real", async () => {
  const form = new FormData();
  form.set("image", new Blob(["imagen"], { type: "image/png" }), "receta.png");
  const request = new Request("http://localhost/api/recetas", { method: "PUT", body: form });
  const result = await readMultipartFormData(request, 1_024);
  assert.equal((await result.get("image").text()), "imagen");
});

test("rechaza una carga multipart sin Content-Length al exceder el límite", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("contenido demasiado extenso"));
      controller.close();
    },
  });
  const request = new Request("http://localhost/api/recetas", {
    body: stream,
    duplex: "half",
    headers: { "Content-Type": "multipart/form-data; boundary=prueba" },
    method: "PUT",
  });
  await assert.rejects(
    () => readMultipartFormData(request, 5),
    (error) => error.code === "REQUEST_BODY_TOO_LARGE" && error.status === 413,
  );
});
