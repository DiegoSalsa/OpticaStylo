import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { downloadProductImage } from "../../src/integrations/media/product-image-downloader.js";

test("rechaza servidores no aprobados, direcciones privadas e IPv4 encapsulado", async () => {
  await assert.rejects(() => downloadProductImage("https://photos.example.test/foto.jpg", { allowedHosts: [] }));
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "::ffff:127.0.0.1"]) {
    await assert.rejects(() => downloadProductImage("https://photos.example.test/foto.jpg", { allowedHosts: ["photos.example.test"], resolve: async () => [{ address, family: address.includes(":") ? 6 : 4 }] }));
  }
});
test("no sigue redirecciones ni acepta HTML", async () => {
  for (const [statusCode, type] of [[302, "image/jpeg"], [200, "text/html"], [404, "text/html"], [429, "text/html"]]) {
    const response = Object.assign(new EventEmitter(), { statusCode, headers: { "content-type": type }, destroy() {} });
    await assert.rejects(() => downloadProductImage("https://photos.example.test/foto.jpg", {
      allowedHosts: ["photos.example.test"], resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      request: (_url, options, callback) => {
        options.lookup("photos.example.test", {}, (_error, address) => assert.equal(address, "8.8.8.8"));
        const req = new EventEmitter(); req.end = () => callback(response); return req;
      },
    }));
  }
});
