import assert from "node:assert/strict";
import test from "node:test";

import { readOpenAiPrescriptionImage } from "../../src/integrations/prescriptions/openai-prescription-reader.js";

const environment = {
  OPENAI_API_KEY: "sk-proj-clave-de-prueba-suficientemente-larga",
  OPENAI_PRESCRIPTION_READER_ENABLED: "true",
};
const image = { data: Buffer.from("imagen-de-prueba"), mediaType: "image/png" };
const draft = {
  confidence: "MEDIUM",
  fulfillmentNotes: null,
  leftEye: { addition: null, axis: 90, cylinder: -0.5, sphere: 1.25 },
  pupillaryDistance: 62,
  rightEye: { addition: 1, axis: 45, cylinder: -1, sphere: -2.25 },
  warnings: ["Confirma la distancia pupilar."],
};

test("solicita un borrador estructurado a Luna sin almacenar la respuesta", async () => {
  let request;
  const result = await readOpenAiPrescriptionImage(image, {
    environment,
    fetchImplementation: async (_url, options) => {
      request = options;
      return {
        json: async () => ({
          output: [{ content: [{ text: JSON.stringify(draft), type: "output_text" }] }],
          status: "completed",
        }),
        ok: true,
      };
    },
  });

  const body = JSON.parse(request.body);
  assert.equal(body.model, "gpt-5.6-luna");
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, "json_schema");
  assert.deepEqual(result.data, draft);
  assert.equal(result.provider, "OPENAI_GPT_5_6_LUNA");
});

test("no intenta leer una receta HEIC no admitida por el proveedor", async () => {
  await assert.rejects(
    () => readOpenAiPrescriptionImage({ ...image, mediaType: "image/heic" }, { environment }),
    (error) => error.code === "PRESCRIPTION_READER_UNSUPPORTED_IMAGE" && error.status === 422,
  );
});

test("codifica los bytes de Prisma en base64 y respeta los límites de una vista Uint8Array", async () => {
  const bytes = Uint8Array.from([0, ...image.data, 255]).subarray(1, image.data.length + 1);
  await readOpenAiPrescriptionImage({ ...image, data: bytes }, {
    environment,
    fetchImplementation: async (_url, options) => {
      const sent = JSON.parse(options.body).input[0].content[1].image_url;
      assert.equal(sent, "data:image/png;base64," + image.data.toString("base64"));
      assert.deepEqual(Buffer.from(sent.split(",")[1], "base64"), image.data);
      return { ok: true, json: async () => ({ status: "completed", output_text: JSON.stringify(draft) }) };
    },
  });
});

test("fallos de red y respuestas inválidas no registran datos privados del proveedor",async()=>{
  const previous=console.error,logs=[];console.error=(...values)=>logs.push(values);
  try {
    for(const fetchImplementation of [async()=>{throw Error("private-token patient@example.invalid");},async()=>({ok:true,json:async()=>{throw Error("private-clinical-body");}})]) {
      await assert.rejects(()=>readOpenAiPrescriptionImage(image,{environment,fetchImplementation}),error=>error.status===503);
    }
  } finally {console.error=previous;}
  assert.equal(logs.length,2);assert.doesNotMatch(JSON.stringify(logs),/private|patient@/);
});
