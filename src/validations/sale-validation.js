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

function opticalAdditions(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 50) {
    fail("Los adicionales ópticos deben ser una lista de hasta 50 elementos.");
  }

  return value.map((addition, index) => {
    if (!addition || typeof addition !== "object" || Array.isArray(addition)) {
      fail(`El adicional óptico en la posición ${index + 1} no es válido.`);
    }
    const name = typeof addition.name === "string"
      ? addition.name.trim().replace(/\s+/g, " ")
      : "";
    const description = addition.description == null
      ? null
      : typeof addition.description === "string"
        ? addition.description.trim().replace(/\s+/g, " ")
        : "";
    if (!name || name.length > 160) {
      fail(`El nombre del adicional óptico en la posición ${index + 1} no es válido.`);
    }
    if (addition.description != null && (!description || description.length > 500)) {
      fail(`La descripción del adicional óptico en la posición ${index + 1} no es válida.`);
    }
    if (!Number.isInteger(addition.quantity) || addition.quantity < 1 || addition.quantity > 100) {
      fail(`La cantidad del adicional óptico en la posición ${index + 1} no es válida.`);
    }
    if (!Number.isSafeInteger(addition.unitPriceCents) || addition.unitPriceCents <= 0) {
      fail(`El precio del adicional óptico en la posición ${index + 1} no es válido.`);
    }
    return {
      description,
      name,
      quantity: addition.quantity,
      unitPriceCents: addition.unitPriceCents,
    };
  });
}

function discount(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("El descuento no es válido.");
  }
  if (value.amountCents === 0) {
    if (value.reason || value.authorizerEmail || value.authorizerPassword) {
      fail("El motivo y la autorización solo corresponden cuando existe un descuento.");
    }
    return null;
  }
  if (!Number.isSafeInteger(value.amountCents) || value.amountCents <= 0) {
    fail("El descuento debe ser un entero positivo expresado en pesos chilenos.");
  }
  const reason = typeof value.reason === "string"
    ? value.reason.trim().replace(/\s+/g, " ")
    : "";
  const authorizerEmail = typeof value.authorizerEmail === "string"
    ? value.authorizerEmail.trim().toLowerCase()
    : "";
  const authorizerPassword = typeof value.authorizerPassword === "string"
    ? value.authorizerPassword
    : "";
  if (!reason || reason.length > MAX_DISCOUNT_REASON_LENGTH) {
    fail(`El descuento requiere un motivo de hasta ${MAX_DISCOUNT_REASON_LENGTH} caracteres.`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorizerEmail)) {
    fail("El correo de quien autoriza el descuento no es válido.");
  }
  if (!authorizerPassword || Buffer.byteLength(authorizerPassword, "utf8") > 1_024) {
    fail("La contraseña de autorización no es válida.");
  }
  return { amountCents: value.amountCents, authorizerEmail, authorizerPassword, reason };
}

export function validateSaleDraftInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cuerpo de la solicitud no es válido.");
  }
  const prescriptionId = optionalId(input.prescriptionId, "receta");
  const externalPrescriptionId = optionalId(input.externalPrescriptionId, "receta externa");
  if (prescriptionId && externalPrescriptionId) {
    fail("Debe seleccionar una receta interna o externa, no ambas.");
  }

  const patientId = optionalId(input.patientId, "paciente");
  if ((prescriptionId || externalPrescriptionId) && !patientId) {
    fail("Debe seleccionar al paciente de la receta.");
  }

  if (input.discount == null && (input.discountCents ?? 0) === 0 && input.discountReason) {
    fail("El motivo solo corresponde cuando existe un descuento.");
  }
  const normalizedDiscount = input.discount == null && (input.discountCents ?? 0) === 0
    ? null
    : discount(input.discount ?? {
        amountCents: input.discountCents,
        authorizerEmail: input.discountAuthorizerEmail,
        authorizerPassword: input.discountAuthorizerPassword,
        reason: input.discountReason,
      });

  return {
    customerId: validateSaleId(input.customerId, "cliente"),
    discount: normalizedDiscount,
    discountCents: normalizedDiscount?.amountCents ?? 0,
    discountReason: normalizedDiscount?.reason ?? null,
    externalPrescriptionId,
    items: items(input.items),
    opticalAdditions: opticalAdditions(input.opticalAdditions),
    patientId,
    prescriptionId,
  };
}

export function validateReceiptInput(input) {
  if (input == null) return { email: null, paymentId: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cuerpo de la solicitud no es válido.");
  }
  let email = null;
  if (input.email != null && input.email !== "") {
    email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fail("El correo del comprobante no es válido.");
    }
  }
  return {
    email,
    paymentId: optionalId(input.paymentId, "abono"),
  };
}

export function validateSalesReportQuery(searchParams) {
  const today = new Date();
  const defaultTo = today.toISOString().slice(0, 10);
  const defaultFromDate = new Date(today);
  defaultFromDate.setDate(defaultFromDate.getDate() - 29);
  const from = searchParams.get("from") ?? defaultFromDate.toISOString().slice(0, 10);
  const to = searchParams.get("to") ?? defaultTo;
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(from) || !pattern.test(to) || from > to) {
    fail("El rango de fechas del reporte no es válido.");
  }
  const maximumTo = new Date(`${from}T00:00:00.000Z`);
  maximumTo.setUTCDate(maximumTo.getUTCDate() + 366);
  if (new Date(`${to}T00:00:00.000Z`) > maximumTo) {
    fail("El reporte no puede abarcar más de 366 días.");
  }
  return { from, to };
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
