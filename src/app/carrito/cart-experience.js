"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import Icon from "@/components/ui/icon";
import {
  cartHasReadyPrescription,
  cartRequiresPrescription,
  itemRequiresPrescription,
} from "@/utils/prescription-requirement";
import { ensureStoreCart, formatClp, readStoreResponse } from "@/utils/store-client";

import { opticalData, prescriptionFields, readCartDraft, writeCartDraft } from "@/utils/store-cart-draft";

import PrescriptionImageInput from "./prescription-image-input";


const EMPTY_PRESCRIPTION_DRAFT = Object.freeze({
  confidence: "LOW",
  fulfillmentNotes: null,
  leftEye: Object.freeze({ addition: null, axis: null, cylinder: null, sphere: null }),
  pupillaryDistance: null,
  rightEye: Object.freeze({ addition: null, axis: null, cylinder: null, sphere: null }),
  warnings: Object.freeze([]),
});


function mountName(item, items) {
  if (!item.mountFrameProductId) return null;
  return items.find((candidate) => candidate.productId === item.mountFrameProductId)?.name
    ?? "Marco seleccionado";
}

export default function CartExperience() {
  const router = useRouter();
  const [cart, setCart] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prescriptionMode, setPrescriptionMode] = useState("IMAGE");
  const [prescriptionDraft, setPrescriptionDraft] = useState(null);
  const [prescriptionImage, setPrescriptionImage] = useState(null);
  const [fields, setFields] = useState(() => prescriptionFields(null));
  const [prescriptionDirty, setPrescriptionDirty] = useState(false);
  const [buyerDraft, setBuyerDraft] = useState({});
  const prescriptionRequired = useMemo(
    () => cartRequiresPrescription(cart?.items),
    [cart],
  );
  const prescriptionReady = cartHasReadyPrescription(cart, cart?.items);

  useEffect(() => {
    ensureStoreCart()
      .then((data) => {
        setCart(data);
        const draft = readCartDraft(window.sessionStorage, data);
        setPrescriptionMode(draft?.prescriptionMode ?? data.externalPrescription?.source ?? "IMAGE");
        setPrescriptionDraft(data.externalPrescription?.extractedData ?? null);
        setFields(draft?.fields ?? prescriptionFields(data.externalPrescription?.confirmedData ?? data.externalPrescription?.extractedData));
        setPrescriptionDirty(draft?.prescriptionDirty ?? false);
        setBuyerDraft(draft?.buyer ?? { ...data.buyer, notes: data.fulfillment?.notes ?? "" });
        setStatus("ready");
      })
      .catch((requestError) => {
        setError(requestError.message);
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    if (cart) writeCartDraft(window.sessionStorage, cart, { fields, buyer: buyerDraft, prescriptionDirty, prescriptionMode });
  }, [cart, fields, buyerDraft, prescriptionDirty, prescriptionMode]);

  async function update(item, quantity) {
    setError("");
    setStatus("saving");
    try {
      const response = quantity < 1
        ? await fetch(`/api/store/cart/items/${item.productId}`, { method: "DELETE" })
        : await fetch("/api/store/cart/items", {
          body: JSON.stringify({ items: [item, ...(item.category === "FRAME" ? cart.items.filter((line) => line.mountFrameProductId === item.productId) : [])].map((line) => ({ productId: line.productId, mountFrameProductId: line.mountFrameProductId, quantity })) }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
      setCart(await readStoreResponse(response));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setStatus("ready");
    }
  }

  async function readStoredPrescriptionImage() {
    const extraction = await readStoreResponse(await fetch("/api/store/cart/prescription/extract", { method: "POST" }));
    setCart(extraction.cart);
    setPrescriptionDraft(extraction.extraction.data);
    setFields(prescriptionFields(extraction.extraction.data));
    setPrescriptionDirty(true);
    setNotice("Revisa cada valor sugerido antes de confirmar la receta.");
  }

  async function handlePrescriptionImageChange(image) {
    if (!image) { setPrescriptionImage(null); return; }
    setError(""); setNotice("Guardando la imagen…"); setPrescriptionImage(image); setStatus("saving");
    try {
      const upload = new FormData(); upload.set("image", image);
      const uploadedCart = await readStoreResponse(await fetch("/api/store/cart/prescription/image", { body: upload, method: "PUT" }));
      setCart(uploadedCart); setPrescriptionImage(null); setPrescriptionDraft(null);
      setFields(prescriptionFields(null)); setPrescriptionDirty(true);
      setNotice("Imagen guardada de forma privada. Leyendo los valores…");
      try { await readStoredPrescriptionImage(); }
      catch (requestError) {
        setNotice("La imagen está guardada. Puedes completar y confirmar sus valores manualmente.");
        setError(requestError.message);
      }
    } catch (requestError) { setNotice(""); setError(requestError.message); }
    finally { setStatus("ready"); }
  }

  async function savePrescription(event) {
    event.preventDefault(); setError(""); setNotice(""); setStatus("saving");
    const form = new FormData(event.currentTarget);
    try {
      const imageMode = prescriptionMode === "IMAGE";
      if (imageMode && !cart.externalPrescription?.hasImage) throw new Error("Primero adjunta la imagen de tu receta.");
      const saved = await readStoreResponse(await fetch(imageMode ? "/api/store/cart/prescription/confirm" : "/api/store/cart/prescription/manual", {
        body: JSON.stringify(opticalData(form)), headers: { "Content-Type": "application/json" }, method: imageMode ? "PATCH" : "PUT",
      }));
      setCart(saved); setFields(prescriptionFields(saved.externalPrescription.confirmedData));
      setPrescriptionDraft(null); setPrescriptionDirty(false);
      setNotice("Receta guardada. Sus valores se revisarán al preparar el lente.");
    } catch (requestError) { setError(requestError.message); }
    finally { setStatus("ready"); }
  }

  async function retryPrescriptionReading() {
    setStatus("saving"); setError("");
    try { await readStoredPrescriptionImage(); }
    catch (requestError) { setError(requestError.message); }
    finally { setStatus("ready"); }
  }

  function enableManualImageReview() {
    setError("");
    setNotice("Completa y confirma los valores manualmente. La imagen se conservará como respaldo privado.");
    setPrescriptionDraft(EMPTY_PRESCRIPTION_DRAFT);
    setPrescriptionDirty(true);
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
      else router.push(`/checkout/mercado-pago/pending?orderId=${result.order.id}`);
    } catch (requestError) {
      setError(requestError.message);
      // El checkout puede haber confirmado el pedido antes de fallar la conexión.
      try {
        const current = await readStoreResponse(await fetch("/api/store/cart", { cache: "no-store" }));
        setCart(current);
      } catch { /* Mantener el error original y permitir reintentar. */ }
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
    return <main className="cart-page"><header><p className="eyebrow">Compra en línea</p><h1>Tu pedido ya fue creado</h1><p>Este carrito quedó cerrado para impedir cobros o pedidos duplicados.</p></header><div className="cart-empty"><Icon name="receipt" size={42} /><h2>Pedido en proceso</h2><p>Consulta el estado confirmado de forma segura por Mercado Pago. Si el pago falló, podrás reintentarlo desde esa pantalla.</p><div className="result-actions"><Link className="button button--primary" href={`/checkout/mercado-pago/pending?orderId=${cart.saleId}`}>Ver estado del pago</Link><Link className="button button--secondary" href="/tienda">Volver al catálogo</Link></div></div></main>;
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
          {cart.items.map((item) => <div className="cart-line" key={item.productId}><span className="cart-product-icon"><Icon name={item.category === "FRAME" ? "eye" : "package"} /></span><div><strong>{item.name}</strong>{item.category === "FRAME" && <Link href={`/tienda/${item.productId}?editCart=1`}>Modificar cristales</Link>}<small>{item.sku}{itemRequiresPrescription(item) ? " · Receta obligatoria" : ""}</small>{mountName(item, cart.items) && <small>Para: {mountName(item, cart.items)}</small>}</div><div className="cart-quantity"><button disabled={status === "saving"} onClick={() => update(item, item.quantity - 1)} type="button">−</button><span>{item.quantity}</span><button disabled={status === "saving" || item.quantity >= 100} onClick={() => update(item, item.quantity + 1)} type="button">+</button></div><b>{formatClp(item.lineTotalCents)}</b><button aria-label={`Eliminar ${item.name}`} className="remove-line" disabled={status === "saving"} onClick={() => update(item, 0)} type="button">×</button></div>)}
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
            <div className="mode-toggle"><button className={prescriptionMode === "IMAGE" ? "active" : ""} disabled={status === "saving"} onClick={() => setPrescriptionMode("IMAGE")} type="button">Adjuntar imagen</button><button className={prescriptionMode === "MANUAL" ? "active" : ""} disabled={status === "saving"} onClick={() => setPrescriptionMode("MANUAL")} type="button">Ingresar manualmente</button></div>
            {prescriptionMode === "IMAGE" && <PrescriptionImageInput disabled={status === "saving"} hasStoredImage={cart.externalPrescription?.hasImage} storedImageVersion={cart.externalPrescription?.updatedAt} image={prescriptionImage} onImageChange={handlePrescriptionImageChange} />}
            {prescriptionMode === "IMAGE" && cart.externalPrescription?.hasImage && <div className="mode-toggle"><button disabled={status === "saving"} onClick={retryPrescriptionReading} type="button">Volver a leer imagen</button><button disabled={status === "saving"} onClick={enableManualImageReview} type="button">Completar valores manualmente</button></div>}
            {(prescriptionMode === "MANUAL" || cart.externalPrescription?.hasImage) && <form className="prescription-form" onChange={() => setPrescriptionDirty(true)} onSubmit={savePrescription}>
              {prescriptionMode === "IMAGE" && prescriptionDraft && <div className="inline-success field-full"><strong>Valores sugeridos: revisión obligatoria.</strong>{prescriptionDraft.warnings?.length > 0 && <ul>{prescriptionDraft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div>}
              {[{ prefix: "right", name: "Ojo derecho" }, { prefix: "left", name: "Ojo izquierdo" }].map(({ prefix, name }) => <fieldset className="prescription-eye field-full" key={prefix}><legend>{name}</legend>{[{ key: "Sphere", label: "Esfera", required: true }, { key: "Cylinder", label: "Cilindro", required: true }, { key: "Axis", label: "Eje", required: fields[prefix + "Cylinder"] !== "" && Number(fields[prefix + "Cylinder"]) !== 0 }, { key: "Addition", label: "Adición (si corresponde)" }].map(({ key, label, required }) => <label className="field" key={key}><span>{label}</span><input aria-label={name + " — " + label} max={key === "Axis" ? 180 : undefined} min={key === "Axis" ? 0 : undefined} name={prefix + key} onChange={(event) => setFields((current) => ({ ...current, [prefix + key]: event.target.value }))} required={required} step={key === "Axis" ? "1" : "0.01"} type="number" value={fields[prefix + key]} /></label>)}</fieldset>)}
              <label className="field"><span>Distancia pupilar (opcional)</span><input name="pupillaryDistance" min="0.01" onChange={(event) => setFields((current) => ({ ...current, pupillaryDistance: event.target.value }))} step="0.01" type="number" value={fields.pupillaryDistance} /></label>
              <label className="field field-wide"><span>Indicaciones</span><input name="fulfillmentNotes" maxLength={1000} onChange={(event) => setFields((current) => ({ ...current, fulfillmentNotes: event.target.value }))} placeholder="Ej: Tratamiento antirreflejo" value={fields.fulfillmentNotes} /></label>
              <button className="button button--secondary field-full" disabled={status === "saving"} type="submit">{prescriptionMode === "IMAGE" ? "Confirmar valores revisados" : "Guardar receta obligatoria"}</button>
            </form>}
            {error && <p className="inline-error" role="alert">{error}</p>}
            {notice && <p className="inline-success" role="status">{notice}</p>}
          </>
        </article>}

        <article className="cart-card">
          <h2>Datos para la compra</h2>
          <p className="card-lead">Puedes continuar como invitado. Las compras online se preparan para retiro en tienda.</p>
          <form className="buyer-form" onChange={(event) => setBuyerDraft(Object.fromEntries(new FormData(event.currentTarget)))} onSubmit={checkout}>
            <label className="field"><span>RUT</span><input defaultValue={buyerDraft.rut ?? ""} name="rut" placeholder="12.345.678-5" required /></label>
            <label className="field"><span>Nombres</span><input defaultValue={buyerDraft.firstNames ?? ""} name="firstNames" placeholder="Nombres" required /></label>
            <label className="field"><span>Apellidos</span><input defaultValue={buyerDraft.lastNames ?? ""} name="lastNames" placeholder="Apellidos" required /></label>
            <label className="field"><span>Teléfono</span><input defaultValue={buyerDraft.phone ?? ""} name="phone" placeholder="+56 9 1234 5678" required /></label>
            <label className="field"><span>Correo</span><input defaultValue={buyerDraft.email ?? ""} name="email" placeholder="nombre@correo.cl" required type="email" /></label>
            <label className="field"><span>Dirección de contacto</span><input defaultValue={buyerDraft.address ?? ""} name="address" placeholder="Dirección" required /></label>
            <div className="pickup-choice field-full"><Icon name="check" /><div><strong>Retiro en tienda</strong><span>Sucursal por confirmar con el local después de la compra.</span></div></div>
            <label className="field field-full"><span>Notas opcionales</span><textarea defaultValue={buyerDraft.notes ?? ""} name="notes" placeholder="Ej: Entregar en horario de oficina" rows="3" /></label>
            <button className="button button--primary field-full" disabled={status === "saving" || (prescriptionRequired && (!prescriptionReady || prescriptionDirty))} type="submit">Continuar a Mercado Pago</button>{prescriptionRequired && (!prescriptionReady || prescriptionDirty) && <p className="field-full">Guarda y confirma la receta antes de continuar.</p>}
          </form>
        </article>
      </section>
      <aside className="cart-card cart-summary"><h2>Resumen</h2><dl><div><dt>Subtotal</dt><dd>{formatClp(cart.subtotalCents)}</dd></div><div><dt>Retiro</dt><dd>Sin costo</dd></div><div><dt>Total</dt><dd>{formatClp(cart.totalCents)}</dd></div></dl><p><Icon name="shield" size={17} /> Pago real procesado por Mercado Pago.</p>{error && <div className="inline-error">{error}</div>}{notice && <div className="inline-success">{notice}</div>}</aside>
    </div>
  </main>;
}
