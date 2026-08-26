import assert from "node:assert/strict";
import test from "node:test";

import { getCloudinaryConfig } from "../../src/config/cloudinary.js";

const environment = {
  CLOUDINARY_API_KEY: "123456789",
  CLOUDINARY_API_SECRET: "clave-de-prueba-suficientemente-larga",
  CLOUDINARY_CLOUD_NAME: "nube-de-prueba",
};

test("carga la configuración de Cloudinary sin exponer secretos", () => {
  const result = getCloudinaryConfig(environment);
  assert.equal(result.cloudName, "nube-de-prueba");
  assert.equal(result.apiKey, environment.CLOUDINARY_API_KEY);
});

test("rechaza una configuración incompleta de Cloudinary", () => {
  assert.throws(
    () => getCloudinaryConfig({ CLOUDINARY_CLOUD_NAME: "nube-de-prueba" }),
    (error) => error.code === "CLOUDINARY_NOT_CONFIGURED" && error.status === 503,
  );
});
