import { AppError } from "../utils/app-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PRODUCT_CATEGORIES = Object.freeze([
  "FRAME",
  "PRESCRIPTION_LENS",
  "TREATMENT",
  "ACCESSORY",
  "OTHER",
]);
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function fail(message) {
  throw new AppError({ code: "INVALID_PRODUCT_DATA", message, status: 400 });
}

function requiredText(value, label, maximumLength) {
  if (typeof value !== "string") fail(`${label} es obligatorio.`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) fail(`${label} es obligatorio.`);
  if (normalized.length > maximumLength) {
    fail(`${label} no puede superar ${maximumLength} caracteres.`);
  }
  return normalized;
}

function price(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("El precio debe ser un entero positivo expresado en pesos chilenos.");
  }
  return value;
}

export function validateProductId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail("El identificador del producto no es válido.");
  }
  return value.toLowerCase();
}

export function validateCreateProductInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cuerpo de la solicitud no es válido.");
  }

  const category = typeof input.category === "string" ? input.category.trim().toUpperCase() : "";
  if (!PRODUCT_CATEGORIES.includes(category)) {
    fail(`La categoría debe ser una de: ${PRODUCT_CATEGORIES.join(", ")}.`);
  }
  if (typeof input.requiresPrescription !== "boolean") {
    fail("Debe indicar si el producto requiere receta.");
  }

  return {
    category,
    isActive: true,
    name: requiredText(input.name, "El nombre", 200),
    requiresPrescription: input.requiresPrescription,
    sku: requiredText(input.sku, "El SKU", 80).toUpperCase(),
    unitPriceCents: price(input.unitPriceCents),
  };
}

export function validateUpdateProductInput(input, current) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cuerpo de la solicitud no es válido.");
  }
  const fields = ["sku", "name", "category", "requiresPrescription", "unitPriceCents", "isActive"];
  if (!fields.some((field) => Object.hasOwn(input, field))) {
    fail("Debe indicar al menos un dato para actualizar.");
  }

  const value = (field) => Object.hasOwn(input, field) ? input[field] : current[field];
  const merged = validateCreateProductInput({
    category: value("category"),
    name: value("name"),
    requiresPrescription: value("requiresPrescription"),
    sku: value("sku"),
    unitPriceCents: value("unitPriceCents"),
  });

  if (Object.hasOwn(input, "isActive") && typeof input.isActive !== "boolean") {
    fail("El estado activo del producto debe ser booleano.");
  }
  return { ...merged, isActive: value("isActive") };
}

export function validateProductListQuery(searchParams) {
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE));
  const search = (searchParams.get("search") ?? "").trim();
  const rawCategory = searchParams.get("category");
  const category = rawCategory ? rawCategory.trim().toUpperCase() : null;
  const rawActive = searchParams.get("isActive");

  if (!Number.isInteger(page) || page < 1) fail("La página no es válida.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    fail(`El tamaño de página debe estar entre 1 y ${MAX_PAGE_SIZE}.`);
  }
  if (search.length > 100) fail("La búsqueda no puede superar 100 caracteres.");
  if (category && !PRODUCT_CATEGORIES.includes(category)) fail("La categoría no es válida.");
  if (rawActive !== null && !["true", "false"].includes(rawActive)) {
    fail("isActive debe ser true o false.");
  }

  return {
    category,
    isActive: rawActive === null ? null : rawActive === "true",
    page,
    pageSize,
    search,
  };
}
