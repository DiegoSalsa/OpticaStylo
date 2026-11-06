"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import Icon from "@/components/ui/icon";
import DeliveryChoice from "@/components/shipping/delivery-choice";
import {
  cartHasReadyPrescription,
  cartRequiresPrescription,
  itemRequiresPrescription,
} from "@/utils/prescription-requirement";
import { ensureStoreCart, formatClp, readStoreResponse, STORE_CART_CHANGED_EVENT } from "@/utils/store-client";

import { opticalData, prescriptionFields, readCartDraft, writeCartDraft } from "@/utils/store-cart-draft";

import PrescriptionImageInput from "./prescription-image-input";
import { MAX_PRESCRIPTION_IMAGE_BYTES, PRESCRIPTION_IMAGE_ACCEPT } from "@/utils/prescription-camera";


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
  const [shipping, setShipping] = useState({ method: "PICKUP", quote: null });
  const cartSignature = JSON.stringify(cart?.items.map((i) => [i.productId, i.quantity, i.unitPriceCents]));
  const selectedQuote = shipping.signature === cartSignature ? shipping.quote : null;
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prescriptionMode, setPrescriptionMode] = useState("IMAGE");
  const [prescriptionDraft, setPrescriptionDraft] = useState(null);
  const [prescriptionImage, setPrescriptionImage] = useState(null);
  const [fields, setFields] = useState(() => prescriptionFields(null));
  const [prescriptionDirty, setPrescriptionDirty] = useState(false);
  const [buyerDraft, setBuyerDraft] = useState({});
  const [lensConfiguration, setLensConfiguration] = useState(null);
  const cartIdRef = useRef(null);
  const refreshRevisionRef = useRef(0);
  const prescriptionRequired = useMemo(
    () => cartRequiresPrescription(cart?.items),
    [cart],
  );
  const prescriptionReady = cartHasReadyPrescription(cart, cart?.items);
  const pickupBranches = (cart?.items[0]?.availability?.branches ?? []).filter((branch) => branch.pickupEnabled).map((branch) => ({ ...branch, available: cart.items.every((item) => {
    const stock = item.availability?.branches.find((option) => option.id === branch.id);
    return stock?.available && (stock.quantity === null || stock.quantity >= item.quantity);
  }) }));

  useEffect(() => {
    let active = true;
    function hydrate(data) {
      if (!active) return;
      if (cartIdRef.current === data.id) {
        setCart(data);
        setStatus("ready");
        return;
      }
      cartIdRef.current = data.id;
      setCart(data);
      const draft = readCartDraft(window.sessionStorage, data);
      setPrescriptionMode(draft?.prescriptionMode ?? data.externalPrescription?.source ?? "IMAGE");
      setPrescriptionDraft(data.externalPrescription?.extractedData ?? null);
      setFields(draft?.fields ?? prescriptionFields(data.externalPrescription?.confirmedData ?? data.externalPrescription?.extractedData));
      setPrescriptionDirty(draft?.prescriptionDirty ?? false);
      setBuyerDraft(draft?.buyer ?? { ...data.buyer, branchId: data.fulfillment?.branchId ?? "", notes: data.fulfillment?.notes ?? "" });
      setStatus("ready");
    }
    function refresh() {
      const revision = ++refreshRevisionRef.current;
      ensureStoreCart().then((data) => {
        if (revision === refreshRevisionRef.current) hydrate(data);
      })
      .catch((requestError) => {
        if (!active || revision !== refreshRevisionRef.current) return;
        setError(requestError.message);
        setStatus("error");
      });
    }
    function changed(event) {
      refreshRevisionRef.current += 1;
      hydrate(event.detail);
    }
    function returned() {
      if (["/carrito", "/checkout"].includes(window.location.pathname)) refresh();
    }
    window.addEventListener(STORE_CART_CHANGED_EVENT, changed);
    window.addEventListener("popstate", returned);
    window.addEventListener("pageshow", returned);
    refresh();
    return () => {
      active = false;
      window.removeEventListener(STORE_CART_CHANGED_EVENT, changed);
      window.removeEventListener("popstate", returned);
      window.removeEventListener("pageshow", returned);
    };
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

  async function chooseFramesOnly() {
    setError(""); setNotice(""); setStatus("saving");
    try {
      let current = cart;
      for (const frame of cart.items.filter((item) => item.category === "FRAME")) {
        current = await readStoreResponse(await fetch("/api/store/cart/items", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ replaceFrameProductId: frame.productId, items: [{ productId: frame.productId, quantity: frame.quantity }] }),
        }));
      }
      setCart(current);
      setLensConfiguration(null);
      setNotice("Compra solo de marcos. Retiramos los cristales y actualizamos el total; no necesitas receta.");
    } catch (requestError) { setError(requestError.message); }
    finally { setStatus("ready"); }
  }

  async function configureLenses(frame) {
    setError(""); setStatus("saving");
    setLensConfiguration({ frame, options: [], selectedId: cart.items.find((item) => item.mountFrameProductId === frame.productId)?.productId ?? "", loading: true });
    try {
      const product = await readStoreResponse(await fetch(`/api/store/products/${frame.productId}`));
      setLensConfiguration({ frame, options: product.lensOptions ?? [], selectedId: cart.items.find((item) => item.mountFrameProductId === frame.productId)?.productId ?? "" });
    } catch (requestError) { setError(requestError.message); setLensConfiguration(null); }
    finally { setStatus("ready"); }
  }

  async function saveLenses(event) {
    event.preventDefault(); setError(""); setStatus("saving");
    try {
      const { frame, selectedId } = lensConfiguration;
      const saved = await readStoreResponse(await fetch("/api/store/cart/items", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replaceFrameProductId: frame.productId, items: [
          { productId: frame.productId, quantity: frame.quantity },
          { productId: selectedId, mountFrameProductId: frame.productId, quantity: frame.quantity },
        ] }),
      }));
      setCart(saved); setLensConfiguration(null);
      setNotice("Cristales guardados. Ahora puedes adjuntar una imagen o ingresar la receta manualmente.");
    } catch (requestError) { setError(requestError.message); }
    finally { setStatus("ready"); }
  }

  async function readStoredPrescriptionImage() {
    const extraction = await readStoreResponse(await fetch("/api/store/cart/prescription/extract", { method: "POST" }));
    setCart(extraction.cart);
    setPrescriptionDraft(extraction.extraction.data);
    setFields(prescriptionFields(extraction.extraction.data));
    setPrescriptionDirty(true);
    setNotice("Revisa cada valor sugerido antes de confirmar la receta.");
  }

  function handlePrescriptionImageChange(image) {
    if (!image) { setPrescriptionImage(null); return; }
    if (!PRESCRIPTION_IMAGE_ACCEPT.split(",").includes(image.type) || image.size < 1 || image.size > MAX_PRESCRIPTION_IMAGE_BYTES) {
      setError("Selecciona una imagen JPEG, PNG, WEBP, HEIC o HEIF de hasta 4 MiB.");
      return;
    }
    setError(""); setNotice("Revisa la imagen y pulsa Guardar imagen para adjuntarla.");
    setPrescriptionImage(image);
  }

  async function uploadPrescriptionImage() {
    const image = prescriptionImage;
    if (!image) return;
    setError(""); setNotice("Guardando la imagen…"); setStatus("saving");
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

  async function removePrescriptionImage() {
    setError(""); setNotice(""); setStatus("saving");
    try {
      setCart(await readStoreResponse(await fetch("/api/store/cart/prescription/image", { method: "DELETE" })));
      setPrescriptionImage(null); setPrescriptionDraft(null); setFields(prescriptionFields(null)); setPrescriptionDirty(false);
      setNotice("Imagen eliminada. Puedes adjuntar otra o ingresar una receta manualmente.");
    } catch (requestError) { setError(requestError.message); }
    finally { setStatus("ready"); }
  }

  async function savePrescription(event) {
    event.preventDefault(); setError(""); setNotice(""); setStatus("saving");
    const form = new FormData(event.currentTarget);
    try {
      const imageMode = prescriptionMode === "IMAGE" || cart.externalPrescription?.hasImage;
      if (imageMode && !cart.externalPrescription?.hasImage) throw new Error("Primero adjunta la imagen de tu receta.");
      const saved = await readStoreResponse(await fetch(imageMode ? "/api/store/cart/prescription/confirm" : "/api/store/cart/prescription/manual", {
        body: JSON.stringify({ ...opticalData(form), imageHash: cart.externalPrescription?.imageHash }), headers: { "Content-Type": "application/json" }, method: imageMode ? "PATCH" : "PUT",
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
      if (prescriptionImage || (prescriptionRequired && (!prescriptionReady || prescriptionDirty))) throw new Error("Guarda y confirma la receta antes de continuar.");
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
          clinicalPrescriptionId: cart.clinicalPrescriptionId,
          fulfillment: shipping.method === "DELIVERY" ? { method: "DELIVERY", quoteId: selectedQuote?.id, notes: form.get("notes") || null } : { method: "PICKUP", branchId: form.get("branchId"), notes: form.get("notes") || null },
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }));
      setCart(configured);
      const result = await readStoreResponse(await fetch("/api/store/cart/checkout", {
        method: "POST",
      }));
      const completedCart = { ...configured, status: "CHECKED_OUT", saleId: result.order.id };
      setCart(completedCart);
      setStatus("ready");
      writeCartDraft(window.sessionStorage, completedCart, {});
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
          {cart.items.map((item) => <div className="cart-line" key={item.productId}><span className="cart-product-icon"><Icon name={item.category === "FRAME" ? "eye" : "package"} /></span><div><strong>{item.name}</strong>{item.category === "FRAME" && <button disabled={status === "saving"} onClick={() => configureLenses(item)} type="button">Modificar cristales</button>}<small>{item.sku}{itemRequiresPrescription(item) ? " · Receta obligatoria" : ""}</small>{mountName(item, cart.items) && <small>Para: {mountName(item, cart.items)}</small>}</div><div className="cart-quantity"><button disabled={status === "saving"} onClick={() => update(item, item.quantity - 1)} type="button">−</button><span>{item.quantity}</span><button disabled={status === "saving" || item.quantity >= 100} onClick={() => update(item, item.quantity + 1)} type="button">+</button></div><b>{formatClp(item.lineTotalCents)}</b><button aria-label={`Eliminar ${item.name}`} className="remove-line" disabled={status === "saving"} onClick={() => update(item, 0)} type="button">×</button></div>)}
        </article>

        {cart.items.some((item) => item.category === "FRAME") && <article className="cart-card">
          <h2>¿Necesitas receta?</h2>
          <fieldset className="lens-options"><legend>Elige cómo comprar tus marcos</legend>
            <label className="lens-option"><input checked={!cart.items.some((item) => item.mountFrameProductId) && !lensConfiguration} disabled={status === "saving"} name="cartPrescriptionChoice" onChange={chooseFramesOnly} type="radio" /><span><strong>No necesito receta — comprar solo el marco</strong><small>Esta opción retira los cristales del carrito. El total se actualiza.</small></span></label>
            <label className="lens-option"><input checked={prescriptionRequired || Boolean(lensConfiguration)} disabled={status === "saving"} name="cartPrescriptionChoice" onChange={() => configureLenses(cart.items.find((item) => item.category === "FRAME"))} type="radio" /><span><strong>Necesito cristales con receta</strong><small>{prescriptionRequired ? "Adjunta tu receta o ingresa sus valores en el bloque siguiente." : "Configura los cristales de tu marco para adjuntar o ingresar una receta."}</small></span></label>
          </fieldset>
          {!prescriptionRequired && cart.items.some((item) => item.mountFrameProductId) && <p className="card-lead">Los cristales seleccionados no requieren receta.</p>}
          {lensConfiguration && <form className="prescription-form" onSubmit={saveLenses}>
            <label className="field field-full"><span>Cristales para {lensConfiguration.frame.name}</span><select disabled={status === "saving"} onChange={(event) => setLensConfiguration((value) => ({ ...value, selectedId: event.target.value }))} required value={lensConfiguration.selectedId}><option value="">Selecciona tus cristales</option>{lensConfiguration.options.map((lens) => <option key={lens.id} value={lens.id}>{lens.name} · {formatClp(lens.unitPriceCents)}{lens.requiresPrescription ? " · Con receta" : " · Sin receta obligatoria"}</option>)}</select></label>
            {lensConfiguration.loading ? <p className="field-full" role="status">Cargando cristales…</p> : lensConfiguration.options.length === 0 && <p className="field-full">No hay cristales publicados para este marco. Puedes comprar solo el marco o consultar al local.</p>}
            <button className="button button--secondary" disabled={status === "saving" || !lensConfiguration.selectedId} type="submit">Guardar cristales</button><button className="button button--secondary" disabled={status === "saving"} onClick={() => setLensConfiguration(null)} type="button">Cancelar</button>
          </form>}
        </article>}

        {prescriptionRequired && <article className="cart-card prescription-card" id="receta">
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
            {prescriptionMode === "IMAGE" && prescriptionImage && <button className="button button--secondary" disabled={status === "saving"} onClick={uploadPrescriptionImage} type="button">Guardar imagen</button>}
            {cart.externalPrescription?.hasImage && <button className="button button--secondary" disabled={status === "saving"} onClick={removePrescriptionImage} type="button">Eliminar imagen guardada</button>}
            {prescriptionMode === "IMAGE" && cart.externalPrescription?.hasImage && <div className="mode-toggle"><button disabled={status === "saving"} onClick={retryPrescriptionReading} type="button">Volver a leer imagen</button><button disabled={status === "saving"} onClick={enableManualImageReview} type="button">Completar valores manualmente</button></div>}
            {(prescriptionMode === "MANUAL" || cart.externalPrescription?.hasImage) && <form className="prescription-form" onChange={() => setPrescriptionDirty(true)} onSubmit={savePrescription}>
              {prescriptionMode === "IMAGE" && prescriptionDraft && <div className="inline-success field-full"><strong>Valores sugeridos: revisión obligatoria.</strong>{prescriptionDraft.warnings?.length > 0 && <ul>{prescriptionDraft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div>}
              {[{ prefix: "right", name: "Ojo derecho" }, { prefix: "left", name: "Ojo izquierdo" }].map(({ prefix, name }) => <fieldset className="prescription-eye field-full" key={prefix}><legend>{name}</legend>{[{ key: "Sphere", label: "Esfera", required: true }, { key: "Cylinder", label: "Cilindro", required: true }, { key: "Axis", label: "Eje", required: fields[prefix + "Cylinder"] !== "" && Number(fields[prefix + "Cylinder"]) !== 0 }, { key: "Addition", label: "Adición (si corresponde)" }].map(({ key, label, required }) => <label className="field" key={key}><span>{label}</span><input aria-label={name + " — " + label} max={key === "Axis" ? 180 : undefined} min={key === "Axis" ? 0 : undefined} name={prefix + key} onChange={(event) => setFields((current) => ({ ...current, [prefix + key]: event.target.value }))} required={required} step={key === "Axis" ? "1" : "0.01"} type="number" value={fields[prefix + key]} /></label>)}</fieldset>)}
              <label className="field"><span>Distancia pupilar (opcional)</span><input name="pupillaryDistance" min="0.01" onChange={(event) => setFields((current) => ({ ...current, pupillaryDistance: event.target.value }))} step="0.01" type="number" value={fields.pupillaryDistance} /></label>
              <label className="field field-wide"><span>Indicaciones</span><input name="fulfillmentNotes" maxLength={1000} onChange={(event) => setFields((current) => ({ ...current, fulfillmentNotes: event.target.value }))} placeholder="Ej: Tratamiento antirreflejo" value={fields.fulfillmentNotes} /></label>
              <button className="button button--secondary field-full" disabled={status === "saving" || Boolean(prescriptionImage)} type="submit">{prescriptionMode === "IMAGE" ? "Confirmar valores revisados" : "Guardar receta obligatoria"}</button>
            </form>}
            {error && <p className="inline-error" role="alert">{error}</p>}
            {notice && <p className="inline-success" role="status">{notice}</p>}
          </>
        </article>}

        <article className="cart-card">
          <h2>Datos para la compra</h2>
          <p className="card-lead">Puedes continuar como invitado. Selecciona retiro o calcula el despacho antes de confirmar.</p>
          <form className="buyer-form" onChange={(event) => setBuyerDraft(Object.fromEntries(new FormData(event.currentTarget)))} onSubmit={checkout}>
            <label className="field"><span>RUT</span><input defaultValue={buyerDraft.rut ?? ""} name="rut" placeholder="12.345.678-5" required /></label>
            <label className="field"><span>Nombres</span><input defaultValue={buyerDraft.firstNames ?? ""} name="firstNames" placeholder="Nombres" required /></label>
            <label className="field"><span>Apellidos</span><input defaultValue={buyerDraft.lastNames ?? ""} name="lastNames" placeholder="Apellidos" required /></label>
            <label className="field"><span>Teléfono</span><input defaultValue={buyerDraft.phone ?? ""} name="phone" placeholder="+56 9 1234 5678" required /></label>
            <label className="field"><span>Correo</span><input defaultValue={buyerDraft.email ?? ""} name="email" placeholder="nombre@correo.cl" required type="email" /></label>
            <label className="field"><span>Dirección de contacto</span><input defaultValue={buyerDraft.address ?? ""} name="address" placeholder="Dirección" required /></label>
            <DeliveryChoice selection={shipping} onChange={setShipping} signature={cartSignature} />
            {shipping.method === "PICKUP" && <><div className="pickup-choice field-full"><Icon name="check" /><div><strong>Retiro en una sucursal</strong><span>Todos los productos deben estar disponibles en el mismo local. La reserva sin pagos dura 30 minutos desde la creación del pedido.</span></div></div>
            <label className="field field-full"><span>Sucursal de retiro</span><select name="branchId" required defaultValue={buyerDraft.branchId ?? ""}><option value="">Selecciona una sucursal</option>{pickupBranches.map((branch) => <option disabled={!branch.available} key={branch.id} value={branch.id}>{branch.name}{branch.available ? " — Disponible" : " — Sin disponibilidad conjunta"}</option>)}</select></label>
            {!pickupBranches.some((branch) => branch.available) && <p className="inline-error field-full" role="alert">Ninguna sucursal tiene todos los productos disponibles. Modifica las cantidades o productos del carrito.</p>}</>}
            <label className="field field-full"><span>Notas opcionales</span><textarea defaultValue={buyerDraft.notes ?? ""} name="notes" placeholder="Ej: Entregar en horario de oficina" rows="3" /></label>
            <button className="button button--primary field-full" disabled={status === "saving" || Boolean(prescriptionImage) || (prescriptionRequired && (!prescriptionReady || prescriptionDirty))} type="submit">Continuar a Mercado Pago</button>{prescriptionRequired && (!prescriptionReady || prescriptionDirty || prescriptionImage) && <p className="field-full">Guarda y confirma la receta antes de continuar.</p>}
          </form>
        </article>
      </section>
      <aside className="cart-card cart-summary"><h2>Resumen</h2><dl><div><dt>Subtotal</dt><dd>{formatClp(cart.subtotalCents)}</dd></div><div><dt>{shipping.method === "DELIVERY" ? "Despacho" : "Retiro"}</dt><dd>{shipping.method === "PICKUP" ? "Sin costo" : selectedQuote ? selectedQuote.customerCharge === 0 ? "Gratis" : formatClp(selectedQuote.customerCharge) : "Pendiente de cotizar"}</dd></div><div><dt>Total</dt><dd>{shipping.method === "DELIVERY" && !selectedQuote ? "Pendiente de cotizar" : formatClp(cart.subtotalCents + (selectedQuote?.customerCharge ?? 0))}</dd></div></dl><p><Icon name="shield" size={17} /> Pago procesado por Mercado Pago cuando esté habilitado.</p>{error && <div className="inline-error">{error}</div>}{notice && <div className="inline-success">{notice}</div>}</aside>
    </div>
  </main>;
}
