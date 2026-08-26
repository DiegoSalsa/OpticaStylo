import assert from "node:assert/strict";
import test from "node:test";

import { createCloudinaryMediaGateway } from "../../src/integrations/media/cloudinary-media-gateway.js";

const environment = {
  CLOUDINARY_API_KEY: "123456789",
  CLOUDINARY_API_SECRET: "clave-de-prueba-suficientemente-larga",
  CLOUDINARY_CLOUD_NAME: "nube-de-prueba",
};

function createSdk() {
  const destroyed = [];
  const uploads = [];
  const configuration = [];
  return {
    config: (values) => configuration.push(values),
    destroyed,
    uploader: {
      destroy: async (publicId, options) => {
        destroyed.push({ options, publicId });
        return { result: "ok" };
      },
      upload_stream: (options, callback) => {
        uploads.push(options);
        return {
          end: () => callback(null, {
            asset_id: "asset-de-prueba",
            format: "png",
            height: 1,
            public_id: options.public_id,
            secure_url: "https://res.cloudinary.com/nube-de-prueba/image/upload/archivo.png",
            version: 1,
            width: 1,
          }),
        };
      },
    },
    url: (_publicId, options) => {
      assert.equal(options.sign_url, true);
      assert.equal(options.type, "authenticated");
      return "https://media.example.test/receta.png";
    },
    uploads,
    configuration,
  };
}

test("guarda, lee y elimina recetas privadas mediante Cloudinary", async () => {
  const sdk = createSdk();
  const expected = Buffer.from("receta-de-prueba");
  const gateway = createCloudinaryMediaGateway({
    environment,
    fetchImplementation: async (url) => {
      assert.equal(url, "https://media.example.test/receta.png");
      return {
        arrayBuffer: async () => expected,
        ok: true,
      };
    },
    sdk,
  });

  const asset = await gateway.uploadPrivatePrescription({ data: expected });
  const downloaded = await gateway.downloadPrivatePrescription(asset);
  const deleted = await gateway.deletePrivatePrescription(asset);

  assert.deepEqual(downloaded, expected);
  assert.equal(deleted, true);
  assert.equal(sdk.uploads[0].type, "authenticated");
  assert.equal(sdk.destroyed[0].options.type, "authenticated");
  assert.equal(sdk.configuration[0].cloud_name, "nube-de-prueba");
});

test("guarda y elimina imágenes públicas de productos mediante Cloudinary", async () => {
  const sdk = createSdk();
  const gateway = createCloudinaryMediaGateway({ environment, sdk });

  const asset = await gateway.uploadPublicProductImage({ data: Buffer.from("imagen-de-prueba") });
  const deleted = await gateway.deletePublicProductImage(asset);

  assert.equal(deleted, true);
  assert.equal(sdk.uploads[0].type, "upload");
  assert.equal(sdk.destroyed[0].options.type, "upload");
});
