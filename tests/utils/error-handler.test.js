import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/utils/app-error.js";
import { executeApiHandler } from "../../src/utils/error-handler.js";

test("convierte un AppError en una respuesta HTTP controlada", async () => {
  const response = await executeApiHandler(async () => {
    throw new AppError({
      code: "INVALID_INPUT",
      message: "Los datos ingresados no son válidos.",
      status: 400,
    });
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: "INVALID_INPUT",
      message: "Los datos ingresados no son válidos.",
    },
    success: false,
  });
});
