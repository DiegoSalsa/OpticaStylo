import { createHash } from "node:crypto";

import { createSessionToken, hashSessionToken } from "../auth/session-token.js";
import { getCloudinaryMediaGateway } from "../integrations/media/cloudinary-media-gateway.js";
import { readPrescriptionImage } from "../integrations/prescriptions/prescription-reader.js";
import { createStoreMercadoPagoCheckout } from "./mercado-pago-service.js";
import { findSaleById } from "../repositories/sale-repository.js";
import {
  claimCartPrescriptionExtraction,
  checkoutStoreCart,
  completeCartPrescriptionExtraction,
  configureStoreCart,
  confirmExternalPrescription,
  createOrRotateStoreCart,
  findCartPrescriptionImage,
  findStoreCart,
  failCartPrescriptionExtraction,
  listStoreOrders,
  removeStoreCartItem,
  saveExternalPrescriptionImage,
  saveManualExternalPrescription,
  upsertStoreCartItem,
  upsertStoreCartItems,
} from "../repositories/store-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateCartConfiguration,
  validateCartItemInput,
  validateCartItemsInput,
  validateExternalPrescriptionData,
  validatePrescriptionImage,
  validatePrescriptionImageBytes,
  validateStoreOrderId,
  validateStoreProductId,
} from "../validations/store-validation.js";

const CART_SECONDS = 30 * 24 * 60 * 60;
const ERRORS = Object.freeze({
  ACCOUNT_REQUIRED_FOR_PRESCRIPTION: [
    "CUSTOMER_ACCOUNT_REQUIRED",
    "Debe iniciar sesión para seleccionar una receta clínica existente.",
    401,
  ],
  CART_CONFIGURATION_REQUIRED: [
    "CART_CONFIGURATION_REQUIRED",
    "Debe completar los datos del comprador y la entrega.",
    409,
  ],
  CART_EMPTY: ["CART_EMPTY", "El carrito no contiene productos.", 409],
  CART_ITEM_NOT_FOUND: ["CART_ITEM_NOT_FOUND", "El producto no está en el carrito.", 404],
  LENS_MOUNT_REQUIRED: [
    "STORE_LENS_MOUNT_REQUIRED",
    "Los cristales deben estar asociados a un marco incluido en el carrito.",
    409,
  ],
  CART_NOT_ACTIVE: ["CART_NOT_ACTIVE", "El carrito ya no está activo.", 409],
  CART_NOT_FOUND: ["CART_NOT_FOUND", "No se encontró un carrito accesible.", 404],
  CLINICAL_PRESCRIPTION_NOT_AVAILABLE: [
    "CLINICAL_PRESCRIPTION_NOT_AVAILABLE",
    "La receta clínica no está disponible para esta cuenta.",
    404,
  ],
  CUSTOMER_ACCOUNT_NOT_FOUND: [
    "CUSTOMER_ACCOUNT_NOT_FOUND",
    "No se encontró la cuenta del comprador.",
    404,
  ],
  PRESCRIPTION_IMAGE_NOT_FOUND: [
    "PRESCRIPTION_IMAGE_NOT_FOUND",
    "Primero debe cargar una imagen de la receta.",
    404,
  ],
  PRESCRIPTION_REQUIRED: [
    "PRESCRIPTION_REQUIRED",
    "Los cristales seleccionados requieren una receta confirmada antes de continuar al pago.",
    409,
  ],
  PRESCRIPTION_EXTRACTION_IN_PROGRESS: [
    "PRESCRIPTION_EXTRACTION_IN_PROGRESS",
    "La receta se está leyendo. Espere un momento antes de volver a intentarlo.",
    409,
  ],
  PRODUCT_NOT_AVAILABLE: [
    "STORE_PRODUCT_NOT_AVAILABLE",
    "El producto no se encuentra disponible.",
    409,
  ],
  UNEXPECTED_LENS_MOUNT: [
    "STORE_UNEXPECTED_LENS_MOUNT",
    "Solo los cristales pueden asociarse a un marco.",
    409,
  ],
});

function throwReason(reason) {
  const [code, message, status] = ERRORS[reason] ?? [
    "STORE_OPERATION_REJECTED",
    "No fue posible realizar la operación en la tienda.",
    409,
  ];
  throw new AppError({ code, message, status });
}

function unwrap(result) {
  if (result.reason) throwReason(result.reason);
  return result.cart;
}

function access(token, account) {
  if (!token) throwReason("CART_NOT_FOUND");
  return { accountId: account?.id ?? null, tokenHash: hashSessionToken(token) };
}

async function deleteReplacedPrivatePrescription(asset, dependencies) {
  if (!asset) return;
  try {
    const removed = await (dependencies.mediaGateway ?? getCloudinaryMediaGateway())
      .deletePrivatePrescription(asset);
    if (!removed) console.error("Una receta privada reemplazada requiere limpieza manual en Cloudinary.", asset.assetId);
  } catch (error) {
    console.error("No fue posible limpiar una receta privada reemplazada.", error);
  }
}

export async function createStoreCart(account, dependencies = {}) {
  const token = (dependencies.createToken ?? createSessionToken)();
  const expiresAt = new Date(Date.now() + CART_SECONDS * 1000);
  const cart = await (dependencies.createCart ?? createOrRotateStoreCart)(
    (dependencies.hashToken ?? hashSessionToken)(token),
    account?.id ?? null,
    expiresAt,
  );
  return { cart, maxAgeSeconds: CART_SECONDS, token };
}

export async function getStoreCart(token, account, dependencies = {}) {
  const credentials = access(token, account);
  const cart = await (dependencies.findCart ?? findStoreCart)(
    credentials.tokenHash,
    credentials.accountId,
  );
  if (!cart) throwReason("CART_NOT_FOUND");
  return cart;
}

export async function putStoreCartItem(token, account, productId, input, dependencies = {}) {
  const credentials = access(token, account);
  const item = validateCartItemInput(input);
  return unwrap(await (dependencies.upsertItem ?? upsertStoreCartItem)(
    credentials.tokenHash,
    credentials.accountId,
    validateStoreProductId(productId),
    item.quantity,
    item.mountFrameProductId,
  ));
}

export async function putStoreCartItems(token, account, input, dependencies = {}) {
  const credentials = access(token, account);
  const items = validateCartItemsInput(input);
  return unwrap(await (dependencies.upsertItems ?? upsertStoreCartItems)(
    credentials.tokenHash,
    credentials.accountId,
    items.items,
  ));
}

export async function deleteStoreCartItem(token, account, productId, dependencies = {}) {
  const credentials = access(token, account);
  return unwrap(await (dependencies.removeItem ?? removeStoreCartItem)(
    credentials.tokenHash,
    credentials.accountId,
    validateStoreProductId(productId),
  ));
}

export async function updateStoreCart(token, account, input, dependencies = {}) {
  const credentials = access(token, account);
  const result = await (dependencies.configureCart ?? configureStoreCart)(
    credentials.tokenHash,
    credentials.accountId,
    validateCartConfiguration(input),
  );
  const cart = unwrap(result);
  await deleteReplacedPrivatePrescription(result.removedCloudinary, dependencies);
  return cart;
}

export async function putManualPrescription(token, account, input, dependencies = {}) {
  const credentials = access(token, account);
  const result = await (
    dependencies.saveManualPrescription ?? saveManualExternalPrescription
  )(
    credentials.tokenHash,
    credentials.accountId,
    validateExternalPrescriptionData(input),
    dependencies.currentDate ?? new Date(),
  );
  const cart = unwrap(result);
  await deleteReplacedPrivatePrescription(result.replacedCloudinary, dependencies);
  return cart;
}

export async function putPrescriptionImage(token, account, file, dependencies = {}) {
  const credentials = access(token, account);
  const image = validatePrescriptionImage(file);
  const data = validatePrescriptionImageBytes(
    Buffer.from(await image.file.arrayBuffer()),
    image.mediaType,
  );
  const sha256 = createHash("sha256").update(data).digest("hex");
  const gateway = dependencies.mediaGateway ?? getCloudinaryMediaGateway();
  const cloudinary = await gateway.uploadPrivatePrescription({ data });
  try {
    const result = await (
      dependencies.saveImage ?? saveExternalPrescriptionImage
    )(
      credentials.tokenHash,
      credentials.accountId,
      { ...image, cloudinary, file: undefined, sha256 },
    );
    const cart = unwrap(result);
    await deleteReplacedPrivatePrescription(result.replacedCloudinary, {
      ...dependencies,
      mediaGateway: gateway,
    });
    return cart;
  } catch (error) {
    await gateway.deletePrivatePrescription(cloudinary);
    throw error;
  }
}

export async function completeImagePrescription(token, account, input, dependencies = {}) {
  const credentials = access(token, account);
  return unwrap(await (
    dependencies.confirmPrescription ?? confirmExternalPrescription
  )(
    credentials.tokenHash,
    credentials.accountId,
    validateExternalPrescriptionData(input),
    dependencies.currentDate ?? new Date(),
  ));
}

export async function getPrescriptionImage(token, account, dependencies = {}) {
  const credentials = access(token, account);
  const image = await (dependencies.findImage ?? findCartPrescriptionImage)(
    credentials.tokenHash,
    credentials.accountId,
  );
  if (!image) throwReason("PRESCRIPTION_IMAGE_NOT_FOUND");
  if (!image.cloudinary) return image;
  const data = await (dependencies.mediaGateway ?? getCloudinaryMediaGateway())
    .downloadPrivatePrescription(image.cloudinary);
  return { ...image, data };
}

export async function extractPrescriptionImage(token, account, dependencies = {}) {
  const credentials = access(token, account);
  const provider = "OPENAI_GPT_5_6_LUNA";
  const claim = await (
    dependencies.claimExtraction ?? claimCartPrescriptionExtraction
  )(
    credentials.tokenHash,
    credentials.accountId,
    provider,
  );
  if (claim.reason) throwReason(claim.reason);
  if (claim.cached) {
    return {
      cart: claim.cart,
      extraction: { cached: true, data: claim.data, provider: claim.provider },
    };
  }
  let image = claim.image;
  try {
    if (image.cloudinary) {
      const data = await (dependencies.mediaGateway ?? getCloudinaryMediaGateway())
        .downloadPrivatePrescription(image.cloudinary);
      image = { ...image, data };
    }
    const extraction = await (
      dependencies.readPrescriptionImage ?? readPrescriptionImage
    )(image);
    const result = await (
      dependencies.completeExtraction ?? completeCartPrescriptionExtraction
    )(
      credentials.tokenHash,
      credentials.accountId,
      extraction.provider,
      extraction.data,
    );
    if (result.reason) throwReason(result.reason);
    return {
      cart: result.cart,
      extraction: { cached: false, data: extraction.data, provider: extraction.provider },
    };
  } catch (error) {
    try {
      await (dependencies.failExtraction ?? failCartPrescriptionExtraction)(
        credentials.tokenHash,
        credentials.accountId,
        provider,
      );
    } catch (failure) {
      console.error("No fue posible registrar el error de lectura automática de la receta.", failure);
    }
    throw error;
  }
}

function publicOrder(sale) {
  return {
    balanceCents: sale.balanceCents,
    createdAt: sale.createdAt,
    externalPrescription: sale.externalPrescription,
    fulfillment: sale.fulfillment,
    id: sale.id,
    items: sale.items,
    paidCents: sale.paidCents,
    paymentMethod: sale.paymentMethod,
    saleNumber: sale.saleNumber,
    shippingFeeCents: sale.shippingFeeCents,
    status: sale.status,
    subtotalCents: sale.subtotalCents,
    totalCents: sale.totalCents,
  };
}

export async function checkoutCart(token, account, dependencies = {}) {
  const credentials = access(token, account);
  const result = await (dependencies.checkoutCart ?? checkoutStoreCart)(
    credentials.tokenHash,
    credentials.accountId,
    dependencies.currentDate ?? new Date(),
  );
  if (result.reason) throwReason(result.reason);
  const sale = await (dependencies.findSaleById ?? findSaleById)(result.saleId);
  const payment = await (
    dependencies.createMercadoPagoCheckout ?? createStoreMercadoPagoCheckout
  )(result.saleId, dependencies.mercadoPagoDependencies ?? {});
  return { order: publicOrder(sale), payment };
}

export async function getStoreOrder(orderId, token, account, dependencies = {}) {
  const id = validateStoreOrderId(orderId);
  if (account) {
    const ids = await (dependencies.listOrders ?? listStoreOrders)(account.id);
    if (!ids.includes(id)) {
      throw new AppError({ code: "STORE_ORDER_NOT_FOUND", message: "No se encontró el pedido.", status: 404 });
    }
  } else {
    const cart = await getStoreCart(token, account, dependencies);
    if (cart.saleId !== id) {
      throw new AppError({ code: "STORE_ORDER_NOT_FOUND", message: "No se encontró el pedido.", status: 404 });
    }
  }
  const sale = await (dependencies.findSaleById ?? findSaleById)(id);
  if (!sale) {
    throw new AppError({ code: "STORE_ORDER_NOT_FOUND", message: "No se encontró el pedido.", status: 404 });
  }
  return publicOrder(sale);
}

export async function getStoreOrders(account, dependencies = {}) {
  const ids = await (dependencies.listOrders ?? listStoreOrders)(account.id);
  const sales = await Promise.all(ids.map((id) => (
    dependencies.findSaleById ?? findSaleById
  )(id)));
  return sales.filter(Boolean).map(publicOrder);
}

export async function retryStoreOrderCheckout(orderId, token, account, dependencies = {}) {
  const order = await getStoreOrder(orderId, token, account, dependencies);
  if (order.status !== "PENDING" || order.balanceCents <= 0) {
    throw new AppError({
      code: "STORE_ORDER_NOT_PAYABLE",
      message: "Este pedido no tiene un saldo pendiente disponible para pago.",
      status: 409,
    });
  }
  return (dependencies.createMercadoPagoCheckout ?? createStoreMercadoPagoCheckout)(
    order.id,
    dependencies.mercadoPagoDependencies ?? {},
  );
}
