import https from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { MAX_PRODUCT_IMAGE_BYTES } from "../../validations/product-image-validation.js";
import { publicSourceUrl } from "../../validations/product-image-provenance.js";

const privateNetworks = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]]) privateNetworks.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) privateNetworks.addSubnet(address, prefix, "ipv6");

// Fijar la dirección resuelta en la conexión impide redirecciones y cambios de DNS hacia redes privadas.
export async function downloadProductImage(source, { allowedHosts, resolve = lookup, request = https.request } = {}) {
  const url = new URL(publicSourceUrl(source));
  if (!Array.isArray(allowedHosts) || !allowedHosts.includes(url.hostname)) throw new Error("El servidor de la fotografía no está aprobado en el manifiesto.");
  const addresses = await resolve(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isIP(address) || privateNetworks.check(address, isIP(address) === 6 ? "ipv6" : "ipv4"))) {
    throw new Error("El servidor de origen no tiene una dirección pública permitida.");
  }
  const pinned = addresses[0];
  return new Promise((resolvePromise, reject) => {
    const req = request(url, {
      method: "GET", signal: AbortSignal.timeout(20000), headers: { Accept: "image/jpeg,image/png,image/webp", "User-Agent": "OpticaStylo-ImageImport/1.0" },
      lookup: (_host, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
    }, (response) => {
      const type = String(response.headers["content-type"] ?? "").split(";")[0].trim();
      if (response.statusCode !== 200 || !["image/jpeg", "image/png", "image/webp"].includes(type)) {
        const error = new Error(`Origen rechazado: HTTP ${response.statusCode}; formato no admitido o redirección.`);
        error.code = response.statusCode === 404 ? "SOURCE_IMAGE_NOT_FOUND" : response.statusCode === 429 ? "SOURCE_RATE_LIMITED" : response.statusCode >= 500 ? "SOURCE_UNAVAILABLE" : "SOURCE_REJECTED";
        const retryAfter = String(response.headers["retry-after"] ?? "");
        const retryMs = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        error.retryAfterMs = Number.isFinite(retryMs) ? Math.min(30000, Math.max(0, retryMs)) : 0;
        response.destroy(); reject(error); return;
      }
      let size = 0;
      const chunks = [];
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_PRODUCT_IMAGE_BYTES) response.destroy(new Error("La imagen supera 4 MiB."));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolvePromise({ data: Buffer.concat(chunks), mediaType: type }));
    });
    req.on("error", reject);
    req.end();
  });
}
