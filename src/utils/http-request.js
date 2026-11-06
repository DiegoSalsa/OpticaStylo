import { AppError } from "./app-error.js";
import { assertRequestOrigin } from "../security/request-origin.js";
const DEFAULT_MAX_BODY_BYTES = 16 * 1024;
function throwBodyTooLarge() { throw new AppError({ code: "REQUEST_BODY_TOO_LARGE", message: "El cuerpo de la solicitud supera el tamaño permitido.", status: 413 }); }
async function readLimitedBody(request, maximum) {
  assertRequestOrigin(request);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throwBodyTooLarge();
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader(), chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximum) { await reader.cancel(); throwBodyTooLarge(); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function readJsonBody(request, maximum = DEFAULT_MAX_BODY_BYTES) {
  const body = (await readLimitedBody(request, maximum)).toString("utf8");
  try { return JSON.parse(body); }
  catch { throw new AppError({ code: "INVALID_JSON", message: "El cuerpo de la solicitud debe contener JSON válido.", status: 400 }); }
}
export async function readMultipartFormData(request, maximum) {
  if (!request.body) throw new AppError({ code: "INVALID_MULTIPART_BODY", message: "La carga no contiene datos.", status: 400 });
  const body = await readLimitedBody(request, maximum), headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, { body, headers, method: request.method }).formData();
}
