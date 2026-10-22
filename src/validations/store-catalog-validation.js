import { AppError } from "../utils/app-error.js";
import { STORE_PRESCRIPTIONS, STORE_SORTS } from "../utils/store-catalog-query.js";
import { validateProductListQuery } from "./product-validation.js";

// Validar en el servidor los filtros antes de paginar; los cristales se venden con un marco.
export function validateStoreCatalogQuery(params) {
  const sort = params.get("sort") ?? "featured";
  const prescription = params.get("prescription") ?? "all";
  const availability = params.get("availability") ?? "all";
  if (!STORE_SORTS.includes(sort) || !STORE_PRESCRIPTIONS.includes(prescription)
    || !["all", "available"].includes(availability)) {
    throw new AppError({ code: "INVALID_PRODUCT_DATA", message: "Los filtros del catálogo no son válidos.", status: 400 });
  }
  return { ...validateProductListQuery(params), sort, prescription };
}
