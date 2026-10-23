const PRESENTATIONS_BY_SKU = Object.freeze({
  "HD0896-001": Object.freeze({
    description: "Montura óptica rectangular Harley-Davidson en negro brillante, con bisagras flex y tamaño 56-15-145.",
    specifications: Object.freeze([
      Object.freeze({ label: "Color", value: "Negro brillante" }),
      Object.freeze({ label: "Forma", value: "Rectangular" }),
      Object.freeze({ label: "Medidas", value: "56-15-145 mm" }),
      Object.freeze({ label: "Modelo", value: "HD0896 001" }),
    ]),
  }),
});

const EMPTY_PRESENTATION = Object.freeze({
  description: null,
  images: Object.freeze([]),
  specifications: Object.freeze([]),
});

export function getProductPresentation(sku) {
  return PRESENTATIONS_BY_SKU[sku] ?? EMPTY_PRESENTATION;
}
