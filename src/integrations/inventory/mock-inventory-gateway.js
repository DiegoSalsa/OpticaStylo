export function getMockAvailability(product) {
  return {
    available: product.isActive,
    exactQuantityKnown: false,
    source: "MOCK",
  };
}
