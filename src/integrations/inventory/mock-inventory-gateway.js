// Código de la aplicación para mock-inventory-gateway.
export function getMockAvailability(product) {
  return {
    available: product.isActive,
    exactQuantityKnown: false,
    source: "MOCK",
  };
}
