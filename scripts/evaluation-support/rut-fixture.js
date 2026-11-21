// Genera un RUT sintético con dígito verificador válido.
export function fixtureRut(index) {
  const body = String(20000000 + index);
  let sum = 0, factor = 2;
  for (const digit of [...body].reverse()) { sum += Number(digit) * factor; factor = factor === 7 ? 2 : factor + 1; }
  const digit = 11 - sum % 11;
  return `${body}-${digit === 11 ? "0" : digit === 10 ? "K" : digit}`;
}
