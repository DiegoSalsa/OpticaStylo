import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCartConfiguration,
  validateCartItemInput,
  validateCartItemsInput,
  validateExternalPrescriptionData,
  validatePrescriptionImage,
  validatePrescriptionImageBytes,
  validateStoreAccountRegistration,
} from "../../src/validations/store-validation.js";

const account = {
  address: "Av. Prueba 123",
  email: "CLIENTE@EXAMPLE.COM",
  firstNames: "  María  José ",
  lastNames: "Pérez Soto",
  password: "ClaveSeguraCliente2026!",
  phone: "+56 9 1234 5678",
  rut: "12.345.678-5",
};

function pngHeader(width, height) {
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

test("normaliza el registro de una cuenta de cliente", () => {
  const result = validateStoreAccountRegistration(account);
  assert.equal(result.email, "cliente@example.com");
  assert.equal(result.firstNames, "María José");
  assert.equal(result.phone, "+56912345678");
  assert.equal(result.rut, "12345678-5");
});

test("exige una contraseña robusta para el registro", () => {
  assert.throws(
    () => validateStoreAccountRegistration({ ...account, password: "corta" }),
    (error) => error.code === "INVALID_STORE_DATA" && error.status === 400,
  );
});

test("normaliza retiro y despacho por separado", () => {
  const buyer = {
    address: account.address,
    email: account.email,
    firstNames: account.firstNames,
    lastNames: account.lastNames,
    phone: account.phone,
    rut: account.rut,
  };
  const pickup = validateCartConfiguration({ buyer, fulfillment: { method: "pickup" } });
  const delivery = validateCartConfiguration({
    buyer,
    fulfillment: {
      address: "Calle Uno 10",
      city: "Santiago",
      method: "delivery",
      region: "Metropolitana",
    },
  });
  assert.equal(pickup.fulfillment.address, null);
  assert.equal(delivery.fulfillment.method, "DELIVERY");
});

test("valida cantidades del carrito", () => {
  assert.deepEqual(validateCartItemInput({ quantity: 2 }), {
    mountFrameProductId: null,
    quantity: 2,
  });
  assert.throws(() => validateCartItemInput({ quantity: 0 }));
});

test("valida productos distintos y vincula cristales al marco en el carrito", () => {
  const first = "00000000-0000-4000-8000-000000000001";
  const second = "00000000-0000-4000-8000-000000000002";
  assert.deepEqual(validateCartItemsInput({
    items: [
      { productId: first, quantity: 1 },
      { mountFrameProductId: first, productId: second, quantity: 2 },
    ],
  }), {
    items: [
      { mountFrameProductId: null, productId: first, quantity: 1 },
      { mountFrameProductId: first, productId: second, quantity: 2 },
    ],
  });
  assert.throws(() => validateCartItemsInput({
    items: [{ productId: first, quantity: 1 }, { productId: first, quantity: 1 }],
  }));
});

test("reutiliza las reglas ópticas para la receta externa", () => {
  const result = validateExternalPrescriptionData({
    leftEye: { addition: null, axis: null, cylinder: 0, sphere: -1 },
    rightEye: { addition: null, axis: 90, cylinder: -0.5, sphere: -1.25 },
    pupillaryDistance: 62,
  });
  assert.equal(result.rightEye.axis, 90);
  assert.equal(result.pupillaryDistance, 62);
});

test("limita la carga a imágenes admitidas", () => {
  const image = { arrayBuffer: async () => new ArrayBuffer(1), name: "receta.png", size: 1, type: "image/png" };
  assert.equal(validatePrescriptionImage(image).mediaType, "image/png");
  assert.throws(
    () => validatePrescriptionImage({ ...image, type: "application/pdf" }),
    (error) => error.code === "INVALID_PRESCRIPTION_IMAGE",
  );
});

test("comprueba la firma binaria de las recetas cargadas", () => {
  const png = pngHeader(4000, 6000);
  assert.equal(validatePrescriptionImageBytes(png, "image/png"), png);
  assert.throws(
    () => validatePrescriptionImageBytes(Buffer.from("no es una imagen"), "image/png"),
    (error) => error.code === "INVALID_PRESCRIPTION_IMAGE",
  );
  assert.throws(
    () => validatePrescriptionImageBytes(png, "image/jpeg"),
    (error) => error.code === "INVALID_PRESCRIPTION_IMAGE",
  );
});

test("rechaza recetas con dimensiones que agotan recursos", () => {
  assert.throws(
    () => validatePrescriptionImageBytes(pngHeader(8001, 1), "image/png"),
    (error) => error.code === "INVALID_PRESCRIPTION_IMAGE" && error.status === 400,
  );
});
