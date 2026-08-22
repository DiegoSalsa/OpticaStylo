import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GET,
  POST,
} from "../../src/app/api/internal/transactional-emails/process/route.js";
import { processRequest } from "../../src/app/api/internal/transactional-emails/process/process-request.js";

const route = (path) => readFile(new URL(`../../src/app/api/${path}`, import.meta.url), "utf8");

const workerUrl = "https://example.com/api/internal/transactional-emails/process";
const workerSecret = "secreto-independiente-del-trabajador";

test("la ejecución interna rechaza solicitudes sin el secreto y no ejecuta el lote", async () => {
  let executions = 0;
  const response = await processRequest(new Request(workerUrl), {
    processBatch: async () => {
      executions += 1;
    },
    secret: workerSecret,
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(executions, 0);
});

test("GET y POST leen el secreto del entorno sin fallar antes de autenticar", async () => {
  const previousSecret = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    for (const handler of [GET, POST]) {
      const response = await handler(new Request(workerUrl));
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { success: false });
    }
  } finally {
    if (previousSecret == null) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});

test("la ejecución autorizada devuelve solo el resumen operativo", async () => {
  const request = new Request(workerUrl, {
    headers: { Authorization: `Bearer ${workerSecret}` },
    method: "POST",
  });
  const response = await processRequest(request, {
    processBatch: async (options) => {
      assert.deepEqual(options, { triggerSource: "cron" });
      return {
        claimed: 2,
        deadLetter: 0,
        failed: 0,
        mode: "test",
        recovered: 0,
        sent: 2,
        simulated: 0,
        status: "SUCCESS",
        recipientEmail: "no-debe-salir@example.com",
      };
    },
    secret: workerSecret,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    summary: {
      claimed: 2,
      deadLetter: 0,
      failed: 0,
      mode: "test",
      recovered: 0,
      sent: 2,
      simulated: 0,
      status: "SUCCESS",
    },
  });
});

test("la ejecución autorizada oculta los errores internos", async () => {
  const response = await processRequest(new Request(workerUrl, {
    headers: { Authorization: `Bearer ${workerSecret}` },
  }), {
    processBatch: async () => {
      throw new Error("detalle interno");
    },
    secret: workerSecret,
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false });
});

test("las operaciones globales autentican y delegan la autorización administrativa", async () => {
  const metrics = await route("admin/transactional-emails/route.js");
  const retry = await route("admin/transactional-emails/[emailId]/retry/route.js");
  assert.match(metrics, /authenticateRequest\(request\)/);
  assert.match(metrics, /getTransactionalEmailOperations\(actor\)/);
  assert.match(retry, /authenticateRequest\(request\)/);
  assert.match(retry, /retryFailedTransactionalEmail\(emailId, actor\)/);
});

test("el webhook conserva el cuerpo crudo para verificar la firma", async () => {
  const source = await route("webhooks/resend/route.js");
  assert.match(source, /const rawBody = await request\.text\(\)/);
  assert.match(source, /processResendWebhook\(rawBody, request\.headers\)/);
  assert.doesNotMatch(source, /request\.json\(\)/);
});
