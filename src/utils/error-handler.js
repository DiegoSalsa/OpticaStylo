import { AppError } from "./app-error.js";
// Utilidades compartidas para error-handler.
import { createErrorResponse } from "./api-response.js";

// Gestionar handle api error y coordinar sus efectos secundarios
export function handleApiError(error) {
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

  console.error("Error interno no controlado.", error);

  return createErrorResponse(
    {
      code: "INTERNAL_ERROR",
      message: "Ocurrió un error interno. Inténtelo nuevamente.",
    },
    500,
  );
}

// Centralizar la lógica de execute api handler para mantener consistente el comportamiento de la aplicación
export async function executeApiHandler(handler) {
  try {
    return await handler();
  } catch (error) {
    return handleApiError(error);
  }
}
