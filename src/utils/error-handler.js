import { AppError } from "./app-error.js";
import { createErrorResponse } from "./api-response.js";

export function handleApiError(error) {
  if (error instanceof AppError) {
    return createErrorResponse(
      {
        code: error.code,
        message: error.message,
      },
      error.status,
    );
  }

  console.error("Error interno no controlado.", error);

  return createErrorResponse(
    {
      code: "INTERNAL_ERROR",
      message: "Ocurrió un error interno. Inténtelo nuevamente.",
    },
    500,
  );
}

export async function executeApiHandler(handler) {
  try {
    return await handler();
  } catch (error) {
    return handleApiError(error);
  }
}
