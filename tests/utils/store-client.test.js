import assert from "node:assert/strict";
import test from "node:test";
import { ensureStoreCart } from "../../src/utils/store-client.js";

const response = (data, status = 200) => Response.json({ success: true, data }, { status });
test("los montajes concurrentes crean un solo carrito y la siguiente compra reemplaza el carrito cerrado", async () => {
  const originalFetch = globalThis.fetch;
  let creations = 0;
  let stored = null;
  globalThis.fetch = async (_url, options) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (options?.method === "POST") {
      creations += 1; stored = { id: `cart-${creations}`, status: "ACTIVE", items: [] };
      return response(stored, 201);
    }
    return stored ? response(stored) : Response.json({ success: false }, { status: 404 });
  };
  try {
    const [a, b] = await Promise.all([ensureStoreCart(), ensureStoreCart()]);
    assert.equal(creations, 1); assert.equal(a.id, b.id);
    stored.status = "CHECKED_OUT";
    assert.equal((await ensureStoreCart()).status, "CHECKED_OUT");
    const [c, d] = await Promise.all([ensureStoreCart({ forShopping: true }), ensureStoreCart({ forShopping: true })]);
    assert.equal(creations, 2); assert.equal(c.id, d.id); assert.equal(c.status, "ACTIVE");
  } finally { globalThis.fetch = originalFetch; }
});
