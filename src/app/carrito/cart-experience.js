"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Icon from "@/components/ui/icon";
import {
  cartHasReadyPrescription,
  cartRequiresPrescription,
  itemRequiresPrescription,
} from "@/utils/prescription-requirement";
import { ensureStoreCart, formatClp, readStoreResponse } from "@/utils/store-client";

import PrescriptionImageInput from "./prescription-image-input";

function opticalData(form) {
  const value = (name, nullable = false) => {
    const raw = form.get(name);
    return nullable && raw === "" ? null : Number(raw);
  };
  const eye = (prefix) => ({
    addition: value(`${prefix}Addition`, true),
    axis: value(`${prefix}Axis`, true),
    cylinder: value(`${prefix}Cylinder`),
    sphere: value(`${prefix}Sphere`),
  });
  return {
    fulfillmentNotes: form.get("fulfillmentNotes") || null,
    leftEye: eye("left"),
    pupillaryDistance: value("pupillaryDistance", true),
    rightEye: eye("right"),
  };
}

const EMPTY_PRESCRIPTION_DRAFT = Object.freeze({
  confidence: "LOW",
  fulfillmentNotes: null,
  leftEye: Object.freeze({ addition: null, axis: null, cylinder: null, sphere: null }),
  pupillaryDistance: null,
  rightEye: Object.freeze({ addition: null, axis: null, cylinder: null, sphere: null }),
  warnings: Object.freeze([]),
});

function fieldValue(value) {
  return value ?? "";
}

function mountName(item, items) {
  if (!item.mountFrameProductId) return null;
  return items.find((candidate) => candidate.productId === item.mountFrameProductId)?.name
    ?? "Marco seleccionado";
}

export default function CartExperience() {
  const [cart, setCart] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prescriptionMode, setPrescriptionMode] = useState("IMAGE");
  const [prescriptionDraft, setPrescriptionDraft] = useState(null);
  const [prescriptionImage, setPrescriptionImage] = useState(null);
  const prescriptionRequired = useMemo(
    () => cartRequiresPrescription(cart?.items),
    [cart],
  );
  const prescriptionReady = cartHasReadyPrescription(cart, cart?.items);

  useEffect(() => {
    ensureStoreCart()
      .then((data) => {
        setCart(data);
        setPrescriptionDraft(data.externalPrescription?.extractedData ?? null);
        setStatus("ready");
      })
      .catch((requestError) => {
        setError(requestError.message);
        setStatus("error");
      });
  }, []);

  async function update(item, quantity) {
    setError("");
    setStatus("saving");
    try {
      const response = quantity < 1
        ? await fetch(`/api/store/cart/items/${item.productId}`, { method: "DELETE" })
        : await fetch(`/api/store/cart/items/${item.productId}`, {
          body: JSON.stringify({
            mountFrameProductId: item.mountFrameProductId,
            quantity,
          }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        });
      setCart(await readStoreResponse(response));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setStatus("ready");
    }
  }

  async function uploadAndReadPrescriptionImage(image) {
    const upload = new FormData();
    upload.set("image", image);
    const uploadedCart = await readStoreResponse(await fetch("/api/store/cart/prescription/image", {
      body: upload,
      method: "PUT",
    }));
    setCart(uploadedCart);
    setPrescriptionImage(null);
    setPrescriptionDraft(null);
    const extraction = await readStoreResponse(await fetch("/api/store/cart/prescription/extract", {
      method: "POST",
    }));
    setCart(extraction.cart);
    setPrescriptionDraft(extraction.extraction.data);
    setNotice("Completamos los valores sugeridos. Revisa cada uno antes de confirmar la receta.");
  }

  async function handlePrescriptionImageChange(image) {
    if (!image) {
      setPrescriptionImage(null);
      return;
    }
    setError("");
    setNotice("Leyendo la receta…");
    setPrescriptionImage(image);
    setStatus("saving");
    try {
      await uploadAndReadPrescriptionImage(image);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setStatus("ready");
    }
  }

  async function savePrescription(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setStatus("saving");
    const form = new FormData(event.currentTarget);
    try {
      if (prescriptionMode === "IMAGE") {
        const hasNewImage = prescriptionImage instanceof File && prescriptionImage.size > 0;
        let currentCart = cart;
        if (!hasNewImage && !currentCart.externalPrescription?.hasImage) {
          throw new Error("Adjunta una imagen o toma una foto de la receta para continuar.");
        }
        if (hasNewImage) {
          await uploadAndReadPrescriptionImage(prescriptionImage);
          return;
        }
        const currentDraft = prescriptionDraft ?? currentCart.externalPrescription?.extractedData;
        if (!currentDraft) {
          const extraction = await readStoreResponse(await fetch("/api/store/cart/prescription/extract", {
            method: "POST",
          }));
          setCart(extraction.cart);
          setPrescriptionDraft(extraction.extraction.data);
          setNotice("Revisa cada valor sugerido antes de confirmar la receta. La lectura automática no la aprueba.");
          return;
        }
        setCart(await readStoreResponse(await fetch("/api/store/cart/prescription/confirm", {
          body: JSON.stringify(opticalData(form)),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        })));
        setPrescriptionDraft(null);
      } else {
        setCart(await readStoreResponse(await fetch("/api/store/cart/prescription/manual", {
          body: JSON.stringify(opticalData(form)),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        })));
      }
      setNotice("Receta guardada como datos pendientes de revisión al preparar el lente.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setStatus("ready");
    }
  }

  function enableManualImageReview() {
    setError("");
    setNotice("Completa y confirma los valores manualmente. La imagen se conservará como respaldo privado.");
    setPrescriptionDraft(EMPTY_PRESCRIPTION_DRAFT);
  }

  async function checkout(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setStatus("saving");
    const form = new FormData(event.currentTarget);
    try {
      const configured = await readStoreResponse(await fetch("/api/store/cart", {
        body: JSON.stringify({
          buyer: {
            address: form.get("address"),
            email: form.get("email"),
            firstNames: form.get("firstNames"),
            lastNames: form.get("lastNames"),
            phone: form.get("phone"),
            rut: form.get("rut"),
          },
          clinicalPrescriptionId: null,
          fulfillment: { method: "PICKUP", notes: form.get("notes") || null },
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }));
      setCart(configured);
      const result = await readStoreResponse(await fetch("/api/store/cart/checkout", {
        method: "POST",
      }));
      if (result.payment?.checkoutUrl) window.location.assign(result.payment.checkoutUrl);
      else setNotice(`Pedido N.º ${result.order.saleNumber} creado. El pago requiere configuración de Mercado Pago.`);
    } catch (requestError) {
      setError(requestError.message);
      setStatus("ready");
    }
  }

  if (status === "loading") {
    return <main className="cart-page"><p>Cargando tu carrito…</p></main>;
  }

  if (status === "error" && !cart) {
    return <main className="cart-page"><div className="cart-empty"><h1>No pudimos abrir el carrito</h1><p>{error}</p></div></main>;
  }

  if (cart?.status === "CHECKED_OUT") {
    return <main className="cart-page"><header><p className="eyebrow">Compra en línea</p><h1>Tu pedido ya fue creado</h1><p>Este carrito quedó cerrado para impedir cobros o pedidos duplicados.</p></header><div className="cart-empty"><Icon name="receipt" size={42} /><h2>Pedido en proceso</h2><p>Consulta el estado confirmado de forma segura por Mercado Pago. Si el pago falló, podrás reintentarlo desde esa pantalla.</p><div className="result-actions"><Link className="button button--primary" href="/checkout/mercado-pago/pending">Ver estado del pago</Link><Link className="button button--secondary" href="/tienda">Volver al catálogo</Link></div></div></main>;
  }

  if (!cart?.items.length) {
    return <main className="cart-page"><nav className="cart-breadcrumb" aria-label="Migas de pan"><Link href="/">Inicio</Link><span>/</span><Link href="/tienda">Catálogo</Link><span>/</span><span>Checkout</span></nav><header><p className="eyebrow">Compra en línea</p><h1>Completa tu compra</h1><p>Tu carrito se conserva en este dispositivo durante 30 días, aunque compres como invitado.</p></header><div className="cart-empty"><Icon name="cart" size={42} /><h2>Tu carrito está vacío</h2><p>Explora los productos publicados y agrega los que quieras revisar.</p><Link className="button button--primary" href="/tienda">Ver catálogo</Link></div></main>;
  }

  return <main className="cart-page">
    <nav className="cart-breadcrumb" aria-label="Migas de pan"><Link href="/">Inicio</Link><span>/</span><Link href="/tienda">Catálogo</Link><span>/</span><span>Checkout</span></nav>
    <header><p className="eyebrow">Compra en línea</p><h1>Completa tu compra</h1><p>Tu carrito se conserva en este dispositivo durante 30 días, aunque compres como invitado.</p></header>
    <ol className="checkout-progress" aria-label="Progreso de compra"><li className="complete"><span>1</span><div><strong>Carrito</strong><small>Productos</small></div></li><li className={prescriptionRequired && !prescriptionReady ? "active" : "complete"}><span>2</span><div><strong>Receta</strong><small>{prescriptionRequired ? prescriptionReady ? "Lista" : "Obligatoria" : "No necesaria"}</small></div></li><li className="active"><span>3</span><div><strong>Datos</strong><small>Comprador</small></div></li><li><span>4</span><div><strong>Retiro</strong><small>Entrega</small></div></li><li><span>5</span><div><strong>Pago</strong><small>Mercado Pago</small></div></li></ol>
    <div className="cart-layout">
      <section className="cart-content">
        <article className="cart-card">
          <h2>Productos</h2>
          {cart.items.map((item) => <div className="cart-line" key={item.productId}><span className="cart-product-icon"><Icon name={item.category === "FRAME" ? "eye" : "package"} /></span><div><strong>{item.name}</strong><small>{item.sku}{itemRequiresPrescription(item) ? " · Receta obligatoria" : ""}</small>{mountName(item, cart.items) && <small>Para: {mountName(item, cart.items)}</small>}</div><div className="cart-quantity"><button onClick={() => update(item, item.quantity - 1)} type="button">−</button><span>{item.quantity}</span><button onClick={() => update(item, item.quantity + 1)} type="button">+</button></div><b>{formatClp(item.lineTotalCents)}</b><button aria-label={`Eliminar ${item.name}`} className="remove-line" onClick={() => update(item, 0)} type="button">×</button></div>)}
        </article>

        {prescriptionRequired && <article className="cart-card prescription-card">
          <div className="cart-card-heading">
            <div>
              <h2>Receta óptica obligatoria</h2>
              <p>Los cristales seleccionados requieren una receta confirmada antes de continuar al pago.</p>
            </div>
            {prescriptionReady && <span className="status-chip">Receta lista</span>}
          </div>

          <>
            <div className="mode-toggle"><button className={prescriptionMode === "IMAGE" ? "active" : ""} onClick={() => setPrescriptionMode("IMAGE")} type="button">Adjuntar imagen</button><button className={prescriptionMode === "MANUAL" ? "active" : ""} onClick={() => { setPrescriptionMode("MANUAL"); setPrescriptionDraft(null); }} type="button">Ingresar manualmente</button></div>
            <form className="prescription-form" key={prescriptionDraft ? JSON.stringify(prescriptionDraft) : "sin-borrador"} onSubmit={savePrescription}>
              {prescriptionMode === "IMAGE" && <PrescriptionImageInput disabled={status === "saving"} hasStoredImage={cart.externalPrescription?.hasImage} image={prescriptionImage} onImageChange={handlePrescriptionImageChange} />}
              {prescriptionMode === "IMAGE" && !prescriptionDraft && !cart.externalPrescription?.extractedData && cart.externalPrescription?.hasImage && <button className="button button--secondary field-full" onClick={enableManualImageReview} type="button">Completar valores manualmente</button>}
              {prescriptionMode === "IMAGE" && prescriptionDraft && <div className="inline-success field-full"><strong>Lectura automática: {prescriptionDraft.confidence === "HIGH" ? "confianza alta" : prescriptionDraft.confidence === "MEDIUM" ? "confianza media" : "confianza baja"}.</strong><span> Revisa todos los campos antes de confirmar.</span>{prescriptionDraft.warnings?.length > 0 && <ul>{prescriptionDraft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div>}
              <h3>Ojo derecho</h3><span />
              <label className="field"><span>Esfera</span><input defaultValue={fieldValue(prescriptionDraft?.rightEye?.sphere)} name="rightSphere" required step="0.25" type="number" /></label>
              <label className="field"><span>Cilindro</span><input defaultValue={fieldValue(prescriptionDraft?.rightEye?.cylinder)} name="rightCylinder" required step="0.25" type="number" /></label>
              <label className="field"><span>Eje</span><input defaultValue={fieldValue(prescriptionDraft?.rightEye?.axis)} max="180" min="0" name="rightAxis" type="number" /></label>
              <label className="field"><span>Adición</span><input defaultValue={fieldValue(prescriptionDraft?.rightEye?.addition)} name="rightAddition" step="0.25" type="number" /></label>
              <h3>Ojo izquierdo</h3><span />
              <label className="field"><span>Esfera</span><input defaultValue={fieldValue(prescriptionDraft?.leftEye?.sphere)} name="leftSphere" required step="0.25" type="number" /></label>
              <label className="field"><span>Cilindro</span><input defaultValue={fieldValue(prescriptionDraft?.leftEye?.cylinder)} name="leftCylinder" required step="0.25" type="number" /></label>
              <label className="field"><span>Eje</span><input defaultValue={fieldValue(prescriptionDraft?.leftEye?.axis)} max="180" min="0" name="leftAxis" type="number" /></label>
              <label className="field"><span>Adición</span><input defaultValue={fieldValue(prescriptionDraft?.leftEye?.addition)} name="leftAddition" step="0.25" type="number" /></label>
              <label className="field"><span>Distancia pupilar</span><input defaultValue={fieldValue(prescriptionDraft?.pupillaryDistance)} name="pupillaryDistance" step="0.5" type="number" /></label>
              <label className="field field-wide"><span>Indicaciones</span><input defaultValue={fieldValue(prescriptionDraft?.fulfillmentNotes)} name="fulfillmentNotes" /></label>
              <button className="button button--secondary field-full" disabled={status === "saving"} type="submit">{prescriptionMode === "IMAGE" && (prescriptionDraft ?? cart.externalPrescription?.extractedData) ? "Confirmar valores revisados" : prescriptionMode === "IMAGE" && cart.externalPrescription?.hasImage ? "Leer receta guardada" : prescriptionMode === "IMAGE" ? "Subir y leer receta" : "Guardar receta obligatoria"}</button>
            </form>
          </>
        </article>}

        <article className="cart-card">
          <h2>Datos para la compra</h2>
          <p className="card-lead">Puedes continuar como invitado. Por ahora el flujo se mantiene en retiro en tienda mientras se define el despacho y las tres sucursales.</p>
          <form className="buyer-form" onSubmit={checkout}>
            <label className="field"><span>RUT</span><input defaultValue={cart.buyer?.rut} name="rut" required /></label>
            <label className="field"><span>Nombres</span><input defaultValue={cart.buyer?.firstNames} name="firstNames" required /></label>
            <label className="field"><span>Apellidos</span><input defaultValue={cart.buyer?.lastNames} name="lastNames" required /></label>
            <label className="field"><span>Teléfono</span><input defaultValue={cart.buyer?.phone} name="phone" required /></label>
            <label className="field"><span>Correo</span><input defaultValue={cart.buyer?.email} name="email" required type="email" /></label>
            <label className="field"><span>Dirección de contacto</span><input defaultValue={cart.buyer?.address} name="address" required /></label>
            <div className="pickup-choice field-full"><Icon name="check" /><div><strong>Retiro en tienda</strong><span>Sucursal por confirmar con el local después de la compra.</span></div></div>
            <label className="field field-full"><span>Notas opcionales</span><textarea name="notes" rows="3" /></label>
            <button className="button button--primary field-full" disabled={status === "saving"} type="submit">Continuar a Mercado Pago</button>
          </form>
        </article>
      </section>
      <aside className="cart-card cart-summary"><h2>Resumen</h2><dl><div><dt>Subtotal</dt><dd>{formatClp(cart.subtotalCents)}</dd></div><div><dt>Retiro</dt><dd>Sin costo</dd></div><div><dt>Total</dt><dd>{formatClp(cart.totalCents)}</dd></div></dl><p><Icon name="shield" size={17} /> Pago real procesado por Mercado Pago.</p>{error && <div className="inline-error">{error}</div>}{notice && <div className="inline-success">{notice}</div>}</aside>
    </div>
  </main>;
}
