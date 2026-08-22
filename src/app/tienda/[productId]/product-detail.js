"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { ensureStoreCart, formatClp, readStoreResponse } from "@/utils/store-client";

const categories = { ACCESSORY: "Accesorio", FRAME: "Marco", OTHER: "Producto", PRESCRIPTION_LENS: "Cristal óptico", TREATMENT: "Tratamiento" };

function ProductArt({ category, small = false }) {
  return <div className={`${category === "FRAME" ? "detail-frame" : "detail-category"} ${small ? "detail-art--small" : ""}`}>{category === "FRAME" ? <><span /><i /><span /></> : <Icon name={category === "ACCESSORY" ? "sparkle" : "eye"} size={small ? 32 : 64} />}</div>;
}

function ProductImage({ image, priority = false, thumbnail = false }) {
  return <Image alt={image.alt} className={`detail-photo${thumbnail ? " detail-thumbnail-photo" : ""}`} fill priority={priority} sizes="(max-width: 960px) 100vw, 55vw" src={image.url} />;
}

export default function ProductDetail({ productId }) {
  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  const [includePrescriptionLenses, setIncludePrescriptionLenses] = useState(false);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await readStoreResponse(await fetch(`/api/store/products/${productId}`, { signal: controller.signal }));
        setProduct(data);
        setSelectedImage(0);
        setIncludePrescriptionLenses(false);
        const result = await readStoreResponse(await fetch(`/api/store/products?category=${data.category}&page=1&pageSize=4`, { signal: controller.signal }));
        setRelated(result.items.filter((item) => item.id !== data.id).slice(0, 3));
        setStatus("ready");
      } catch (error) { if (error.name !== "AbortError") { setMessage(error.message); setStatus("error"); } }
    }
    void load();
    return () => controller.abort();
  }, [productId]);

  async function addToCart() {
    setStatus("adding"); setMessage("");
    try {
      const cart = await ensureStoreCart();
      const current = cart.items.find((item) => item.productId === product.id)?.quantity ?? 0;
      await readStoreResponse(await fetch(`/api/store/cart/items/${product.id}`, { body: JSON.stringify({ quantity: current + quantity }), headers: { "Content-Type": "application/json" }, method: "PUT" }));
      setMessage(includePrescriptionLenses ? "Producto agregado. En el carrito podrás adjuntar tu receta para solicitar cristales ópticos." : "Producto agregado. Tu carrito quedó guardado en este dispositivo."); setStatus("ready");
    } catch (error) { setMessage(error.message); setStatus("ready"); }
  }

  if (status === "loading") return <main className="detail-page"><div className="detail-loading" aria-label="Cargando producto" /></main>;
  if (status === "error") return <main className="detail-page"><div className="detail-state"><h1>No pudimos abrir este producto</h1><p>{message}</p><Link className="button button--primary" href="/tienda">Volver al catálogo</Link></div></main>;

  const images = product.images ?? [];
  const activeImage = images[selectedImage] ?? null;
  const supportsPrescriptionLenses = !product.requiresPrescription && ["FRAME", "PRESCRIPTION_LENS"].includes(product.category);

  return <main className="detail-page">
    <nav className="breadcrumbs" aria-label="Migas de pan"><Link href="/">Inicio</Link><span>/</span><Link href="/tienda">Catálogo</Link><span>/</span><span>{product.name}</span></nav>
    <div className="detail-grid">
      <section className="detail-gallery" aria-label={`Galería de ${product.name}`}>
        <div className="detail-visual"><span className="detail-published">Producto publicado</span>{activeImage ? <ProductImage image={activeImage} priority /> : <ProductArt category={product.category} />}{product.category === "FRAME" && <Link className="try-link" href="/virtual-try-on/3d"><Icon name="eye" /> Probar este marco en 3D</Link>}</div>
        <div className="detail-thumbnails">{images.length > 0 ? images.map((image, index) => <button aria-label={`Mostrar ${image.alt}`} aria-pressed={index === selectedImage} key={image.url} onClick={() => setSelectedImage(index)} type="button"><ProductImage image={image} thumbnail /></button>) : ["Vista principal", "Vista lateral", "Detalle"].map((label, index) => <button aria-label={label} aria-pressed={index === 0} key={label} type="button"><ProductArt category={product.category} small /></button>)}</div>
      </section>

      <section className="detail-copy">
        <p className="eyebrow">{categories[product.category]}</p><h1>{product.name}</h1><div className="detail-meta"><span>Código {product.sku}</span><span className={product.availability?.available ? "detail-available" : "detail-consult"}>{product.availability?.available ? "Disponible" : "Consultar disponibilidad"}</span></div><strong className="detail-price">{formatClp(product.unitPriceCents)}</strong>{product.description && <p className="detail-description">{product.description}</p>}{product.specifications?.length > 0 && <dl className="detail-specifications">{product.specifications.map((specification) => <div key={specification.label}><dt>{specification.label}</dt><dd>{specification.value}</dd></div>)}</dl>}
        <div className="detail-divider" />
        <div className="detail-choice"><div><span>Paso 1</span><h2>Elige la cantidad</h2></div><div className="quantity"><button aria-label="Disminuir cantidad" disabled={quantity === 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))} type="button">−</button><strong>{quantity}</strong><button aria-label="Aumentar cantidad" onClick={() => setQuantity((value) => Math.min(99, value + 1))} type="button">+</button></div></div>
        <div className="detail-choice detail-prescription-choice"><div><span>Paso 2</span>{product.requiresPrescription ? <><h2>Prepara tu receta</h2><p>Podrás adjuntar una receta externa o ingresar sus valores durante el checkout. Los datos deben confirmarse antes de pagar.</p></> : supportsPrescriptionLenses ? <><h2>¿Necesitas cristales con receta?</h2><p>Este producto puede comprarse sin receta. Si quieres cristales ópticos, podrás subirla o ingresar sus valores en el carrito.</p><label className="lens-intent"><input checked={includePrescriptionLenses} onChange={(event) => setIncludePrescriptionLenses(event.target.checked)} type="checkbox" /><span><strong>Agregar cristales con receta</strong><small>La receta se adjunta después de agregar el producto.</small></span></label></> : <><h2>Este producto no requiere receta</h2><p>Puedes agregarlo directamente al carrito y continuar como invitado o con tu cuenta.</p></>}</div><Icon name={product.requiresPrescription || includePrescriptionLenses ? "file" : "check"} /></div>
        <div className="detail-actions"><button className="button button--primary" disabled={status === "adding"} onClick={addToCart} type="button"><Icon name="cart" />{status === "adding" ? "Agregando…" : "Agregar al carrito"}</button>{product.category === "FRAME" && <Link className="button button--secondary" href="/virtual-try-on/3d"><Icon name="eye" /> Probar en 3D</Link>}</div>
        {message && <p className="detail-message" role="status">{message} <Link href="/carrito">Ver carrito</Link></p>}
        <div className="detail-assurances"><span><Icon name="shield" /> Pago con Mercado Pago</span><span><Icon name="package" /> Retiro en tienda disponible</span></div>
      </section>
    </div>

    {related.length > 0 && <section className="related"><div><p className="eyebrow">También te puede gustar</p><h2>Más productos publicados</h2></div><div className="related-grid">{related.map((item) => <article key={item.id}><Link className="related-art" href={`/tienda/${item.id}`}>{item.images?.[0] ? <ProductImage image={item.images[0]} /> : <ProductArt category={item.category} small />}</Link><p>{categories[item.category]}</p><h3><Link href={`/tienda/${item.id}`}>{item.name}</Link></h3><strong>{formatClp(item.unitPriceCents)}</strong></article>)}</div></section>}
  </main>;
}
