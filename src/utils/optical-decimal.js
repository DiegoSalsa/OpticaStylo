// Una medición decimal representable no debe rechazarse por el redondeo binario de JavaScript.
export function isOpticalDecimal(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 10000 && Math.abs(value * 100 - Math.round(value * 100)) <= 1e-8;
}
export function normalizedOpticalDecimal(value) {
  return Object.is(value, -0) ? 0 : Math.round(value * 100) / 100;
}
