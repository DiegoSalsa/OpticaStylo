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

export async function ensureStoreCart() {
  const response = await fetch("/api/store/cart", { cache: "no-store" });
  if (response.ok) return readStoreResponse(response);
  if (response.status !== 404) return readStoreResponse(response);
  return readStoreResponse(await fetch("/api/store/cart", { method: "POST" }));
}

export const formatClp = (value) => new Intl.NumberFormat("es-CL", {
  currency: "CLP", maximumFractionDigits: 0, style: "currency",
}).format(value);
