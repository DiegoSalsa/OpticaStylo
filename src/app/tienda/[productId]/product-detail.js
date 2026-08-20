"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Icon from "@/components/ui/icon";
import { ensureStoreCart, formatClp, readStoreResponse } from "@/utils/store-client";

const categories = { ACCESSORY: "Accesorio", FRAME: "Marco", OTHER: "Producto", PRESCRIPTION_LENS: "Cristal óptico", TREATMENT: "Tratamiento" };

export default function ProductDetail({ productId }) {
  const [product, setProduct] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await readStoreResponse(await fetch(`/api/store/products/${productId}`, { signal: controller.signal }));
        setProduct(data); setStatus("ready");
      } catch (error) {
        if (error.name !== "AbortError") { setMessage(error.message); setStatus("error"); }
      }
    }
    void load();
    return () => controller.abort();
  }, [productId]);

  async function addToCart() {
    setStatus("adding"); setMessage("");
    try {
      const cart = await ensureStoreCart();
      const current = cart.items.find((item) => item.productId === product.id)?.quantity ?? 0;
      await readStoreResponse(await fetch(`/api/store/cart/items/${product.id}`, {
        body: JSON.stringify({ quantity: current + 1 }), headers: { "Content-Type": "application/json" }, method: "PUT",
      }));
      setMessage("Producto agregado. Tu carrito queda guardado en este dispositivo."); setStatus("ready");
    } catch (error) { setMessage(error.message); setStatus("ready"); }
  }

  if (status === "loading") return <main className="detail-page"><p>Cargando producto…</p></main>;
  if (status === "error") return <main className="detail-page"><div className="detail-state"><h1>No pudimos abrir este producto</h1><p>{message}</p><Link className="button button--primary" href="/tienda">Volver al catálogo</Link></div></main>;
  return <main className="detail-page">
    <nav className="breadcrumbs"><Link href="/tienda">Tienda</Link><span>/</span><span>{product.name}</span></nav>
    <div className="detail-grid">
      <section className="detail-visual" aria-label={`Representación de ${product.name}`}><div className={product.category === "FRAME" ? "detail-frame" : "detail-category"}>{product.category === "FRAME" ? <><span /><i /><span /></> : <Icon name="package" size={64} />}</div>{product.category === "FRAME" && <Link className="try-link" href="/virtual-try-on/3d"><Icon name="eye" /> Probar en 3D</Link>}</section>
      <section className="detail-copy"><p className="eyebrow">{categories[product.category]}</p><h1>{product.name}</h1><p className="detail-sku">Código {product.sku}</p><strong className="detail-price">{formatClp(product.unitPriceCents)}</strong>
        <div className="detail-notes"><div><Icon name="check" /><p><strong>Producto publicado</strong><span>Disponible para compra en línea.</span></p></div><div><Icon name="shield" /><p><strong>Stock informativo</strong><span>La cantidad exacta se confirmará al conectar el inventario.</span></p></div>{product.requiresPrescription&&<div><Icon name="file" /><p><strong>Requiere receta</strong><span>Puedes adjuntar una receta externa o ingresar sus valores sin atenderte aquí.</span></p></div>}</div>
        <button className="button button--primary detail-action" disabled={status==="adding"} onClick={addToCart} type="button"><Icon name="cart" />{status==="adding"?"Agregando…":"Agregar al carrito"}</button>
        {message&&<p className="detail-message" role="status">{message} <Link href="/carrito">Ver carrito</Link></p>}
      </section>
    </div>
  </main>;
}
