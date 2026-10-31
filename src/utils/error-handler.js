import { AppError } from "./app-error.js";
import { createErrorResponse } from "./api-response.js";

export function handleApiError(error, {sensitive=false}={}) {
  if (error instanceof AppError) {
    return createErrorResponse(
      {
        code: error.code,
        headers: error.headers,
        message: error.message,
      },
      error.status,
    );
  }

  console.error("Error interno no controlado.", sensitive?{code:typeof error?.code==="string"?error.code:"UNEXPECTED"}:error);

  return createErrorResponse(
    {
      code: "INTERNAL_ERROR",
      message: "Ocurrió un error interno. Inténtelo nuevamente.",
    },
    500,
  );
}

export async function executeApiHandler(handler,options) {
  try {
    return await handler();
  } catch (error) {
    return handleApiError(error,options);
  }
}

export async function executeClinicalHandler(handler) {
  const response = await executeApiHandler(handler, { sensitive: true });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, noarchive");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
