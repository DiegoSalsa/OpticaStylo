import { AppError } from "./app-error.js";

const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

export async function readJsonBody(
  request,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
) {
  const declaredLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new AppError({
      code: "REQUEST_BODY_TOO_LARGE",
      message: "El cuerpo de la solicitud supera el tamaño permitido.",
      status: 413,
    });
  }

  const body = await request.text();

  if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
    throw new AppError({
      code: "REQUEST_BODY_TOO_LARGE",
      message: "El cuerpo de la solicitud supera el tamaño permitido.",
      status: 413,
    });
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new AppError({
      code: "INVALID_JSON",
      message: "El cuerpo de la solicitud debe contener JSON válido.",
      status: 400,
    });
  }
}
