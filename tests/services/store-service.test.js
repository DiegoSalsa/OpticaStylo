import assert from "node:assert/strict";
import test from "node:test";

import {
  checkoutCart,
  createStoreCart,
  extractPrescriptionImage,
  getStoreOrder,
  getPrescriptionImage,
  putPrescriptionImage,
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

function imageFile() {
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(1, 16);
  data.writeUInt32BE(1, 20);
  const file = new Blob([
    data,
  ], { type: "image/png" });
  Object.defineProperty(file, "name", { value: "receta.png" });
  return file;
}

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

test("agrega cristales como opción del marco en una sola operación", async () => {
  const lensId = "00000000-0000-4000-8000-000000000004";
  const result = await putStoreCartItems("token", null, {
    items: [
      { productId, quantity: 1 },
      { mountFrameProductId: productId, productId: lensId, quantity: 1 },
    ],
  }, {
    upsertItems: async (_hash, accountId, items) => {
      assert.equal(accountId, null);
      assert.deepEqual(items, [
        { mountFrameProductId: null, productId, quantity: 1 },
        { mountFrameProductId: productId, productId: lensId, quantity: 1 },
      ]);
      return { cart: { ...cart, items }, reason: null };
    },
  });
  assert.equal(result.items.length, 2);
});

test("traduce el rechazo de cristales sin marco en el carrito", async () => {
  await assert.rejects(() => putStoreCartItems("token", null, {
    items: [{ productId, quantity: 1 }],
  }, {
    upsertItems: async () => ({ cart: null, reason: "LENS_MOUNT_REQUIRED" }),
  }), (error) => error.code === "STORE_LENS_MOUNT_REQUIRED" && error.status === 409);
});

test("guarda la receta del carrito como activo privado de Cloudinary", async () => {
  const result = await putPrescriptionImage("token", null, imageFile(), {
    hashToken: () => "hash",
    mediaGateway: {
      deletePrivatePrescription: async () => assert.fail("No debe compensar una carga exitosa"),
      uploadPrivatePrescription: async () => ({
        assetId: "asset-uno",
        format: "png",
        publicId: "opticastylo/recetas/uno",
        version: 1,
      }),
    },
    saveImage: async (_hash, _accountId, image) => {
      assert.equal(image.data, undefined);
      assert.equal(image.cloudinary.assetId, "asset-uno");
      return { cart, reason: null };
    },
  });
  assert.equal(result.id, cart.id);
});

test("recupera una receta privada mediante el servidor", async () => {
  const result = await getPrescriptionImage("token", null, {
    findImage: async () => ({
      cloudinary: { assetId: "asset-uno", format: "png", publicId: "opticastylo/recetas/uno", version: 1 },
      data: null,
      filename: "receta.png",
      mediaType: "image/png",
    }),
    hashToken: () => "hash",
    mediaGateway: {
      downloadPrivatePrescription: async () => Buffer.from("image"),
    },
  });
  assert.deepEqual(result.data, Buffer.from("image"));
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

test("bloquea el checkout cuando los cristales requieren una receta confirmada", async () => {
  await assert.rejects(
    () => checkoutCart("token", null, {
      checkoutCart: async () => ({ reason: "PRESCRIPTION_REQUIRED", saleId: null }),
    }),
    (error) => error.code === "PRESCRIPTION_REQUIRED" && error.status === 409,
  );
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
    claimExtraction: async () => ({
      cached: false,
      image: { data: Buffer.from("image"), mediaType: "image/png" },
      reason: null,
    }),
    failExtraction: async () => ({ reason: null }),
  }), (error) => error.code === "PRESCRIPTION_READER_NOT_CONFIGURED" && error.status === 503);
});

test("guarda la lectura de Luna como borrador antes de confirmar la receta", async () => {
  const result = await extractPrescriptionImage("token", null, {
    claimExtraction: async () => ({
      cached: false,
      image: { data: Buffer.from("imagen"), mediaType: "image/png" },
      reason: null,
    }),
    completeExtraction: async (_hash, _accountId, provider, data) => {
      assert.equal(provider, "OPENAI_GPT_5_6_LUNA");
      assert.equal(data.rightEye.sphere, -1.25);
      return { cart, reason: null };
    },
    readPrescriptionImage: async () => ({
      data: {
        confidence: "MEDIUM",
        fulfillmentNotes: null,
        leftEye: { addition: null, axis: null, cylinder: null, sphere: null },
        pupillaryDistance: null,
        rightEye: { addition: null, axis: 90, cylinder: -0.5, sphere: -1.25 },
        warnings: ["Confirmar valores."],
      },
      provider: "OPENAI_GPT_5_6_LUNA",
    }),
  });
  assert.equal(result.cart.id, cart.id);
  assert.equal(result.extraction.cached, false);
  assert.equal(result.extraction.data.confidence, "MEDIUM");
});

test("reutiliza un borrador de receta ya leído sin cobrar otra lectura", async () => {
  const result = await extractPrescriptionImage("token", null, {
    claimExtraction: async () => ({
      cached: true,
      cart,
      data: { confidence: "LOW" },
      provider: "OPENAI_GPT_5_6_LUNA",
      reason: null,
    }),
    readPrescriptionImage: async () => assert.fail("No debe solicitar otra lectura"),
  });
  assert.equal(result.extraction.cached, true);
  assert.equal(result.extraction.data.confidence, "LOW");
});
