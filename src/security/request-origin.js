import { AppError } from "../utils/app-error.js";
export function assertRequestOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method ?? "GET")) return;
  const origin = request.headers.get("origin");
  // Next may use localhost in request.url behind its HTTP adapter. Prefer the
  // configured public origin, otherwise the HTTP Host received by the server.
  const expected = new URL(process.env.APP_PUBLIC_URL || request.url);
  if (!process.env.APP_PUBLIC_URL && request.headers.get("host")) expected.host = request.headers.get("host");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expected.origin)) {
    throw new AppError({ code: "REQUEST_ORIGIN_REJECTED", message: "La solicitud debe originarse en esta aplicación.", status: 403 });
  }
}
