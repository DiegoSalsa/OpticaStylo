import { AppError } from "../utils/app-error.js";
import { INTERNAL_PAGE_SIZE } from "../utils/pagination.js";

export function validateAccountPage(query) {
  const page = Number(query.get("page") ?? 1);
  const pageSize = Number(query.get("pageSize") ?? INTERNAL_PAGE_SIZE);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new AppError({ code: "INVALID_ACCOUNT_PAGE", message: "La página o su tamaño (de 1 a 50) no es válido.", status: 400 });
  }
  return { page, pageSize };
}
