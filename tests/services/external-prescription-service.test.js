import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  createExternalPrescription,
  createPointOfSaleExternalPrescription,
  getExternalPrescription,
  getExternalPrescriptionFile,
  readPointOfSaleExternalPrescriptionImage,
} from "../../src/services/external-prescription-service.js";

const id = "00000000-0000-4000-8000-000000000001";
const actor = { permissions: [PERMISSIONS.SALES_READ] };

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

test("ventas registra una receta externa manual ya confirmada", async () => {
  const customerId = "00000000-0000-4000-8000-000000000002";
  const patientId = "00000000-0000-4000-8000-000000000004";
  const salesActor = {
    permissions: [PERMISSIONS.SALES_CREATE],
    userId: "00000000-0000-4000-8000-000000000003",
  };
  const confirmedData = {
    leftEye: { addition: null, axis: null, cylinder: 0, sphere: -1 },
    pupillaryDistance: 62,
    rightEye: { addition: null, axis: 90, cylinder: -0.5, sphere: -1.25 },
  };
  const result = await createPointOfSaleExternalPrescription(
    { confirmedData, customerId, patientId },
    salesActor,
    {
      createPrescription: async (data, actorId) => {
        assert.equal(data.source, "MANUAL");
        assert.equal(data.customerId, customerId);
        assert.equal(data.patientId, patientId);
        assert.equal(actorId, salesActor.userId);
        return { prescription: { id, ...data }, reason: null };
      },
      findPatientById: async (value) => value === patientId ? { id: value } : null,
    },
  );
  assert.equal(result.id, id);
});

test("ventas consulta los datos confirmados de una receta externa", async () => {
  const result = await getExternalPrescription(id, actor, {
    findPrescription: async () => ({
      confirmedData: { pupillaryDistance: 62 },
      id,
    }),
  });
  assert.equal(result.confirmedData.pupillaryDistance, 62);
});

test("ventas guarda la imagen de receta externa como activo privado", async () => {
  const customerId = "00000000-0000-4000-8000-000000000002";
  const patientId = "00000000-0000-4000-8000-000000000004";
  const salesActor = {
    permissions: [PERMISSIONS.SALES_CREATE],
    userId: "00000000-0000-4000-8000-000000000003",
  };
  const result = await createExternalPrescription({
    customerId,
    file: imageFile(),
    notes: "Receta emitida fuera de la óptica",
    patientId,
    source: "IMAGE",
  }, salesActor, {
    createPrescription: async (data) => {
      assert.equal(data.data, null);
      assert.equal(data.cloudinary.publicId, "opticastylo/recetas/uno");
      return { prescription: { id, ...data }, reason: null };
    },
    findPatientById: async () => ({ id: patientId }),
    mediaGateway: {
      deletePrivatePrescription: async () => assert.fail("No debe compensar una carga exitosa"),
      uploadPrivatePrescription: async () => ({
        assetId: "asset-uno",
        format: "png",
        publicId: "opticastylo/recetas/uno",
        version: 1,
      }),
    },
  });
  assert.equal(result.id, id);
});

test("ventas obtiene un borrador de una receta externa antes de confirmarla", async () => {
  const salesActor = {
    permissions: [PERMISSIONS.SALES_CREATE],
    userId: "00000000-0000-4000-8000-000000000003",
  };
  const result = await readPointOfSaleExternalPrescriptionImage({
    image: imageFile(),
  }, salesActor, {
    readImage: async (image) => {
      assert.equal(image.mediaType, "image/png");
      assert.equal(image.data.length, 24);
      return {
        data: { confidence: "MEDIUM", leftEye: {}, rightEye: {}, warnings: [] },
        provider: "OPENAI_GPT_5_6_LUNA",
      };
    },
  });
  assert.equal(result.provider, "OPENAI_GPT_5_6_LUNA");
});

test("impide leer recetas externas sin permiso comercial", async () => {
  await assert.rejects(
    () =>
      getExternalPrescription(
        id,
        { permissions: [] },
        {
          findPrescription: async () =>
            assert.fail("No debe consultar PostgreSQL"),
        },
      ),
    (error) =>
      error.code === "INSUFFICIENT_PERMISSIONS" && error.status === 403,
  );
});

test("entrega el archivo privado solamente a ventas", async () => {
  const result = await getExternalPrescriptionFile(id, actor, {
    findFile: async () => ({
      data: Buffer.from("image"),
      filename: "receta.png",
      mediaType: "image/png",
    }),
  });
  assert.equal(result.mediaType, "image/png");
});

test("lee una receta privada desde Cloudinary sin exponer su URL", async () => {
  const result = await getExternalPrescriptionFile(id, actor, {
    findFile: async () => ({
      cloudinary: { assetId: "asset-uno", format: "png", publicId: "opticastylo/recetas/uno", version: 1 },
      data: null,
      filename: "receta.png",
      mediaType: "image/png",
    }),
    mediaGateway: {
      downloadPrivatePrescription: async () => Buffer.from("image"),
    },
  });
  assert.deepEqual(result.data, Buffer.from("image"));
});
