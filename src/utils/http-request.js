import { AppError } from "./app-error.js";

const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

function throwBodyTooLarge() {
  throw new AppError({
    code: "REQUEST_BODY_TOO_LARGE",
    message: "El cuerpo de la solicitud supera el tamaño permitido.",
    status: 413,
  });
}

export async function readJsonBody(
  request,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
) {
  const declaredLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throwBodyTooLarge();
  }

  const body = await request.text();

  if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
    throwBodyTooLarge();
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

export async function readMultipartFormData(request, maxBodyBytes) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throwBodyTooLarge();
  }
  if (!request.body) {
    throw new AppError({
      code: "INVALID_MULTIPART_BODY",
      message: "La carga no contiene datos.",
      status: 400,
    });
  }

  const reader = request.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBodyBytes) {
        await reader.cancel();
        throwBodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const replay = new Request(request.url, {
    body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    headers,
    method: request.method,
  });
  return replay.formData();
}
