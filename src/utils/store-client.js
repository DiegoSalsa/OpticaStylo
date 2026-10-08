export async function readStoreResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const error = new Error(payload?.error?.message ?? "No fue posible completar la solicitud.");
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

let pendingCart = null;
export async function ensureStoreCart({ forShopping = false } = {}) {
  // Compartir la creación entre montajes concurrentes evita rotar la cookie
  // mientras otro componente ya está guardando productos.
  if (!pendingCart) pendingCart = (async () => {
    const response = await fetch("/api/store/cart", { cache: "no-store" });
    if (response.ok) return readStoreResponse(response);
    if (response.status !== 404) return readStoreResponse(response);
    return readStoreResponse(await fetch("/api/store/cart", { method: "POST" }));
  })().finally(() => { pendingCart = null; });
  const cart = await pendingCart;
  if (forShopping && cart.status !== "ACTIVE") {
    if (!pendingCart) pendingCart = fetch("/api/store/cart", { method: "POST" })
      .then(readStoreResponse).finally(() => { pendingCart = null; });
    return pendingCart;
  }
  return cart;
}

export const formatClp = (value) => new Intl.NumberFormat("es-CL", {
  currency: "CLP", maximumFractionDigits: 0, style: "currency",
}).format(value);
