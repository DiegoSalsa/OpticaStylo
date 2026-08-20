"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import styles from "./featured-products.module.css";

const categoryNames = { ACCESSORY: "Accesorio", FRAME: "Marco", OTHER: "Producto", PRESCRIPTION_LENS: "Cristal óptico", TREATMENT: "Tratamiento" };

function formatPrice(value) {
  return new Intl.NumberFormat("es-CL", { currency: "CLP", maximumFractionDigits: 0, style: "currency" }).format(value);
}

export default function FeaturedProducts() {
  const [state, setState] = useState({ items: [], status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/store/products?page=1&pageSize=4", { signal: controller.signal })
      .then((response) => response.json())
      .then((payload) => {
        if (!payload.success) throw new Error("CATALOG_UNAVAILABLE");
        setState({ items: payload.data.items, status: "ready" });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setState({ items: [], status: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.status === "loading") return <div className={styles.grid} aria-label="Cargando productos">{Array.from({ length: 4 }, (_, index) => <div className={styles.skeleton} key={index} />)}</div>;

  if (state.status === "error" || state.items.length === 0) {
    return <div className={styles.empty}><Icon name="package" size={25} /><div><strong>Catálogo en preparación</strong><p>Los productos aparecerán aquí cuando estén publicados en el catálogo real.</p></div><Link href="/tienda">Revisar tienda <Icon name="arrow" size={17} /></Link></div>;
  }

  return <div className={styles.grid}>{state.items.map((product) => <article className={styles.card} key={product.id}>
    <Link className={styles.visual} href={`/tienda/${product.id}`} aria-label={`Ver ${product.name}`}>
      <span className={`${styles.productArt} ${product.category === "FRAME" ? styles.frameArt : styles.otherArt}`} aria-hidden="true">{product.category === "FRAME" ? <><i /><b /><i /></> : <Icon name={product.category === "ACCESSORY" ? "sparkle" : "eye"} size={40} />}</span>
      {product.category === "FRAME" && <span className={styles.badge}><Icon name="eye" size={14} /> Prueba virtual</span>}
    </Link>
    <div className={styles.body}><p>{categoryNames[product.category] || "Producto"}</p><h3><Link href={`/tienda/${product.id}`}>{product.name}</Link></h3><div><strong>{formatPrice(product.unitPriceCents)}</strong><Link aria-label={`Ver detalle de ${product.name}`} href={`/tienda/${product.id}`}><Icon name="arrow" size={18} /></Link></div></div>
  </article>)}</div>;
}
