import { getMockAvailability } from "../integrations/inventory/mock-inventory-gateway.js";
import { findProductById, listProducts } from "../repositories/product-repository.js";
import { getProductPresentation } from "../config/product-presentations.js";
import { AppError } from "../utils/app-error.js";
import {
  validateProductListQuery,
} from "../validations/product-validation.js";
import { validateStoreProductId } from "../validations/store-validation.js";

function publicProduct(product, availabilityProvider) {
  const presentation = getProductPresentation(product.sku);
  return {
    availability: availabilityProvider(product),
    category: product.category,
    description: presentation.description,
    id: product.id,
    images: presentation.images,
    name: product.name,
    requiresPrescription: product.requiresPrescription,
    sku: product.sku,
    specifications: presentation.specifications,
    unitPriceCents: product.unitPriceCents,
  };
}

export async function getStoreProducts(searchParams, dependencies = {}) {
  const publicQuery = new URLSearchParams(searchParams);
  publicQuery.set("isActive", "true");
  const result = await (dependencies.listProducts ?? listProducts)(
    validateProductListQuery(publicQuery),
  );
  const availability = dependencies.getAvailability ?? getMockAvailability;
  return { ...result, items: result.items.map((product) => publicProduct(product, availability)) };
}

export async function getStoreProduct(productId, dependencies = {}) {
  const product = await (dependencies.findProductById ?? findProductById)(
    validateStoreProductId(productId),
  );
  if (!product?.isActive) {
    throw new AppError({
      code: "STORE_PRODUCT_NOT_FOUND",
      message: "No se encontró el producto solicitado.",
      status: 404,
    });
  }
  return publicProduct(product, dependencies.getAvailability ?? getMockAvailability);
}
