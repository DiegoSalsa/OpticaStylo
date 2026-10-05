export class AppError extends Error {
  constructor({ code, message, status = 500, cause, headers = null }) {
    super(message, { cause });
    this.name = "AppError";
    this.code = code;
    this.headers = headers;
    this.status = status;
  }
}
