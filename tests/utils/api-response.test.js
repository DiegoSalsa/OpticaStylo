import assert from "node:assert/strict";
import test from "node:test";

import {
  createErrorResponse,
  createSuccessResponse,
} from "../../src/utils/api-response.js";

test("crea una respuesta exitosa con el contrato común", async () => {
  const response = createSuccessResponse({ id: 1 }, { status: 201 });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    data: { id: 1 },
    success: true,
  });
});

test("crea una respuesta de error con el contrato común", async () => {
  const response = createErrorResponse(
    {
      code: "RESOURCE_NOT_FOUND",
      message: "No se encontró el recurso solicitado.",
    },
    404,
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: "RESOURCE_NOT_FOUND",
      message: "No se encontró el recurso solicitado.",
    },
    success: false,
  });
});
