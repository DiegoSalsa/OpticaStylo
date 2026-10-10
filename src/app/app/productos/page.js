"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import usePaginatedResource from "@/components/internal/use-paginated-resource";
import { createRequestGate } from "@/utils/pagination";
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
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [imageAlt, setImageAlt] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [images, setImages] = useState([]);
  const [imageStatus, setImageStatus] = useState("idle");
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("ready");
  const [notice, setNotice] = useState(null);
  const canManage = actor?.permissions.includes("products.manage");
  const list = usePaginatedResource("/api/products", { enabled: Boolean(actor?.permissions.includes("products.read")) });
  const { items } = list;
  const imageGate = useRef(createRequestGate());
  const saving = useRef(false);
  const imageBusy = useRef(false);
  const [imageError, setImageError] = useState("");
  const [fileRevision, setFileRevision] = useState(0);
  useEffect(() => { const gate = imageGate.current; return () => gate.cancel(); }, []);

  const loadImages = useCallback(async (productId) => {
    const request = imageGate.current.begin();
    setImageStatus("loading");
    setImageError("");
    try {
      const data = await readResponse(await fetch(`/api/products/${productId}/images`, { cache: "no-store", signal: request.signal }));
      if (!request.isCurrent()) return;
      setImages(data);
      setImageStatus("idle");
    } catch (error) {
      if (!request.isCurrent()) return;
      setImageError(error.message);
      setImageStatus("error");
    }
  }, []);

  function select(product) {
    if (saving.current || imageBusy.current) return;
    setSelectedId(product.id);
    setForm({ ...product, unitPriceCents: String(product.unitPriceCents) });
    setImages([]);
    setImageAlt("");
    setImageFile(null);
    setNotice(null);
    void loadImages(product.id);
  }

  function reset() {
    if (saving.current || imageBusy.current) return;
    imageGate.current.cancel();
    setImageStatus("idle");
    setImageError("");
    setSelectedId(null);
    setForm(EMPTY);
    setImages([]);
    setImageAlt("");
    setImageFile(null);
    setNotice(null);
  }

  function search(event) {
    event.preventDefault();
    list.setFilters({ search: query.trim() });
  }

  async function submit(event) {
    event.preventDefault();
    if (!canManage || saving.current) return;
    saving.current = true;
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
      if (!selectedId) void loadImages(saved.id);
      list.reload();
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
    } finally {
      saving.current = false;
    }
  }

  async function uploadImage(event) {
    event.preventDefault();
    if (!canManage || !selectedId || !imageFile || imageBusy.current || imageStatus !== "idle") return;
    imageBusy.current = true;
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
      setFileRevision((value) => value + 1);
      setImageStatus("idle");
      setNotice({ kind: "success", text: "Imagen guardada en Cloudinary." });
    } catch (error) {
      setImageStatus("idle");
      setNotice({ kind: "error", text: error.message });
    } finally {
      imageBusy.current = false;
    }
  }

  // Eliminar o cancelar remove imagen de forma controlada y consistente
  async function removeImage(imageId) {
    if (!canManage || !selectedId || imageBusy.current || imageStatus !== "idle") return;
    imageBusy.current = true;
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
      imageBusy.current = false;
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
        list,
        imageError,
        fileRevision,
        retryImages: () => loadImages(selectedId),
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
