import { AppError } from "../utils/app-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SALE_STATUSES = Object.freeze([
  "QUOTATION",
  "PENDING",
  "PAID",
  "IN_PREPARATION",
  "READY",
  "DELIVERED",
  "CANCELLED",
]);
export const PAYMENT_METHODS = Object.freeze([
  "CASH",
  "BANK_TRANSFER",
  "MERCADO_PAGO",
  "TRANSBANK",
  "GETNET",
]);
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_DISCOUNT_REASON_LENGTH = 300;

function fail(message) {
  throw new AppError({ code: "INVALID_SALE_DATA", message, status: 400 });
}

export function validateSaleId(value, label = "venta") {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail(`El identificador de la ${label} no es válido.`);
  }
  return value.toLowerCase();
}

function optionalId(value, label) {
  if (value == null) return null;
  return validateSaleId(value, label);
}

function items(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    fail("La venta debe incluir entre 1 y 100 productos diferentes.");
  }
  const normalized = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail(`El producto en la posición ${index + 1} no es válido.`);
    }
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 1000
    ) {
      fail(
        `La cantidad del producto en la posición ${index + 1} no es válida.`,
      );
    }
    return {
      productId: validateSaleId(item.productId, "producto"),
      quantity: item.quantity,
    };
  });
  if (
    new Set(normalized.map((item) => item.productId)).size !== normalized.length
  ) {
    fail("Un producto no puede repetirse en la misma venta.");
  }
  return normalized;
}

export function validateSaleDraftInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cuerpo de la solicitud no es válido.");
  }
  const discountCents = input.discountCents ?? 0;
  if (!Number.isSafeInteger(discountCents) || discountCents < 0) {
    fail(
      "El descuento debe ser un entero mayor o igual a cero expresado en pesos chilenos.",
    );
  }

  let discountReason = null;
  if (discountCents > 0) {
    discountReason =
      typeof input.discountReason === "string"
        ? input.discountReason.trim().replace(/\s+/g, " ")
        : "";
    if (!discountReason || discountReason.length > MAX_DISCOUNT_REASON_LENGTH) {
      fail(
        `El descuento requiere un motivo de hasta ${MAX_DISCOUNT_REASON_LENGTH} caracteres.`,
      );
    }
  } else if (
    input.discountReason != null &&
    String(input.discountReason).trim()
  ) {
    fail("El motivo de descuento solo corresponde cuando existe un descuento.");
  }

  const prescriptionId = optionalId(input.prescriptionId, "receta");
  const externalPrescriptionId = optionalId(
    input.externalPrescriptionId,
    "receta externa",
  );
  if (prescriptionId && externalPrescriptionId) {
    fail("La venta debe usar una receta interna o una externa, no ambas.");
  }
  return {
    customerId: validateSaleId(input.customerId, "cliente"),
    discountCents,
    discountReason,
    externalPrescriptionId,
    items: items(input.items),
    prescriptionId,
  };
}

export function validateSaleStatusInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cuerpo de la solicitud no es válido.");
  }
  const status =
    typeof input.status === "string" ? input.status.trim().toUpperCase() : "";
  if (
    !SALE_STATUSES.includes(status) ||
    ["QUOTATION", "PENDING", "PAID"].includes(status)
  ) {
    fail("El estado solicitado no puede asignarse manualmente.");
  }
  let cancellationReason = null;
  if (status === "CANCELLED") {
    cancellationReason =
      typeof input.cancellationReason === "string"
        ? input.cancellationReason.trim().replace(/\s+/g, " ")
        : "";
    if (!cancellationReason || cancellationReason.length > 500) {
      fail("La cancelación requiere un motivo de hasta 500 caracteres.");
    }
  } else if (Object.hasOwn(input, "cancellationReason")) {
    fail("El motivo solo corresponde al estado CANCELLED.");
  }
  return { cancellationReason, status };
}

export function validateSalePaymentInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cuerpo de la solicitud no es válido.");
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    fail("El abono debe ser un entero positivo expresado en pesos chilenos.");
  }
  const paymentMethod =
    typeof input.paymentMethod === "string"
      ? input.paymentMethod.trim().toUpperCase()
      : "";
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    fail(`El medio de pago debe ser uno de: ${PAYMENT_METHODS.join(", ")}.`);
  }
  let reference = null;
  if (input.reference != null) {
    reference =
      typeof input.reference === "string" ? input.reference.trim() : "";
    if (!reference || reference.length > 200) {
      fail("La referencia debe tener entre 1 y 200 caracteres.");
    }
  }
  return { amountCents: input.amountCents, paymentMethod, reference };
}

export function validateSaleListQuery(searchParams) {
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(
    searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE),
  );
  const rawStatus = searchParams.get("status");
  const status = rawStatus ? rawStatus.trim().toUpperCase() : null;
  const rawCustomerId = searchParams.get("customerId");

  if (!Number.isInteger(page) || page < 1) fail("La página no es válida.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    fail(`El tamaño de página debe estar entre 1 y ${MAX_PAGE_SIZE}.`);
  }
  if (status && !SALE_STATUSES.includes(status))
    fail("El estado no es válido.");

  return {
    customerId: rawCustomerId ? validateSaleId(rawCustomerId, "cliente") : null,
    page,
    pageSize,
    status,
  };
}
