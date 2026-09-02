"use client";

import { useCallback, useEffect, useState } from "react";

import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import ProductCatalogInterface from "./product-catalog-interface";
import "../management.css";

const CATEGORIES = [
  ["FRAME", "Marco"],
  ["PRESCRIPTION_LENS", "Opción de cristales"],
  ["TREATMENT", "Tratamiento"],
  ["ACCESSORY", "Accesorio"],
  ["OTHER", "Otro"],
];
const EMPTY = {
  category: "FRAME",
  isActive: true,
  name: "",
  requiresPrescription: false,
  sku: "",
  unitPriceCents: "",
};
const money = new Intl.NumberFormat("es-CL", {
  currency: "CLP",
  maximumFractionDigits: 0,
  style: "currency",
});

export default function ProductsPage() {
  const actor = useInternalActor();
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [imageAlt, setImageAlt] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [images, setImages] = useState([]);
  const [imageStatus, setImageStatus] = useState("idle");
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const canManage = actor?.permissions.includes("products.manage");
  const requestProducts = useCallback(
    async (signal) =>
      readResponse(
        await fetch(
          `/api/products?search=${encodeURIComponent(submitted)}&pageSize=100`,
          { cache: "no-store", signal },
        ),
      ),
    [submitted],
  );

  const loadImages = useCallback(async (productId) => {
    try {
      const data = await readResponse(
        await fetch(`/api/products/${productId}/images`, {
          cache: "no-store",
        }),
      );
      setImages(data);
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    }
  }, []);

  useEffect(() => {
    if (!actor?.permissions.includes("products.read")) return;
    const controller = new AbortController();
    requestProducts(controller.signal)
      .then((data) => {
        setItems(data.items);
        setStatus("ready");
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setNotice({ kind: "error", text: error.message });
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [actor, requestProducts]);

  function select(product) {
    setSelectedId(product.id);
    setForm({ ...product, unitPriceCents: String(product.unitPriceCents) });
    setImages([]);
    setImageAlt("");
    setImageFile(null);
    setNotice(null);
    void loadImages(product.id);
  }

  function reset() {
    setSelectedId(null);
    setForm(EMPTY);
    setImages([]);
    setImageAlt("");
    setImageFile(null);
    setNotice(null);
  }

  async function search(event) {
    event.preventDefault();
    const normalized = query.trim();
    setStatus("loading");
    if (normalized !== submitted) {
      setSubmitted(normalized);
      return;
    }
    try {
      const data = await requestProducts();
      setItems(data.items);
      setStatus("ready");
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("error");
    }
  }

  async function submit(event) {
    event.preventDefault();
    setStatus("saving");
    setNotice(null);
    try {
      const saved = await readResponse(
        await fetch(
          selectedId ? `/api/products/${selectedId}` : "/api/products",
          {
            body: JSON.stringify({
              category: form.category,
              ...(selectedId ? { isActive: form.isActive } : {}),
              name: form.name,
              requiresPrescription: form.requiresPrescription,
              sku: form.sku,
              unitPriceCents: Number(form.unitPriceCents),
            }),
            headers: { "Content-Type": "application/json" },
            method: selectedId ? "PATCH" : "POST",
          },
        ),
      );
      setSelectedId(saved.id);
      setForm({ ...saved, unitPriceCents: String(saved.unitPriceCents) });
      void loadImages(saved.id);
      const data = await requestProducts();
      setItems(data.items);
      setStatus("ready");
      setNotice({
        kind: "success",
        text: selectedId
          ? "Producto actualizado y cambio auditado."
          : "Producto creado correctamente.",
      });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("ready");
    }
  }

  async function uploadImage(event) {
    event.preventDefault();
    if (!selectedId || !imageFile) return;
    setImageStatus("uploading");
    setNotice(null);
    const payload = new FormData();
    payload.set("alt", imageAlt);
    payload.set("image", imageFile);
    try {
      const created = await readResponse(
        await fetch(`/api/products/${selectedId}/images`, {
          body: payload,
          method: "POST",
        }),
      );
      setImages((current) => [...current, created]);
      setImageAlt("");
      setImageFile(null);
      setImageStatus("idle");
      setNotice({ kind: "success", text: "Imagen guardada en Cloudinary." });
    } catch (error) {
      setImageStatus("idle");
      setNotice({ kind: "error", text: error.message });
    }
  }

  async function removeImage(imageId) {
    if (!selectedId) return;
    setImageStatus(`removing:${imageId}`);
    setNotice(null);
    try {
      await readResponse(
        await fetch(`/api/products/${selectedId}/images/${imageId}`, {
          method: "DELETE",
        }),
      );
      setImages((current) => current.filter((image) => image.id !== imageId));
      setNotice({ kind: "success", text: "Imagen retirada del catálogo." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setImageStatus("idle");
    }
  }

  if (actor && !actor.permissions.includes("products.read")) {
    return (
      <section className="app-card empty-module">
        <h2>Acceso no disponible</h2>
        <p>No tienes permiso para consultar el catálogo.</p>
      </section>
    );
  }

  return (
    <ProductCatalogInterface
      model={{
        CATEGORIES,
        canManage,
        form,
        imageAlt,
        imageFile,
        imageStatus,
        images,
        items,
        money,
        notice,
        query,
        removeImage,
        reset,
        search,
        select,
        selectedId,
        setForm,
        setImageAlt,
        setImageFile,
        setQuery,
        status,
        submit,
        uploadImage,
      }}
    />
  );
}
