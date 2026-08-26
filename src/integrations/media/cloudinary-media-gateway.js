import { randomUUID } from "node:crypto";

import { v2 as cloudinary } from "cloudinary";

import { getCloudinaryConfig } from "../../config/cloudinary.js";
import { AppError } from "../../utils/app-error.js";

function configure(sdk, environment) {
  const configuration = getCloudinaryConfig(environment);
  sdk.config({
    api_key: configuration.apiKey,
    api_secret: configuration.apiSecret,
    cloud_name: configuration.cloudName,
    secure: true,
  });
  return configuration;
}

function uploadBuffer(sdk, data, options) {
  return new Promise((resolve, reject) => {
    const stream = sdk.uploader.upload_stream(options, (error, result) => {
      if (error) reject(error);
      else if (!result?.asset_id || !result.public_id || !result.version || !result.secure_url) {
        reject(new Error("Cloudinary no devolvió los metadatos obligatorios del archivo."));
      } else resolve(result);
    });
    stream.end(data);
  });
}

function uploadFailure(error) {
  console.error("No fue posible guardar un archivo en Cloudinary.", error);
  throw new AppError({
    code: "MEDIA_STORAGE_UNAVAILABLE",
    message: "No fue posible guardar el archivo. Inténtelo nuevamente.",
    status: 503,
  });
}

function uploadResult(result) {
  return {
    assetId: result.asset_id,
    format: result.format,
    height: Number.isInteger(result.height) ? result.height : null,
    publicId: result.public_id,
    secureUrl: result.secure_url,
    version: Number(result.version),
    width: Number.isInteger(result.width) ? result.width : null,
  };
}

export function createCloudinaryMediaGateway({
  environment = process.env,
  fetchImplementation = fetch,
  sdk = cloudinary,
} = {}) {
  const configuration = configure(sdk, environment);

  return Object.freeze({
    async deletePrivatePrescription(asset) {
      try {
        const result = await sdk.uploader.destroy(asset.publicId, {
          invalidate: true,
          resource_type: "image",
          type: "authenticated",
        });
        return result.result === "ok" || result.result === "not found";
      } catch (error) {
        console.error("No fue posible eliminar una receta privada de Cloudinary.", error);
        return false;
      }
    },

    async deletePublicProductImage(asset) {
      try {
        const result = await sdk.uploader.destroy(asset.publicId, {
          invalidate: true,
          resource_type: "image",
          type: "upload",
        });
        return result.result === "ok" || result.result === "not found";
      } catch (error) {
        console.error("No fue posible eliminar una imagen pública de Cloudinary.", error);
        return false;
      }
    },

    async downloadPrivatePrescription(asset) {
      const url = sdk.url(asset.publicId, {
        format: asset.format,
        resource_type: "image",
        secure: true,
        sign_url: true,
        type: "authenticated",
        version: asset.version,
      });
      let response;
      try {
        response = await fetchImplementation(url, { cache: "no-store" });
      } catch (error) {
        return uploadFailure(error);
      }
      if (!response.ok) {
        console.error("Cloudinary rechazó la lectura de una receta privada.", response.status);
        throw new AppError({
          code: "MEDIA_STORAGE_UNAVAILABLE",
          message: "No fue posible leer el archivo. Inténtelo nuevamente.",
          status: 503,
        });
      }
      return Buffer.from(await response.arrayBuffer());
    },

    async uploadPrivatePrescription({ data }) {
      try {
        const result = await uploadBuffer(sdk, data, {
          folder: "opticastylo/recetas",
          overwrite: false,
          public_id: `receta-${randomUUID()}`,
          resource_type: "image",
          type: "authenticated",
          use_filename: false,
        });
        return uploadResult(result);
      } catch (error) {
        return uploadFailure(error);
      }
    },

    async uploadPublicProductImage({ data }) {
      try {
        const result = await uploadBuffer(sdk, data, {
          folder: "opticastylo/productos",
          overwrite: false,
          public_id: `producto-${randomUUID()}`,
          resource_type: "image",
          type: "upload",
          use_filename: false,
        });
        return uploadResult(result);
      } catch (error) {
        return uploadFailure(error);
      }
    },

    cloudName: configuration.cloudName,
  });
}

export function getCloudinaryMediaGateway(options) {
  return createCloudinaryMediaGateway(options);
}
