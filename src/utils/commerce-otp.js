import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
export const commerceCode = () => String(randomInt(0, 1000000)).padStart(6, "0");
export function commerceCodeHash(id, code) {
  const secret = process.env.CUSTOMER_COMMERCE_OTP_SECRET;
  if (!secret || secret.length < 32) throw new Error("Falta configurar el secreto de verificación comercial.");
  return createHmac("sha256", secret).update(`commerce:${id}:${code}`).digest("hex");
}
export function verifyCommerceCode(id, code, expected) {
  const a = Buffer.from(commerceCodeHash(id, code), "hex"),
    b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export function isolatedCommerceMailbox() {
  if (process.env.CUSTOMER_COMMERCE_TEST_MAILBOX !== "true") return false;
  let u;
  try {
    u = new URL(process.env.DATABASE_URL);
  } catch {
    return false;
  }
  return u.hostname === "127.0.0.1" && u.port === String(process.env.EVALUATION_PG_PORT ?? "55441") && u.username === "stylo_test" && u.pathname === "/opticastylo_evaluation" && /^stylo_e2e_[a-f0-9]{16}$/.test(u.searchParams.get("schema") ?? "") && process.env.EMAIL_MODE === "disabled";
}
