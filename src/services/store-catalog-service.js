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
    isTestData: product.isTestData,
    images: presentation.images,
    name: product.name,
    requiresPrescription: product.requiresPrescription,
    sku: product.sku,
    specifications: presentation.specifications,
    unitPriceCents: product.unitPriceCents,
  };
}

function canUseTestData(dependencies) {
  return dependencies.includeTestData ?? process.env.NODE_ENV !== "production";
}

export async function getStoreProducts(searchParams, dependencies = {}) {
  const publicQuery = new URLSearchParams(searchParams);
  publicQuery.set("isActive", "true");
  const includeTestData = canUseTestData(dependencies);
  const result = await (dependencies.listProducts ?? listProducts)(
    {
      ...validateProductListQuery(publicQuery),
      excludeCategory: "PRESCRIPTION_LENS",
      includeTestData,
    },
  );
  const availability = dependencies.getAvailability ?? getMockAvailability;
  const items = result.items
    .filter((product) => includeTestData || !product.isTestData)
    .map((product) => publicProduct(product, availability));
  return { ...result, items };
}

export async function getStoreProduct(productId, dependencies = {}) {
  const product = await (dependencies.findProductById ?? findProductById)(
    validateStoreProductId(productId),
  );
  if (
    !product?.isActive
    || product.category === "PRESCRIPTION_LENS"
    || (product.isTestData && !canUseTestData(dependencies))
  ) {
    throw new AppError({
      code: "STORE_PRODUCT_NOT_FOUND",
      message: "No se encontró el producto solicitado.",
      status: 404,
    });
  }
  const availability = dependencies.getAvailability ?? getMockAvailability;
  const presentation = publicProduct(product, availability);
  if (product.category !== "FRAME") return presentation;
  const lenses = await (dependencies.listProducts ?? listProducts)({
    category: "PRESCRIPTION_LENS",
    excludeCategory: null,
    includeTestData: canUseTestData(dependencies),
    isActive: true,
    page: 1,
    pageSize: 100,
    search: "",
  });
  return {
    ...presentation,
    lensOptions: lenses.items.map((lens) => publicProduct(lens, availability)),
  };
}
