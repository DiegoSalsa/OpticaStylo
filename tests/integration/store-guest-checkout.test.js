import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { prisma } from "../../src/db/prisma.js";
import { ids, seedStoreE2e } from "../../scripts/seed-store-e2e.mjs";
import {
  checkoutCart, completeImagePrescription, createStoreCart, deleteStoreCartItem,
  extractPrescriptionImage, getPrescriptionImage, getStoreCart, getStoreOrder,
  putManualPrescription, putPrescriptionImage, putStoreCartItems, updateStoreCart,
} from "../../src/services/store-service.js";
import { registerStoreAccount } from "../../src/services/store-account-service.js";
import { listPublished3dModels } from "../../src/repositories/virtual-try-on-3d-repository.js";
import { getStoreProduct } from "../../src/services/store-catalog-service.js";
import { hashSessionToken } from "../../src/auth/session-token.js";

const buyer = { address: "Calle Prueba 123", email: "invitado@example.invalid", firstNames: "Invitado", lastNames: "Prueba", phone: "+56912345678", rut: "12345678-5" };
const optical = { rightEye: { sphere: -1.12, cylinder: -0.5, axis: 90, addition: null }, leftEye: { sphere: -1, cylinder: 0, axis: null, addition: null }, pupillaryDistance: 62.25, fulfillmentNotes: "Prueba sintética" };
const configuration = { buyer, clinicalPrescriptionId: null, fulfillment: { method: "PICKUP", notes: "Retiro de prueba" } };
const lensItems = (lensId = ids.lens) => [{ productId: ids.frame, quantity: 1 }, { productId: lensId, mountFrameProductId: ids.frame, quantity: 1 }];

test("integración PostgreSQL real: compra invitada y autenticada", { skip: !process.env.STORE_E2E_SCHEMA }, async (t) => {
  try {
    await seedStoreE2e();
    await t.test("accesorio: genera un pedido sin receta y conserva un fallo de pago recuperable", async () => {
      const { token } = await createStoreCart(null);
      await putStoreCartItems(token, null, { items: [{ productId: ids.accessory, quantity: 2 }] });
      await updateStoreCart(token, null, configuration);
      const first = await checkoutCart(token, null);
      assert.equal(first.order.totalCents, 10000);
      assert.equal(first.order.externalPrescription, null);
      assert.equal(first.order.customer.email, buyer.email);
      assert.equal(first.paymentError.code, "PAYMENT_PROVIDER_NOT_CONFIGURED");
      const again = await checkoutCart(token, null);
      assert.equal(first.order.id, again.order.id);
      assert.equal((await getStoreOrder(first.order.id, token, null)).id, first.order.id);
      const stranger = await createStoreCart(null);
      await assert.rejects(getStoreOrder(first.order.id, stranger.token, null), (e) => e.status === 404);
      await assert.rejects(getStoreOrder(first.order.id, null, null), (e) => e.status === 404);
    });
    await t.test("manual: valida, guarda, recarga, modifica cristales y crea pedido con importes de servidor", async () => {
      const { token } = await createStoreCart(null);
      await putStoreCartItems(token, null, { items: lensItems() });
      await updateStoreCart(token, null, configuration);
      await assert.rejects(checkoutCart(token, null), (e) => e.code === "PRESCRIPTION_REQUIRED");
      await assert.rejects(putManualPrescription(token, null, { ...optical, rightEye: { ...optical.rightEye, axis: null } }), (e) => e.code === "INVALID_CLINICAL_DATA");
      await putManualPrescription(token, null, optical);
      assert.deepEqual((await getStoreCart(token, null)).externalPrescription.confirmedData, optical);
      const edited = await putStoreCartItems(token, null, { items: lensItems(ids.otherLens), replaceFrameProductId: ids.frame });
      assert.deepEqual(edited.externalPrescription.confirmedData, optical);
      assert.equal(edited.items.some((i) => i.productId === ids.lens), false);
      const result = await checkoutCart(token, null);
      assert.equal(result.order.totalCents, 75000);
      assert.equal(result.order.items.find((i) => i.productId === ids.otherLens).mount.frameProductId, ids.frame);
      assert.equal((await prisma.external_prescriptions.findUnique({ where: { id: result.order.externalPrescription.id } })).confirmed_data.rightEye.sphere, -1.12);
      assert.equal(result.order.fulfillment.notes, configuration.fulfillment.notes);
    });
    await t.test("imagen: almacenamiento privado real, extracción fallida, confirmación manual e aislamiento", async () => {
      const { token } = await createStoreCart(null);
      await putStoreCartItems(token, null, { items: lensItems() });
      const data = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=", "base64");
      const file = new File([data], "receta-sintetica.png", { type: "image/png" });
      try {
        await putPrescriptionImage(token, null, file);
        const cart = await getStoreCart(token, null);
        assert.equal(cart.externalPrescription.status, "DRAFT");
        assert.equal(cart.externalPrescription.hasImage, true);
        assert.equal(JSON.stringify(cart).includes("cloudinary"), false);
        assert.ok((await getPrescriptionImage(token, null)).data.length > 0);
        const other = await createStoreCart(null);
        await assert.rejects(getPrescriptionImage(other.token, null), (e) => e.status === 404);
        await assert.rejects(extractPrescriptionImage(token, null), (e) => e.code === "PRESCRIPTION_READER_NOT_CONFIGURED");
        await completeImagePrescription(token, null, optical);
        await updateStoreCart(token, null, configuration);
        const result = await checkoutCart(token, null);
        assert.equal(result.order.externalPrescription.source, "IMAGE");
        assert.equal(result.order.externalPrescription.status, "READY");
      } finally {
        // El reemplazo manual limpia el archivo privado después de la comprobación.
        const row = await prisma.external_prescriptions.findFirst({ where: { store_carts: { token_hash: hashSessionToken(token) } } });
        if (row?.cloudinary_asset_id) {
          const { getCloudinaryMediaGateway } = await import("../../src/integrations/media/cloudinary-media-gateway.js");
          assert.equal(await getCloudinaryMediaGateway().deletePrivatePrescription({ publicId: row.cloudinary_public_id }), true);
        }
      }
    });
    await t.test("quitar un marco quita sus cristales y no deja una configuración huérfana", async () => {
      const { token } = await createStoreCart(null);
      await putStoreCartItems(token, null, { items: lensItems() });
      assert.equal((await deleteStoreCartItem(token, null, ids.frame)).items.length, 0);
    });
    await t.test("cristales sin graduación no exigen parámetros de receta", async () => {
      const { token } = await createStoreCart(null);
      await putStoreCartItems(token, null, { items: lensItems(ids.noRxLens) });
      await updateStoreCart(token, null, configuration);
      const result = await checkoutCart(token, null);
      assert.equal(result.order.totalCents, 60000);
      assert.equal(result.order.externalPrescription, null);
    });
    await t.test("rechaza reasignación silenciosa del mismo cristal a otro marco", async () => {
      const { token } = await createStoreCart(null);
      await putStoreCartItems(token, null, { items: lensItems() });
      await assert.rejects(putStoreCartItems(token, null, { items: [
        { productId: ids.rayban, quantity: 1 }, { productId: ids.lens, mountFrameProductId: ids.rayban, quantity: 1 },
      ] }), (e) => e.code === "STORE_LENS_MOUNT_CONFLICT");
      assert.equal((await getStoreCart(token, null)).items.find((i) => i.productId === ids.lens).mountFrameProductId, ids.frame);
    });
    await t.test("los carritos vencidos no exponen recetas ni permiten checkout", async () => {
      const { token, cart } = await createStoreCart(null);
      await prisma.store_carts.update({ where: { id: cart.id }, data: { expires_at: new Date(0) } });
      await assert.rejects(getStoreCart(token, null), (e) => e.status === 404);
      await assert.rejects(checkoutCart(token, null), (e) => e.code === "CART_NOT_ACTIVE");
    });
    await t.test("cliente autenticado compra y consulta pedidos propios sin exponer otros", async () => {
      const { account } = await registerStoreAccount({ ...buyer, rut: "11111111-1", email: "cuenta@example.invalid", password: "ClavePruebaSegura2026!" });
      const { token } = await createStoreCart(account);
      await putStoreCartItems(token, account, { items: lensItems() });
      await putManualPrescription(token, account, optical);
      await updateStoreCart(token, account, configuration);
      const result = await checkoutCart(token, account);
      assert.equal((await getStoreOrder(result.order.id, null, account)).id, result.order.id);
      const stranger = await createStoreCart(null);
      await assert.rejects(getStoreCart(token, null), (e) => e.status === 404);
      await assert.rejects(getStoreOrder(result.order.id, stranger.token, null), (e) => e.status === 404);
    });
    await t.test("VTO: solo los dos modelos publicados; los demás marcos y accesorios no tienen etiqueta", async () => {
      assert.deepEqual((await listPublished3dModels()).map((m) => m.sku).sort(), ["HD0896-001", "RB2140-901-50"]);
      assert.ok((await getStoreProduct(ids.frame)).virtualTryOn);
      assert.ok((await getStoreProduct(ids.rayban)).virtualTryOn);
      assert.equal((await getStoreProduct(ids.noVto)).virtualTryOn, null);
      assert.equal((await getStoreProduct(ids.accessory)).virtualTryOn, null);
      // Un registro ACTIVE corrupto tampoco representa un modelo operativo.
      await prisma.virtual_try_on_3d_assets.create({ data: {
        product_id: ids.noVto, version: 1, original_filename: "no-existe.glb",
        file_size_bytes: 1, file_sha256: "0".repeat(64), model_data: Buffer.from("x"),
        model_metadata: {}, license_code: "CC0-1.0", created_by: "00000000-0000-4000-8000-000000000099",
      } });
      assert.equal((await getStoreProduct(ids.noVto)).virtualTryOn, null);
      await prisma.products.update({ where: { id: ids.rayban }, data: { is_active: false } });
      assert.equal((await listPublished3dModels()).some((m) => m.productId === ids.rayban), false);
      await prisma.products.update({ where: { id: ids.rayban }, data: { is_active: true } });
      const bytes = await readFile(new URL("../../public/virtual-try-on/models/RB2140-901-50-v2.19.glb", import.meta.url));
      const metadata = JSON.parse(await readFile(new URL("../../public/virtual-try-on/models/RB2140-901-50-v2.19.tryon.json", import.meta.url), "utf8"));
      const published = await prisma.virtual_try_on_3d_assets.update({
        where: { product_id_version: { product_id: ids.noVto, version: 1 } },
        data: { model_data: bytes, file_size_bytes: bytes.length, file_sha256: metadata.identity.sha256,
          model_metadata: { ...metadata, identity: { ...metadata.identity, sku: "SIN-VTO" } } },
      });
      assert.ok((await getStoreProduct(ids.noVto)).virtualTryOn);
      await prisma.virtual_try_on_3d_assets.update({ where: { id: published.id }, data: {
        status: "RETIRED", retired_by: "00000000-0000-4000-8000-000000000099", retired_at: new Date(),
      } });
      assert.equal((await getStoreProduct(ids.noVto)).virtualTryOn, null);
    });
  } finally { await prisma.$disconnect(); }
});
