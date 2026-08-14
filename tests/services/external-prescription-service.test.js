import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  getExternalPrescription,
  getExternalPrescriptionFile,
} from "../../src/services/external-prescription-service.js";

const id = "00000000-0000-4000-8000-000000000001";
const actor = { permissions: [PERMISSIONS.SALES_READ] };

test("ventas consulta los datos confirmados de una receta externa", async () => {
  const result = await getExternalPrescription(id, actor, {
    findPrescription: async () => ({ confirmedData: { pupillaryDistance: 62 }, id }),
  });
  assert.equal(result.confirmedData.pupillaryDistance, 62);
});

test("impide leer recetas externas sin permiso comercial", async () => {
  await assert.rejects(() => getExternalPrescription(id, { permissions: [] }, {
    findPrescription: async () => assert.fail("No debe consultar PostgreSQL"),
  }), (error) => error.code === "INSUFFICIENT_PERMISSIONS" && error.status === 403);
});

test("entrega el archivo privado solamente a ventas", async () => {
  const result = await getExternalPrescriptionFile(id, actor, {
    findFile: async () => ({ data: Buffer.from("image"), filename: "receta.png", mediaType: "image/png" }),
  });
  assert.equal(result.mediaType, "image/png");
});
