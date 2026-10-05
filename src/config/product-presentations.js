const PRESENTATIONS_BY_SKU = Object.freeze({
  "HD0896-001": Object.freeze({
    description: "Montura óptica rectangular Harley-Davidson en negro brillante, con bisagras flex y tamaño 56-15-145.",
    images: Object.freeze([
      Object.freeze({
        alt: "Montura Harley-Davidson HD0896-001 negra en vista principal",
        url: "/images/products/hd0896-001/vista-principal.jpg",
      }),
      Object.freeze({
        alt: "Montura Harley-Davidson HD0896-001 negra en vista lateral",
        url: "/images/products/hd0896-001/vista-lateral.webp",
      }),
      Object.freeze({
        alt: "Estuche Harley-Davidson incluido con la montura HD0896-001",
        url: "/images/products/hd0896-001/estuche.jpg",
      }),
    ]),
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
