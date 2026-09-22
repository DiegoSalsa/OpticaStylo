export class AppError extends Error {
// Utilidades compartidas para app-error.
  constructor({ code, message, status = 500, cause, headers = null }) {
    super(message, { cause });
    this.name = "AppError";
    this.code = code;
    this.headers = headers;
    this.status = status;
  }
}
