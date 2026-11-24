"use client";

import { useEffect, useState } from "react";
import CartExperience from "@/app/carrito/cart-experience";
import { readPendingClinicalPrescription } from "@/utils/store-cart-draft";
import { ensureStoreCart, readStoreResponse, STORE_CART_CHANGED_EVENT } from "@/utils/store-client";
import { AccountPagination, clinicalRecordsUrl, previewPage, useAccountPage } from "./account-pagination";

export default function AccountCart({ account, clinical, onExpired }) {
  const [cart, setCart] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [previous, setPrevious] = useState([]);
  const [resolved, setResolved] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const enabled = Boolean(clinical?.linked);
  const list = useAccountPage(clinicalRecordsUrl("active-prescriptions"), {
    enabled, onExpired,
    initialPage: enabled ? previewPage(clinical.prescriptions.active, clinical.prescriptions.activePage) : null,
  });

  useEffect(() => {
    let active = true;
    function receive(updated) {
      if (!active || !updated?.id) return;
      setCart(updated);
      setSelectedId(readPendingClinicalPrescription(account.id, updated.id) ?? updated.clinicalPrescriptionId);
    }
    function refresh() {
      ensureStoreCart({ forShopping: true }).then(receive).catch((error) => {
        if (active && error.status === 401) onExpired();
      });
    }
    function onCartChanged(event) {
      if (event.detail?.id) receive(event.detail);
      else refresh();
    }
    refresh();
    window.addEventListener(STORE_CART_CHANGED_EVENT, onCartChanged);
    return () => {
      active = false;
      window.removeEventListener(STORE_CART_CHANGED_EVENT, onCartChanged);
    };
  }, [account.id, onExpired]);

  const current = list.status === "ready" ? list.items : previous;
  const inPage = current.some((item) => item.id === selectedId);
  useEffect(() => {
    if (!selectedId || inPage) return;
    const controller = new AbortController();
    fetch("/api/store/accounts/me/clinical/prescriptions/" + encodeURIComponent(selectedId), { cache: "no-store", signal: controller.signal })
      .then(readStoreResponse)
      .then((record) => { if (!controller.signal.aborted) setResolved({ id: selectedId, record }); })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error.status === 401) onExpired();
        setResolved({ id: selectedId, record: null, error: error.status === 404 ? null : error.message });
      });
    return () => controller.abort();
  }, [attempt, inPage, onExpired, selectedId]);

  function browse(page) {
    if (cart) setSelectedId(readPendingClinicalPrescription(account.id, cart.id) ?? cart.clinicalPrescriptionId);
    setPrevious(current);
    list.setPage(page);
    ensureStoreCart({ forShopping: true }).then((updated) => {
      setCart(updated);
      setSelectedId(readPendingClinicalPrescription(account.id, updated.id) ?? updated.clinicalPrescriptionId);
    }).catch((error) => { if (error.status === 401) onExpired(); });
  }

  // Conservar en el selector la receta vigente elegida desde otra página o desde el perfil de un menor.
  const selection = resolved?.id === selectedId ? resolved : null;
  const pinned = !inPage && (selection ? selection.record : previous.find((item) => item.id === selectedId));

  return <>
    {enabled && (list.totalPages > 1 || list.page > 1 || list.status !== "ready") && (
      <AccountPagination list={{ ...list, setPage: browse }} label="recetas vigentes del carrito" />
    )}
    {!inPage && selection?.error && <p className="inline-error" role="alert">
      {selection.error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>Reintentar receta seleccionada</button>
    </p>}
    <CartExperience accountProfile={account} clinicalPrescriptions={pinned ? [pinned, ...current] : current} />
  </>;
}
