"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";
import { buildPosPaymentInput } from "@/utils/pos-payment";
import CashRegisterPanel from "./cash-register-panel";
import DiscountAuthorizationPanel from "./discount-authorization-panel";

const money = new Intl.NumberFormat("es-CL", {
  currency: "CLP",
  maximumFractionDigits: 0,
  style: "currency",
});
const PAYMENT_METHODS = [
  ["CASH", "Efectivo"],
  ["BANK_TRANSFER", "Transferencia"],
  ["TRANSBANK", "Transbank"],
  ["GETNET", "Getnet"],
];
const EMPTY_EYE = { addition: "", axis: "", cylinder: "0", sphere: "0" };
const EMPTY_EXTERNAL_PRESCRIPTION = {
  fulfillmentNotes: "",
  leftEye: { ...EMPTY_EYE },
  pupillaryDistance: "",
  rightEye: { ...EMPTY_EYE },
};
const ADULT_BIRTH_DATE_CUTOFF = (() => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().slice(0, 10);
})();

function externalPrescriptionData(value) {
  const eye = (side) => ({
    addition: value[side].addition === "" ? null : Number(value[side].addition),
    axis: value[side].axis === "" ? null : Number(value[side].axis),
    cylinder: Number(value[side].cylinder),
    sphere: Number(value[side].sphere),
  });
  return {
    fulfillmentNotes: value.fulfillmentNotes || null,
    leftEye: eye("leftEye"),
    pupillaryDistance:
      value.pupillaryDistance === "" ? null : Number(value.pupillaryDistance),
    rightEye: eye("rightEye"),
  };
}

function customerDetails(value) {
  return [value.rut, value.email].filter(Boolean).join(" · ")
    || "Datos de contacto pendientes";
}

function lensMountLabel(line, lines) {
  if (!line.mount) return null;
  if (line.mount.source === "CUSTOMER_FRAME") return "Montura del cliente";
  return lines.find((item) => item.id === line.mount.frameProductId)?.name
    ?? "Montura vendida";
}

function useSearch(endpoint, search, extraParams = "") {
  const [state, setState] = useState({ error: "", items: [], loading: true });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((value) => ({ ...value, error: "", loading: true }));
      const query = new URLSearchParams(extraParams);
      query.set("pageSize", "12");
      query.set("search", search);
      fetch(`${endpoint}?${query}`, {
        signal: controller.signal,
      })
        .then(readResponse)
        .then((data) =>
          setState({ error: "", items: data.items, loading: false }),
        )
        .catch((error) => {
          if (error.name !== "AbortError")
            setState({ error: error.message, items: [], loading: false });
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, extraParams, search]);
  return state;
}

export default function PosExperience() {
  const actor = useInternalActor();
  const [customerSearch, setCustomerSearch] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const customers = useSearch("/api/customers", customerSearch);
  const patients = useSearch("/api/patients", patientSearch);
  const products = useSearch(
    "/api/products",
    productSearch,
    "excludeCategory=PRESCRIPTION_LENS",
  );
  const lensOptions = useSearch(
    "/api/products",
    "",
    "category=PRESCRIPTION_LENS",
  );
  const [customer, setCustomer] = useState(null);
  const [patient, setPatient] = useState(null);
  const [lines, setLines] = useState([]);
  const [selectedLensId, setSelectedLensId] = useState("");
  const [selectedLensMountId, setSelectedLensMountId] = useState("");
  const [opticalAdditions, setOpticalAdditions] = useState([]);
  const [discountCents, setDiscountCents] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [discountAuthorization, setDiscountAuthorization] = useState(null);
  const [prescriptionId, setPrescriptionId] = useState("");
  const [internalPrescriptions, setInternalPrescriptions] = useState([]);
  const [prescriptionLookup, setPrescriptionLookup] = useState({ error: "", loading: false });
  const [attachPrescription, setAttachPrescription] = useState(false);
  const [prescriptionMode, setPrescriptionMode] = useState("internal");
  const [externalPrescription, setExternalPrescription] = useState(
    EMPTY_EXTERNAL_PRESCRIPTION,
  );
  const [prescriptionFile, setPrescriptionFile] = useState(null);
  const [sale, setSale] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);
  const [newPatient, setNewPatient] = useState(false);
  const [patientBirthDate, setPatientBirthDate] = useState("");
  const [quotations, setQuotations] = useState([]);
  const [showQuotations, setShowQuotations] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [cashRegister, setCashRegister] = useState(null);
  const [cashReceivedCents, setCashReceivedCents] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [externalPrescriptionId, setExternalPrescriptionId] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("");
  const scannerRef = useRef(null);
  const requestKeys = useRef({ payment: null, sale: null });

  const subtotal = useMemo(
    () =>
      [...lines, ...opticalAdditions].reduce(
        (sum, line) => sum + line.unitPriceCents * line.quantity,
        0,
      ),
    [lines, opticalAdditions],
  );
  const total = Math.max(0, subtotal - Number(discountCents || 0));
  const offersPrescriptionAttachment = lines.some((line) => line.requiresPrescription);
  const soldFrames = lines.filter((line) => line.category === "FRAME");
  const selectedLens = lensOptions.items.find((item) => item.id === selectedLensId);
  const canSell = actor?.permissions.includes("sales.create");
  const canEdit = !sale || sale.status === "QUOTATION";
  const checkoutBlockedReason = !canSell
    ? "Tu cuenta no tiene permiso para registrar ventas."
    : !lines.length
      ? "Agrega al menos un producto para continuar al cobro."
      : total <= 0
        ? "El total debe ser mayor que cero para continuar al cobro."
        : attachPrescription && !patient
          ? "Selecciona un paciente solo porque decidiste adjuntar una receta."
          : attachPrescription && prescriptionMode === "external" && !customer
            ? "Para adjuntar una receta externa, selecciona o registra un cliente."
            : attachPrescription && prescriptionMode === "internal" && !prescriptionId
              ? "Selecciona la receta interna que decidiste adjuntar."
              : Number(discountCents) > 0 && (!discountReason.trim() || !discountAuthorization)
                ? "Indica el motivo y la autorización temporal para aplicar el descuento."
                : "";
  const draftIncomplete = !lines.length
    || total <= 0
    || (attachPrescription && !patient)
    || (attachPrescription && prescriptionMode === "external" && !customer)
    || (attachPrescription && prescriptionMode === "internal" && !prescriptionId)
    || (Number(discountCents) > 0 && (!discountReason.trim() || !discountAuthorization));

  useEffect(() => {
    if (!sale || sale.status === "QUOTATION") scannerRef.current?.focus();
  }, [sale]);

  useEffect(() => {
    if (
      !offersPrescriptionAttachment
      || !attachPrescription
      || prescriptionMode !== "internal"
      || !patient?.id
    ) {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/prescriptions?patientId=${patient.id}`, { cache: "no-store", signal: controller.signal })
      .then(readResponse)
      .then((items) => { setInternalPrescriptions(items); setPrescriptionLookup({ error: "", loading: false }); })
      .catch((requestError) => { if (requestError.name !== "AbortError") setPrescriptionLookup({ error: requestError.message, loading: false }); });
    return () => controller.abort();
  }, [attachPrescription, offersPrescriptionAttachment, patient, prescriptionMode]);

  function chooseCustomer(value) {
    setCustomer(value);
    choosePatient(null);
    setExternalPrescriptionId(null);
    if (value?.patientId) {
      fetch(`/api/patients/${value.patientId}`, { cache: "no-store" })
        .then(readResponse)
        .then(choosePatient)
        .catch(() => {});
    }
  }

  function choosePatient(value) {
    setPatient(value);
    setPrescriptionId("");
    setInternalPrescriptions([]);
    setPrescriptionLookup({ error: "", loading: false });
    setExternalPrescriptionId(null);
  }

  function addLine(product, mount = null) {
    if (!canEdit) return false;
    const existing = lines.find((line) => line.id === product.id);
    if (
      existing
      && mount
      && (
        existing.mount?.source !== mount.source
        || existing.mount?.frameProductId !== mount.frameProductId
      )
    ) {
      setError("Este tipo de cristal ya está configurado con otra montura en el ticket.");
      return false;
    }
    setNotice("");
    setLines((current) => {
      const found = current.find((line) => line.id === product.id);
      return found
        ? current.map((line) =>
            line.id === product.id
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          )
        : [...current, { ...product, mount, quantity: 1 }];
    });
    return true;
  }

  function addProduct(product) {
    if (product.category === "PRESCRIPTION_LENS") {
      setSelectedLensId(product.id);
      setError("Selecciona la montura antes de agregar los cristales al ticket.");
      return false;
    }
    const added = addLine(product);
    if (added && product.category === "FRAME") setSelectedLensMountId(product.id);
    return added;
  }

  function addConfiguredLens() {
    if (!selectedLens) {
      setError("Selecciona una opción de cristales antes de agregarla.");
      return;
    }
    const mount = selectedLensMountId
      ? { frameProductId: selectedLensMountId, source: "SOLD_FRAME" }
      : { frameProductId: null, source: "CUSTOMER_FRAME" };
    if (!addLine(selectedLens, mount)) return;
    setSelectedLensId("");
    const mountNotice =
      mount.source === "SOLD_FRAME"
        ? "Cristales vinculados a la montura vendida."
        : "Cristales vinculados a la montura del cliente.";
    setNotice(`${mountNotice} Puedes adjuntar una receta si corresponde.`);
  }

  function quantity(productId, next) {
    const product = lines.find((line) => line.id === productId);
    const attachedLenses = next < 1 && product?.category === "FRAME"
      ? lines.filter((line) => (
        line.mount?.source === "SOLD_FRAME"
        && line.mount.frameProductId === productId
      ))
      : [];
    if (attachedLenses.length) {
      setNotice("También se quitaron los cristales configurados para esa montura.");
    }
    if (next < 1 && selectedLensMountId === productId) {
      setSelectedLensMountId("");
    }
    if (next < 1 && product?.requiresPrescription && product.quantity === 1) {
      setNotice("");
    }
    setLines((current) => next < 1
      ? current.filter((line) => (
        line.id !== productId
        && line.mount?.frameProductId !== productId
      ))
      : current.map((line) => (
        line.id === productId ? { ...line, quantity: next } : line
      )));
  }

  function setExternalEye(side, field, value) {
    setExternalPrescriptionId(null);
    setExternalPrescription((current) => ({
      ...current,
      [side]: { ...current[side], [field]: value },
    }));
  }

  async function createCustomer(event) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const created = await readResponse(
        await fetch("/api/customers", {
          body: JSON.stringify(form),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      chooseCustomer(created);
      setNewCustomer(false);
      setNotice("Cliente creado y seleccionado.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  async function createPatient(event) {
    event.preventDefault();
    setPending(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const minor = values.birthDate > ADULT_BIRTH_DATE_CUTOFF;
    const input = {
      address: values.address,
      birthDate: values.birthDate,
      email: values.email,
      firstNames: values.firstNames,
      guardian: minor
        ? {
            email: values.guardianEmail,
            firstNames: values.guardianFirstNames,
            lastNames: values.guardianLastNames,
            phone: values.guardianPhone,
            relationship: values.guardianRelationship,
            rut: values.guardianRut,
          }
        : null,
      lastNames: values.lastNames,
      phone: values.phone,
      rut: values.rut,
    };
    try {
      const created = await readResponse(
        await fetch("/api/patients", {
          body: JSON.stringify(input),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      choosePatient(created);
      setNewPatient(false);
      setNotice("Paciente registrado y seleccionado sin crear acceso clínico.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  async function loadQuotations() {
    setShowQuotations(true);
    setPending(true);
    setError("");
    try {
      const data = await readResponse(
        await fetch("/api/sales?status=QUOTATION&pageSize=100", {
          cache: "no-store",
        }),
      );
      setQuotations(data.items);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  async function loadQuotation(id) {
    setPending(true);
    setError("");
    try {
      const quote = await readResponse(
        await fetch(`/api/sales/${id}`, { cache: "no-store" }),
      );
      setCustomer(quote.customer);
      choosePatient(quote.patient);
      setLines(
        quote.items.map((item) => ({
          ...item,
          id: item.productId,
        })),
      );
      setSelectedLensId("");
      setSelectedLensMountId(
        quote.items.find((item) => item.category === "FRAME")?.productId ?? "",
      );
      setOpticalAdditions(quote.opticalAdditions ?? []);
      setDiscountCents(quote.discount?.amountCents ?? 0);
      setDiscountReason(quote.discount?.reason ?? "");
      setDiscountAuthorization(null);
      setPrescriptionId(quote.prescription?.id ?? "");
      setPrescriptionMode(quote.externalPrescription ? "external" : "internal");
      setExternalPrescriptionId(quote.externalPrescription?.id ?? null);
      setSale(quote);
      setShowQuotations(false);
      setNotice(
        `Cotización N.º ${quote.saleNumber} cargada. Puedes editarla, cancelarla o confirmarla.`,
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  function createRequestKey() {
    return globalThis.crypto?.randomUUID?.()
      ?? `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function ensureExternalPrescription() {
    if (externalPrescriptionId) return externalPrescriptionId;
    const confirmedData = externalPrescriptionData(externalPrescription);
    let response;
    if (prescriptionFile) {
      const body = new FormData();
      body.set("confirmedData", JSON.stringify(confirmedData));
      body.set("customerId", customer.id);
      body.set("image", prescriptionFile);
      body.set("patientId", patient.id);
      response = await fetch("/api/external-prescriptions", { body, method: "POST" });
    } else {
      response = await fetch("/api/external-prescriptions", {
        body: JSON.stringify({ confirmedData, customerId: customer.id, patientId: patient.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    }
    const created = await readResponse(response);
    setExternalPrescriptionId(created.id);
    return created.id;
  }

  async function buildDraft() {
    const selectedExternalPrescriptionId = attachPrescription && prescriptionMode === "external"
      ? await ensureExternalPrescription()
      : null;
    return {
      customerId: customer?.id ?? null,
      discount: Number(discountCents || 0) > 0
        ? {
            amountCents: Number(discountCents),
            authorizationId: discountAuthorization?.id,
            reason: discountReason,
          }
        : null,
      externalPrescriptionId: selectedExternalPrescriptionId,
      items: lines.map((line) => ({
        mount: line.mount,
        productId: line.id,
        quantity: line.quantity,
      })),
      patientId: patient?.id ?? null,
      prescriptionId: attachPrescription && prescriptionMode === "internal"
        ? prescriptionId || null
        : null,
    };
  }

  async function saveOperation(operation) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const draft = await buildDraft();
      if (sale?.status === "QUOTATION") {
        const updated = await readResponse(await fetch(`/api/sales/${sale.id}`, {
          body: JSON.stringify(draft),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        }));
        if (operation === "SALE") {
          const confirmed = await readResponse(await fetch(`/api/sales/${updated.id}/confirm`, {
            method: "POST",
          }));
          setSale(confirmed);
          setNotice("Cotización actualizada y confirmada para cobro.");
        } else {
          setSale(updated);
          setNotice(`Cotización N.º ${updated.saleNumber} actualizada.`);
        }
      } else {
        requestKeys.current.sale ??= createRequestKey();
        const created = await readResponse(await fetch("/api/sales", {
          body: JSON.stringify({ ...draft, operation }),
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Key": requestKeys.current.sale,
          },
          method: "POST",
        }));
        setSale(created);
        requestKeys.current.sale = null;
        setNotice(operation === "SALE"
          ? `Venta N.º ${created.saleNumber} lista para cobrar.`
          : `Cotización N.º ${created.saleNumber} creada con trazabilidad.`);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  async function registerPayment(event) {
    event.preventDefault();
    const paymentForm = event.currentTarget;
    setPending(true);
    setError("");
    const form = new FormData(paymentForm);
    try {
      const updated = await readResponse(
        await fetch(`/api/sales/${sale.id}/payments`, {
          body: JSON.stringify(buildPosPaymentInput(form, sale.paymentMethod)),
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Key": requestKeys.current.payment ??= createRequestKey(),
          },
          method: "POST",
        }),
      );
      setSale(updated);
      const registeredPayment = updated.payments.at(-1);
      const emailedTo = form.get("email") || customer?.email || null;
      const issuedReceipt = await readResponse(
        await fetch(`/api/sales/${sale.id}/receipt`, {
          body: JSON.stringify({
            email: emailedTo,
            paymentId: registeredPayment.id,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setReceipt(issuedReceipt);
      setSale((current) => current ? {
        ...current,
        receipt: issuedReceipt,
        payments: current.payments.map((payment) => (
          payment.id === registeredPayment.id
            ? { ...payment, receipt: issuedReceipt }
            : payment
        )),
      } : current);
      setNotice(
        updated.status === "PAID"
          ? "Venta pagada y comprobante emitido."
          : `Abono registrado y comprobante emitido. Saldo: ${money.format(updated.balanceCents)}.`,
      );
      requestKeys.current.payment = null;
      paymentForm.reset();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  async function cancelQuotation() {
    if (!sale) return;
    setPending(true);
    setError("");
    try {
      const cancelled = await readResponse(await fetch(`/api/sales/${sale.id}/status`, {
        body: JSON.stringify({ cancellationReason: cancelReason, status: "CANCELLED" }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }));
      setSale(cancelled);
      setNotice(`Cotización N.º ${cancelled.saleNumber} cancelada.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  async function scanSku(event) {
    event.preventDefault();
    const code = scannerRef.current?.value.trim().toUpperCase();
    if (!code || !canEdit) return;
    setError("");
    try {
      const result = await readResponse(await fetch(
        `/api/products?search=${encodeURIComponent(code)}&pageSize=12`,
        { cache: "no-store" },
      ));
      const product = result.items.find((item) => item.isActive && item.sku === code);
      if (!product) {
        setError(`No existe un producto activo con el SKU ${code}.`);
        return;
      }
      if (!addProduct(product)) return;
      scannerRef.current.value = "";
      setNotice(`${product.name} se agregó al ticket.`);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function issueCurrentReceipt() {
    if (!sale) return;
    setPending(true);
    setError("");
    try {
      const issuedReceipt = await readResponse(
        await fetch(`/api/sales/${sale.id}/receipt`, {
          body: JSON.stringify({ email: customer?.email ?? null }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setReceipt(issuedReceipt);
      setNotice("Comprobante emitido para la venta.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setCustomer(null);
    setPatient(null);
    setPatientBirthDate("");
    setLines([]);
    setSelectedLensId("");
    setSelectedLensMountId("");
    setOpticalAdditions([]);
    setDiscountCents(0);
    setDiscountReason("");
    setDiscountAuthorization(null);
    setPrescriptionId("");
    setPrescriptionMode("internal");
    setExternalPrescription(EMPTY_EXTERNAL_PRESCRIPTION);
    setPrescriptionFile(null);
    setSale(null);
    setReceipt(null);
    setCashReceivedCents("");
    setCancelReason("");
    setExternalPrescriptionId(null);
    setPaymentMethod("");
    requestKeys.current = { payment: null, sale: null };
    setNewCustomer(false);
    setNewPatient(false);
    setShowQuotations(false);
    setError("");
    setNotice("");
  }

  return (
    <>
      <header className="app-heading">
        <div>
          <p className="eyebrow">Mostrador</p>
          <h1>Ventas y cotizaciones</h1>
          <p>Venta comercial, clara y sin tareas clínicas o de agenda.</p>
        </div>
        <div className="pos-heading-actions">
          <Link className="app-button app-button--soft" href="/app/reportes">
            <Icon name="chart" size={16} /> Reportes
          </Link>
          <button
            className="app-button app-button--soft"
            disabled={pending}
            onClick={loadQuotations}
            type="button"
          >
            <Icon name="file" size={16} /> Cotizaciones
          </button>
          <button
            className="app-button app-button--primary"
            onClick={reset}
            type="button"
          >
            <Icon name="plus" size={16} /> Nueva venta
          </button>
        </div>
      </header>
      {!canSell && (
        <p className="inline-error">
          Tu cuenta no tiene permiso para registrar ventas.
        </p>
      )}
      {showQuotations && (
        <section className="app-card quotation-panel">
          <div className="quotation-heading">
            <div>
              <p className="eyebrow">Seguimiento comercial</p>
              <h2>Cotizaciones abiertas</h2>
            </div>
            <button
              className="text-button"
              onClick={() => setShowQuotations(false)}
              type="button"
            >
              Cerrar
            </button>
          </div>
          {pending ? (
            <p className="quotation-empty">Cargando cotizaciones…</p>
          ) : quotations.length ? (
            <div className="quotation-list">
              {quotations.map((quotation) => (
                <article key={quotation.id}>
                  <div>
                    <strong>Cotización N.º {quotation.saleNumber}</strong>
                    <small>
                      {quotation.customer
                        ? `${quotation.customer.firstNames} ${quotation.customer.lastNames}`
                        : "Venta de solo marco sin cliente registrado"}
                      {quotation.quotationValidUntil
                        ? ` · válida hasta ${new Date(quotation.quotationValidUntil).toLocaleDateString("es-CL")}`
                        : ""}
                    </small>
                  </div>
                  <b>{money.format(quotation.totalCents)}</b>
                  <button
                    className="app-button app-button--primary"
                    onClick={() => loadQuotation(quotation.id)}
                    type="button"
                  >
                    Cargar para vender
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="quotation-empty">No hay cotizaciones abiertas.</p>
          )}
        </section>
      )}
      {canSell && <CashRegisterPanel onChange={setCashRegister} />}
      <div className="pos-layout">
        <section className="pos-workspace">
          <article className="app-card pos-section">
            <div className="pos-title">
              <span>1</span>
              <div>
                <h2>Cliente opcional</h2>
                <p>Úsalo para historial o contacto; la venta rápida no exige registro.</p>
              </div>
              <button
                className="text-button"
                disabled={!canEdit}
                onClick={() => setNewCustomer((value) => !value)}
                type="button"
              >
                {newCustomer ? "Cerrar" : "+ Crear cliente"}
              </button>
            </div>
            {newCustomer ? (
              <form className="quick-customer" onSubmit={createCustomer}>
                <label className="field">
                  <span>RUT opcional</span>
                  <input name="rut" placeholder="12.345.678-5" />
                </label>
                <label className="field">
                  <span>Nombre</span>
                  <input name="firstNames" placeholder="Nombre completo" required />
                </label>
                <button
                  className="app-button app-button--primary"
                  disabled={pending}
                  type="submit"
                >
                  Crear y seleccionar
                </button>
              </form>
            ) : (
              <>
                {customer && (
                  <div className="selected-customer">
                    <span>
                      <Icon name="check" size={17} />
                    </span>
                    <div>
                      <strong>
                        {customer.firstNames} {customer.lastNames}
                      </strong>
                      <small>{customerDetails(customer)}</small>
                    </div>
                    <button disabled={!canEdit} onClick={() => chooseCustomer(null)} type="button">
                      Cambiar
                    </button>
                  </div>
                )}
                {!customer && (
                  <>
                    <div className="search-field">
                      <Icon name="search" size={18} />
                      <input
                        aria-label="Buscar cliente"
                        onChange={(event) => setCustomerSearch(event.target.value)}
                        placeholder="Buscar por nombre, RUT, correo o teléfono"
                        value={customerSearch}
                      />
                    </div>
                    <div className="result-list">
                      {customers.loading ? (
                        <p>Cargando clientes…</p>
                      ) : customers.error ? (
                        <p className="inline-error">{customers.error}</p>
                      ) : (
                        customers.items.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => chooseCustomer(item)}
                            type="button"
                          >
                            <span>
                              {item.firstNames} {item.lastNames}
                            </span>
                            <small>
                              {customerDetails(item)}
                            </small>
                          </button>
                        ))
                      )}
                    </div>
                    <p className="prescription-hint">
                      Puedes continuar sin seleccionar un cliente.
                    </p>
                  </>
                )}
              </>
            )}
          </article>
          {attachPrescription && offersPrescriptionAttachment && <article className="app-card pos-section">
            <div className="pos-title">
              <span>2</span>
              <div>
                <h2>Paciente</h2>
                <p>Se mantiene separado del cliente y solo se usa para la receta.</p>
              </div>
              <button
                className="text-button"
                disabled={!canEdit}
                onClick={() => setNewPatient((value) => !value)}
                type="button"
              >
                {newPatient ? "Cerrar" : "+ Registrar paciente"}
              </button>
            </div>
            {newPatient ? (
              <form className="quick-patient" onSubmit={createPatient}>
                <label className="field"><span>RUT</span><input name="rut" required /></label>
                <label className="field"><span>Fecha de nacimiento</span><input name="birthDate" onChange={(event) => setPatientBirthDate(event.target.value)} required type="date" value={patientBirthDate} /></label>
                <label className="field"><span>Nombres</span><input name="firstNames" required /></label>
                <label className="field"><span>Apellidos</span><input name="lastNames" required /></label>
                <label className="field"><span>Teléfono</span><input name="phone" required /></label>
                <label className="field"><span>Correo</span><input name="email" required type="email" /></label>
                <label className="field field-wide"><span>Dirección</span><input name="address" required /></label>
                {patientBirthDate && patientBirthDate > ADULT_BIRTH_DATE_CUTOFF && (
                  <fieldset className="pos-guardian-fields">
                    <legend>Responsable del paciente menor de edad</legend>
                    <label className="field"><span>RUT responsable</span><input name="guardianRut" required /></label>
                    <label className="field"><span>Parentesco</span><input name="guardianRelationship" required /></label>
                    <label className="field"><span>Nombres</span><input name="guardianFirstNames" required /></label>
                    <label className="field"><span>Apellidos</span><input name="guardianLastNames" required /></label>
                    <label className="field"><span>Teléfono</span><input name="guardianPhone" required /></label>
                    <label className="field"><span>Correo</span><input name="guardianEmail" required type="email" /></label>
                  </fieldset>
                )}
                <button className="app-button app-button--primary" disabled={pending} type="submit">
                  Registrar y seleccionar
                </button>
              </form>
            ) : (
              <>
                <div className="search-field">
                  <Icon name="search" size={18} />
                  <input
                    aria-label="Buscar paciente"
                    onChange={(event) => setPatientSearch(event.target.value)}
                    placeholder="Buscar paciente por nombre o RUT"
                    value={patientSearch}
                  />
                </div>
                {patient ? (
                  <div className="selected-customer">
                    <span><Icon name="check" size={17} /></span>
                    <div>
                      <strong>{patient.firstNames} {patient.lastNames}</strong>
                      <small>{patient.rut} · paciente de la receta</small>
                    </div>
                    <button disabled={!canEdit} onClick={() => choosePatient(null)} type="button">Cambiar</button>
                  </div>
                ) : (
                  <div className="result-list">
                    {patients.loading ? <p>Cargando pacientes…</p> : patients.error ? <p className="inline-error">{patients.error}</p> : patients.items.map((item) => (
                      <button key={item.id} onClick={() => choosePatient(item)} type="button">
                        <span>{item.firstNames} {item.lastNames}</span>
                        <small>{item.rut} · {item.email}</small>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </article>}
          <article className="app-card pos-section">
            <div className="pos-title">
              <span>{attachPrescription && offersPrescriptionAttachment ? 3 : 2}</span>
              <div>
                <h2>Productos</h2>
                <p>Catálogo rápido con precios controlados. La disponibilidad es simulada hasta integrar inventario.</p>
              </div>
            </div>
            <form className="scanner-field" onSubmit={scanSku}>
              <Icon name="receipt" size={18} />
              <input
                aria-label="Ingresar SKU con escáner"
                placeholder="Escanear SKU y presionar Enter"
                ref={scannerRef}
              />
              <button className="app-button app-button--primary" disabled={!canEdit} type="submit">Agregar</button>
            </form>
            <div className="search-field">
              <Icon name="search" size={18} />
              <input
                aria-label="Buscar productos"
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Buscar marcos, accesorios o SKU"
                value={productSearch}
              />
            </div>
            <div className="product-categories" aria-label="Filtrar catálogo por categoría">
              <button className={activeCategory === "ALL" ? "active" : ""} onClick={() => setActiveCategory("ALL")} type="button">Todo</button>
              {[...new Set(products.items.map((item) => item.category))].map((category) => (
                <button className={activeCategory === category ? "active" : ""} key={category} onClick={() => setActiveCategory(category)} type="button">{category === "FRAME" ? "Marcos" : category === "PRESCRIPTION_LENS" ? "Lentes" : category === "TREATMENT" ? "Tratamientos" : category === "ACCESSORY" ? "Accesorios" : "Otros"}</button>
              ))}
            </div>
            <div className="product-results">
              {products.loading ? (
                <p>Cargando productos…</p>
              ) : products.error ? (
                <p className="inline-error">{products.error}</p>
              ) : (
                products.items
                  .filter((item) => item.isActive
                    && item.category !== "PRESCRIPTION_LENS"
                    && (activeCategory === "ALL" || item.category === activeCategory))
                  .map((item) => (
                    <button
                      disabled={!canEdit}
                      key={item.id}
                      onClick={() => addProduct(item)}
                      type="button"
                    >
                      <span className="product-symbol">
                        <Icon
                          name={item.category === "FRAME" ? "eye" : "package"}
                        />
                      </span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.sku}
                          {item.requiresPrescription
                            ? " · Receta opcional"
                            : ""}
                           {item.availability?.source === "MOCK"
                             ? " · Disponibilidad simulada"
                             : ""}
                          {item.isTestData ? " · Dato de prueba" : ""}
                        </small>
                      </span>
                      <b>{money.format(item.unitPriceCents)}</b>
                      <em>+</em>
                    </button>
                  ))
              )}
            </div>
            <div className="lens-configuration">
              <div>
                <strong>Cristales para una montura</strong>
                <p>Se agregan como opción del marco vendido o de la montura del cliente; no se venden sueltos.</p>
              </div>
              {lensOptions.loading ? (
                <p>Cargando opciones de cristales…</p>
              ) : lensOptions.error ? (
                <p className="inline-error">{lensOptions.error}</p>
              ) : lensOptions.items.length ? (
                <>
                  <label className="field">
                    <span>Opción de cristales</span>
                    <select
                      disabled={!canEdit}
                      onChange={(event) => setSelectedLensId(event.target.value)}
                      value={selectedLensId}
                    >
                      <option value="">Seleccionar opción</option>
                      {lensOptions.items.filter((item) => item.isActive).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {money.format(item.unitPriceCents)}
                          {item.isTestData ? " · Datos de prueba" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Montura para los cristales</span>
                    <select
                      disabled={!canEdit}
                      onChange={(event) => setSelectedLensMountId(event.target.value)}
                      value={selectedLensMountId}
                    >
                      <option value="">Montura del cliente</option>
                      {soldFrames.map((frame) => (
                        <option key={frame.id} value={frame.id}>
                          Montura vendida: {frame.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="lens-configuration-actions">
                    <button
                      className="app-button app-button--primary"
                      disabled={!canEdit}
                      onClick={addConfiguredLens}
                      type="button"
                    >
                      Agregar cristales
                    </button>
                  </div>
                </>
              ) : (
                <p>No hay opciones de cristales configuradas para esta caja.</p>
              )}
            </div>
          </article>
        </section>
        <aside className="app-card pos-ticket">
          <div className="ticket-head">
            <div>
              <p className="eyebrow">Detalle</p>
              <h2>{sale ? `Venta N.º ${sale.saleNumber}` : "Nueva venta"}</h2>
            </div>
            {sale && <span className="status-chip">{sale.status}</span>}
          </div>
          <div className="ticket-lines">
            {lines.length === 0 ? (
              <div className="ticket-empty">
                <Icon name="receipt" size={32} />
                <p>Agrega productos para comenzar.</p>
              </div>
            ) : (
              lines.map((line) => (
                <div className="ticket-line" key={line.id}>
                  <div>
                    <strong>{line.name}</strong>
                    <small>{money.format(line.unitPriceCents)} c/u</small>
                    {lensMountLabel(line, lines) && (
                      <small className="ticket-line-mount">
                        {lensMountLabel(line, lines)}
                      </small>
                    )}
                  </div>
                  <div className="quantity">
                    <button
                      aria-label={`Quitar ${line.name}`}
                      disabled={!canEdit}
                      onClick={() => quantity(line.id, line.quantity - 1)}
                      type="button"
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      aria-label={`Agregar ${line.name}`}
                      disabled={!canEdit}
                      onClick={() => quantity(line.id, line.quantity + 1)}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                  <b>{money.format(line.unitPriceCents * line.quantity)}</b>
                </div>
              ))
            )}
            {opticalAdditions.map((addition, index) => (
              <div className="ticket-line ticket-line--addition" key={`${addition.name}-${index}`}>
                <div>
                  <strong>{addition.name}</strong>
                  <small>Adicional óptico histórico</small>
                </div>
                <span className="addition-quantity">{addition.quantity}</span>
                <b>{money.format(addition.unitPriceCents * addition.quantity)}</b>
              </div>
            ))}
          </div>
          {!offersPrescriptionAttachment && lines.length > 0 && (
            <p className="prescription-hint">
              La montura se puede vender sola. Puedes adjuntar una receta solo si corresponde.
            </p>
          )}
          {offersPrescriptionAttachment && (
            <div className="prescription-field pos-prescription">
              <div className="prescription-heading">
                <strong>Receta opcional para esta venta</strong>
                <p>La venta puede continuar sin receta. Si la adjuntas, selecciona una interna o ingresa una externa manualmente o con imagen.</p>
              </div>
              <label className="field">
                <span>¿Deseas adjuntar una receta?</span>
                <input
                  checked={attachPrescription}
                  disabled={!canEdit}
                  onChange={(event) => setAttachPrescription(event.target.checked)}
                  type="checkbox"
                />
              </label>
              {attachPrescription && (
                <>
              <label className="field">
                <span>Origen de la receta</span>
                <select
                  disabled={!canEdit}
                  onChange={(event) => {
                    setPrescriptionMode(event.target.value);
                    setExternalPrescriptionId(null);
                  }}
                  value={prescriptionMode}
                >
                  <option value="internal">Emitida en Óptica Stylo</option>
                  <option value="external">Ingresar receta externa</option>
                </select>
              </label>
              {prescriptionMode === "internal" ? (
                <label className="field">
                  <span>Receta interna activa</span>
                  <select
                    disabled={!canEdit}
                    onChange={(event) => setPrescriptionId(event.target.value)}
                    value={prescriptionId}
                  >
                    <option value="">{prescriptionLookup.loading ? "Consultando recetas…" : "Seleccionar receta"}</option>
                    {internalPrescriptions.map((item) => <option key={item.id} value={item.id}>Emitida {new Date(item.issuedAt).toLocaleDateString("es-CL")} · versión {item.version}</option>)}
                  </select>
                  {!patient && <small>Selecciona primero al paciente de la receta.</small>}
                  {patient && !prescriptionLookup.loading && !internalPrescriptions.length && <small>No hay recetas internas activas y finalizadas para este paciente.</small>}
                  {prescriptionLookup.error && <small className="inline-error">{prescriptionLookup.error}</small>}
                </label>
              ) : (
                <>
                  <label className="field">
                    <span>Imagen opcional de respaldo</span>
                    <input
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      disabled={!canEdit}
                      onChange={(event) => {
                        setPrescriptionFile(event.target.files?.[0] ?? null);
                        setExternalPrescriptionId(null);
                      }}
                      type="file"
                    />
                    <small>
                      Se conserva de forma privada. Los valores de abajo deben
                      ser leídos y confirmados por una persona.
                    </small>
                  </label>
                  <div className="pos-eye-grid">
                    <strong />
                    {[
                      ["sphere", "Esfera"],
                      ["cylinder", "Cilindro"],
                      ["axis", "Eje"],
                      ["addition", "Adición"],
                    ].map(([, label]) => (
                      <small key={label}>{label}</small>
                    ))}
                    {[
                      ["rightEye", "OD"],
                      ["leftEye", "OI"],
                    ].map(([side, label]) => (
                      <div key={side} style={{ display: "contents" }}>
                        <strong>{label}</strong>
                        {[
                          ["sphere", false],
                          ["cylinder", false],
                          ["axis", true],
                          ["addition", true],
                        ].map(([field, nullable]) => (
                          <input
                            aria-label={`${label} ${field}`}
                            disabled={!canEdit}
                            key={field}
                            max={field === "axis" ? 180 : undefined}
                            min={field === "axis" ? 0 : undefined}
                            onChange={(event) =>
                              setExternalEye(side, field, event.target.value)
                            }
                            required={!nullable}
                            step={field === "axis" ? 1 : 0.25}
                            type="number"
                            value={externalPrescription[side][field]}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="pos-prescription-extra">
                    <label className="field">
                      <span>Distancia pupilar</span>
                      <input
                        disabled={!canEdit}
                        onChange={(event) => {
                          setExternalPrescriptionId(null);
                          setExternalPrescription({
                            ...externalPrescription,
                            pupillaryDistance: event.target.value,
                          });
                        }}
                        step="0.01"
                        type="number"
                        value={externalPrescription.pupillaryDistance}
                      />
                    </label>
                    <label className="field">
                      <span>Notas de fabricación</span>
                      <input
                        disabled={!canEdit}
                        maxLength="1000"
                        onChange={(event) => {
                          setExternalPrescriptionId(null);
                          setExternalPrescription({
                            ...externalPrescription,
                            fulfillmentNotes: event.target.value,
                          });
                        }}
                        value={externalPrescription.fulfillmentNotes}
                      />
                    </label>
                  </div>
                </>
              )}
                </>
              )}
            </div>
          )}
          <div className="discount-box">
            <label className="field">
              <span>Descuento manual (CLP)</span>
              <input
                disabled={!canEdit}
                min="0"
                onChange={(event) => {
                  setDiscountCents(event.target.value);
                  setDiscountAuthorization(null);
                }}
                type="number"
                value={discountCents}
              />
            </label>
            {Number(discountCents) > 0 && canEdit && (
              <>
                <label className="field">
                  <span>Motivo obligatorio</span>
                  <input
                    maxLength="300"
                    onChange={(event) => {
                      setDiscountReason(event.target.value);
                      setDiscountAuthorization(null);
                    }}
                    placeholder="Ej.: convenio autorizado"
                    value={discountReason}
                  />
                </label>
                {discountAuthorization ? (
                  <p className="inline-success" role="status">Descuento autorizado temporalmente hasta {new Date(discountAuthorization.expiresAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}.</p>
                ) : discountReason.trim() ? (
                  <DiscountAuthorizationPanel
                    amountCents={Number(discountCents)}
                    onAuthorized={setDiscountAuthorization}
                    reason={discountReason}
                  />
                ) : (
                  <small>Indica el motivo antes de solicitar la autorización puntual.</small>
                )}
              </>
            )}
          </div>
          <dl className="ticket-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{money.format(subtotal)}</dd>
            </div>
            {Number(discountCents) > 0 && (
              <div className="discount-row">
                <dt>Descuento</dt>
                <dd>− {money.format(Number(discountCents))}</dd>
              </div>
            )}
            <div>
              <dt>Total</dt>
              <dd>{money.format(total)}</dd>
            </div>
          </dl>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="inline-success" role="status">
              {notice}
            </p>
          )}
          {canEdit && (
            <div className="ticket-operation-actions">
              <button
                className="app-button app-button--primary ticket-action"
                disabled={pending || !canSell || draftIncomplete}
                onClick={() => saveOperation("SALE")}
                type="button"
              >
                <Icon name="check" size={16} /> {sale ? "Confirmar y cobrar" : "Continuar al cobro"}
              </button>
              <button
                className="app-button app-button--soft ticket-action"
                disabled={pending || !canSell || draftIncomplete}
                onClick={() => saveOperation("QUOTATION")}
                type="button"
              >
                <Icon name="file" size={16} /> {sale ? "Guardar cotización" : "Crear cotización"}
              </button>
            </div>
          )}
          {canEdit && checkoutBlockedReason && (
            <p className="prescription-hint">{checkoutBlockedReason}</p>
          )}
          {sale?.status === "QUOTATION" && (
            <div className="quotation-cancel">
              <label className="field"><span>Motivo para cancelar</span><input maxLength="500" onChange={(event) => setCancelReason(event.target.value)} value={cancelReason} /></label>
              <button className="app-button app-button--soft" disabled={pending || !cancelReason.trim()} onClick={cancelQuotation} type="button">Cancelar cotización</button>
            </div>
          )}
          {sale?.payments?.length > 0 && (
            <section className="payment-history" aria-labelledby="payment-history-title">
              <h3 id="payment-history-title">Historial de abonos</h3>
              <ul>
                {sale.payments.map((payment, index) => (
                  <li key={payment.id}>
                    <span>
                      <strong>Abono {index + 1}</strong>
                      <small>{money.format(payment.amountCents)}</small>
                    </span>
                    {payment.receipt ? (
                      <a
                        href={`/api/sales/${sale.id}/receipt/print?receiptId=${payment.receipt.id}`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Comprobante N.º {payment.receipt.receiptNumber}
                      </a>
                    ) : (
                      <small>Comprobante pendiente</small>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sale?.status === "PENDING" && (
            <>
              <form className="payment-form" onSubmit={registerPayment}>
              <h3>Registrar abono manual</h3>
              <label className="field">
                <span>Monto (máx. {money.format(sale.balanceCents)})</span>
                <input
                  defaultValue={sale.balanceCents}
                  max={sale.balanceCents}
                  min="1"
                  name="amountCents"
                  required
                  type="number"
                />
              </label>
              <label className="field">
                <span>Medio único para esta venta</span>
                {sale.paymentMethod ? (
                  <>
                    <input
                      readOnly
                      value={PAYMENT_METHODS.find(([value]) => value === sale.paymentMethod)?.[1]
                        ?? sale.paymentMethod}
                    />
                    <input name="paymentMethod" type="hidden" value={sale.paymentMethod} />
                  </>
                ) : (
                  <select name="paymentMethod" onChange={(event) => setPaymentMethod(event.target.value)} required value={paymentMethod}>
                    <option disabled value="">
                      Seleccionar
                    </option>
                    {PAYMENT_METHODS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              {((sale.paymentMethod ?? paymentMethod) === "CASH") && (
                <label className="field"><span>Monto recibido</span><input min="1" name="cashReceivedCents" onChange={(event) => setCashReceivedCents(event.target.value)} required type="number" value={cashReceivedCents} /><small>Vuelto estimado: {money.format(Math.max(0, Number(cashReceivedCents || 0) - Math.min(Number(cashReceivedCents || 0), sale.balanceCents)))}</small>{!cashRegister && <small className="inline-error">Abre la caja de prueba antes de registrar efectivo.</small>}</label>
              )}
              {(["BANK_TRANSFER", "TRANSBANK", "GETNET"].includes(sale.paymentMethod ?? paymentMethod)) && (
                <label className="field"><span>Referencia o folio obligatorio</span><input maxLength="200" name="reference" required /></label>
              )}
              <label className="field">
                <span>Enviar comprobante a (opcional)</span>
                <input defaultValue={customer?.email ?? ""} name="email" type="email" />
              </label>
              <button
                className="app-button app-button--primary"
                disabled={pending || ((sale.paymentMethod ?? paymentMethod) === "CASH" && !cashRegister)}
                type="submit"
              >
                Registrar abono
              </button>
              </form>
              <section className="mercado-pago-panel" aria-labelledby="mercado-pago-title">
                <div><h3 id="mercado-pago-title">Mercado Pago presencial</h3><p>El checkout web se reserva para la tienda. Este POS habilitará cobro por Point o QR cuando la cuenta comercial y su caja estén vinculadas.</p></div>
                <span className="status-chip status-chip--pending">Pendiente de configuración comercial</span>
              </section>
            </>
          )}
          {receipt && (
            <div className="receipt-result">
              <span className="status-chip">Comprobante N.º {receipt.receiptNumber}</span>
              <small>
                {receipt.type === "PAYMENT" ? "Abono registrado. " : "Pago final registrado. "}
                {receipt.emailStatus === "SENT"
                  ? `Enviado a ${receipt.emailedTo}`
                  : receipt.emailStatus === "SIMULATED"
                    ? "Envío simulado; configura Resend para correo real."
                    : "Comprobante emitido; revisa el estado del correo."}
              </small>
              <a className="app-button app-button--soft" href={`/api/sales/${sale.id}/receipt/print?receiptId=${receipt.id}`} rel="noreferrer" target="_blank">
                <Icon name="receipt" size={16} /> Abrir comprobante
              </a>
            </div>
          )}
          {sale?.status === "PAID" && (
            <div className="completed-actions">{!receipt && <button className="app-button app-button--soft ticket-action" disabled={pending} onClick={issueCurrentReceipt} type="button"><Icon name="receipt" size={16} /> Emitir comprobante</button>}<button className="app-button app-button--primary ticket-action" onClick={reset} type="button">Finalizar y crear otra venta</button></div>
          )}
        </aside>
      </div>
    </>
  );
}
