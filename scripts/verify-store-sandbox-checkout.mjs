import { prisma } from "../src/db/prisma.js";
import { ids, requireIsolatedStoreDatabase } from "./seed-store-e2e.mjs";
import { checkoutCart, createStoreCart, putManualPrescription, putStoreCartItems, updateStoreCart } from "../src/services/store-service.js";

requireIsolatedStoreDatabase();
if (process.env.MERCADO_PAGO_MODE !== "sandbox" || process.env.MERCADO_PAGO_PRODUCTION_ENABLED === "true") {
  throw new Error("La comprobación del proveedor requiere modo sandbox con pagos de producción bloqueados.");
}
try {
  const { token } = await createStoreCart(null);
  await putStoreCartItems(token, null, { items: [
    { productId: ids.frame, quantity: 1 }, { productId: ids.lens, mountFrameProductId: ids.frame, quantity: 1 },
  ] });
  await putManualPrescription(token, null, {
    rightEye: { sphere: -1, cylinder: 0, axis: null, addition: null },
    leftEye: { sphere: -1, cylinder: 0, axis: null, addition: null }, pupillaryDistance: 62,
  });
  await updateStoreCart(token, null, {
    buyer: { rut: "12345678-5", firstNames: "Sandbox", lastNames: "Prueba", email: "sandbox@example.invalid", phone: "+56912345678", address: "Calle prueba 123" },
    fulfillment: { method: "PICKUP" },
  });
  const result = await checkoutCart(token, null);
  if (!result.payment?.checkoutUrl) {
    console.log(JSON.stringify({ sandboxPreference: "unavailable", code: result.paymentError?.code, orderPreserved: Boolean(result.order.id) }));
  } else {
    const repeated = await checkoutCart(token, null);
    if (repeated.order.id !== result.order.id || repeated.payment.id !== result.payment.id) throw new Error("El reintento duplicó el pedido o la preferencia.");
    console.log(JSON.stringify({ sandboxPreference: "created", provider: result.payment.provider,
      orderId: result.order.id, amountCents: result.order.totalCents, duplicateCreated: false,
      checkoutHost: new URL(result.payment.checkoutUrl).hostname, charged: false }));
  }
} finally { await prisma.$disconnect(); }
