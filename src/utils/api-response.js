/**
 * Construye una respuesta exitosa con el contrato común de la API.
 */
export function createSuccessResponse(data, init) {
  return Response.json(
    {
      success: true,
      data,
    },
    init,
  );
}

/**
 * Construye una respuesta de error sin exponer detalles internos.
 */
export function createErrorResponse({ code, message }, status = 500) {
  return Response.json(
    {
      success: false,
      error: {
        code,
        message,
      },
    },
    { status },
  );
}
