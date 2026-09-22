// Servicio de negocio que coordina reglas, permisos y persistencia de product-service.
import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import { getMockAvailability } from "../integrations/inventory/mock-inventory-gateway.js";
import { listActiveProductImages } from "../repositories/product-image-repository.js";
import {
  createProduct as createProductRepository,
  findProductById,
  listProductEvents,
  listProducts,
  updateProduct as updateProductRepository,
} from "../repositories/product-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateCreateProductInput,
  validateProductId,
  validateProductListQuery,
  validateUpdateProductInput,
} from "../validations/product-validation.js";

// Centralizar la lógica de not found para mantener consistente el comportamiento de la aplicación
function notFound() {
  throw new AppError({ code: "PRODUCT_NOT_FOUND", message: "No se encontró el producto.", status: 404 });
}

// Centralizar la lógica de convert unique violation para mantener consistente el comportamiento de la aplicación
function convertUniqueViolation(error) {
  if (error?.code === "23505") {
    throw new AppError({
      code: "PRODUCT_SKU_ALREADY_EXISTS",
      message: "Ya existe un producto con ese SKU.",
      status: 409,
      cause: error,
    });
  }
  throw error;
}

// Crear o registrar create producto aplicando las reglas de negocio y persistencia correspondientes
export async function createProduct(input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_MANAGE]);
  try {
    return await (dependencies.createProduct ?? createProductRepository)(
      validateCreateProductInput(input), actor.userId,
    );
  } catch (error) {
    return convertUniqueViolation(error);
  }
}

// Consultar get producto y devolver los datos en el formato esperado por la capa llamadora
export async function getProduct(productId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_READ]);
  const id = validateProductId(productId);
  const product = await (dependencies.findProductById ?? findProductById)(id);
  if (!product) notFound();
  const images = await (dependencies.listImages ?? listActiveProductImages)([id]);
  return {
    ...product,
    availability: (dependencies.getAvailability ?? getMockAvailability)(product),
    images: images.map(({ productId: _productId, ...image }) => image),
  };
}

// Consultar get producto list y devolver los datos en el formato esperado por la capa llamadora
export async function getProductList(searchParams, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_READ]);
  const result = await (dependencies.listProducts ?? listProducts)(validateProductListQuery(searchParams));
  const availability = dependencies.getAvailability ?? getMockAvailability;
  return {
    ...result,
    items: result.items.map((product) => ({
      ...product,
      availability: availability(product),
    })),
  };
}

// Consultar get producto historial y devolver los datos en el formato esperado por la capa llamadora
export async function getProductHistory(productId, actor, dependencies = {}) {
  await getProduct(productId, actor, dependencies);
  return (dependencies.listProductEvents ?? listProductEvents)(validateProductId(productId));
}

// Actualizar update producto manteniendo las restricciones y estados permitidos del dominio
export async function updateProduct(productId, input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.PRODUCTS_MANAGE]);
  const id = validateProductId(productId);
  const find = dependencies.findProductById ?? findProductById;
  const current = await find(id);
  if (!current) notFound();
  const data = validateUpdateProductInput(input, current);
  const changedFields = Object.keys(data).filter((field) => data[field] !== current[field]);
  try {
    const product = await (dependencies.updateProduct ?? updateProductRepository)(
      id, data, changedFields, actor.userId,
    );
    if (!product) notFound();
    return product;
  } catch (error) {
    return convertUniqueViolation(error);
  }
}
