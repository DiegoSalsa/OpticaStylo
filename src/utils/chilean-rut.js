function calculateCheckDigit(body) {
  let sum = 0;
  let multiplier = 2;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const result = 11 - (sum % 11);

  if (result === 11) {
    return "0";
  }

  if (result === 10) {
    return "K";
  }

  return String(result);
}

export function normalizeChileanRut(value) {
  if (typeof value !== "string") {
    return null;
  }

  const compactRut = value.trim().toUpperCase().replace(/[.-]/g, "");
  const match = /^(\d{1,8})([0-9K])$/.exec(compactRut);

  if (!match) {
    return null;
  }

  const [, body, checkDigit] = match;

  if (calculateCheckDigit(body) !== checkDigit) {
    return null;
  }

  const normalizedBody = body.replace(/^0+(?=\d)/, "");
  return `${normalizedBody}-${checkDigit}`;
}
