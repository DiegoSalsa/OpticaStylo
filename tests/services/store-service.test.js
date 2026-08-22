import assert from "node:assert/strict";
import test from "node:test";

import {
  checkoutCart,
  createStoreCart,
  extractPrescriptionImage,
  getStoreOrder,
  putStoreCartItem,
  putStoreCartItems,
  retryStoreOrderCheckout,
} from "../../src/services/store-service.js";

const productId = "00000000-0000-4000-8000-000000000001";
const orderId = "00000000-0000-4000-8000-000000000002";
const account = { id: "00000000-0000-4000-8000-000000000003" };
const cart = { id: "cart", items: [], status: "ACTIVE" };
const sale = {
  balanceCents: 50000,
  createdAt: new Date(),
  externalPrescription: null,
  fulfillment: { method: "PICKUP" },
  id: orderId,
  items: [],
  paidCents: 0,
  paymentMethod: null,
  saleNumber: 10,
  shippingFeeCents: 0,
  status: "PENDING",
  subtotalCents: 50000,
  totalCents: 50000,
};

test("crea un carrito invitado con token opaco", async () => {
  const result = await createStoreCart(null, {
    createCart: async (hash, accountId) => {
      assert.equal(hash, "hash");
      assert.equal(accountId, null);
      return cart;
    },
    createToken: () => "token",
    hashToken: () => "hash",
  });
  assert.equal(result.token, "token");
  assert.equal(result.cart, cart);
});

test("agrega productos después de validar identificador y cantidad", async () => {
  const result = await putStoreCartItem("token", null, productId, { quantity: 2 }, {
    upsertItem: async (_hash, accountId, receivedProductId, quantity) => {
      assert.equal(accountId, null);
      assert.equal(receivedProductId, productId);
      assert.equal(quantity, 2);
      return { cart: { ...cart, items: [{ productId, quantity }] }, reason: null };
    },
  });
  assert.equal(result.items[0].quantity, 2);
});

test("agrega marco y cristales en una sola operación", async () => {
  const lensId = "00000000-0000-4000-8000-000000000004";
  const result = await putStoreCartItems("token", null, {
    items: [{ productId, quantity: 1 }, { productId: lensId, quantity: 1 }],
  }, {
    upsertItems: async (_hash, accountId, items) => {
      assert.equal(accountId, null);
      assert.deepEqual(items, [{ productId, quantity: 1 }, { productId: lensId, quantity: 1 }]);
      return { cart: { ...cart, items }, reason: null };
    },
  });
  assert.equal(result.items.length, 2);
});

test("convierte el carrito en venta y crea el checkout real desacoplado", async () => {
  const result = await checkoutCart("token", null, {
    checkoutCart: async () => ({ reason: null, saleId: orderId }),
    createMercadoPagoCheckout: async (id) => ({ id: `payment-${id}` }),
    findSaleById: async () => sale,
  });
  assert.equal(result.order.id, orderId);
  assert.equal(result.payment.id, `payment-${orderId}`);
  assert.equal(result.order.totalCents, 50000);
});

test("una cuenta consulta solamente sus propios pedidos", async () => {
  const result = await getStoreOrder(orderId, null, account, {
    findSaleById: async () => sale,
    listOrders: async (accountId) => {
      assert.equal(accountId, account.id);
      return [orderId];
    },
  });
  assert.equal(result.id, orderId);
});

test("reintenta el checkout solamente para un pedido propio con saldo pendiente", async () => {
  const result = await retryStoreOrderCheckout(orderId, null, account, {
    createMercadoPagoCheckout: async (id) => ({ checkoutUrl: `https://checkout.test/${id}` }),
    findSaleById: async () => sale,
    listOrders: async () => [orderId],
  });
  assert.equal(result.checkoutUrl, `https://checkout.test/${orderId}`);
});

test("rechaza reintentar un pedido ya pagado", async () => {
  await assert.rejects(() => retryStoreOrderCheckout(orderId, null, account, {
    findSaleById: async () => ({ ...sale, balanceCents: 0, status: "PAID" }),
    listOrders: async () => [orderId],
  }), (error) => error.code === "STORE_ORDER_NOT_PAYABLE" && error.status === 409);
});

test("mantiene cerrada la lectura automática sin proveedor autorizado", async () => {
  await assert.rejects(() => extractPrescriptionImage("token", null, {
    findImage: async () => ({ data: Buffer.from("image"), mediaType: "image/png" }),
  }), (error) => error.code === "PRESCRIPTION_READER_NOT_CONFIGURED" && error.status === 503);
});
