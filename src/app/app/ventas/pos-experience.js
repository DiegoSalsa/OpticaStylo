"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";

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
  ["MERCADO_PAGO", "Mercado Pago"],
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

function useSearch(endpoint, search) {
  const [state, setState] = useState({ error: "", items: [], loading: true });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((value) => ({ ...value, error: "", loading: true }));
      fetch(`${endpoint}?search=${encodeURIComponent(search)}&pageSize=12`, {
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
  }, [endpoint, search]);
  return state;
}

export default function PosExperience() {
  const actor = useInternalActor();
  const [customerSearch, setCustomerSearch] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const customers = useSearch("/api/customers", customerSearch);
  const patients = useSearch("/api/patients", patientSearch);
  const products = useSearch("/api/products", productSearch);
  const [customer, setCustomer] = useState(null);
  const [patient, setPatient] = useState(null);
  const [lines, setLines] = useState([]);
  const [opticalAdditions, setOpticalAdditions] = useState([]);
  const [additionDraft, setAdditionDraft] = useState({ name: "", unitPriceCents: "" });
  const [discountCents, setDiscountCents] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [discountAuthorizerEmail, setDiscountAuthorizerEmail] = useState("");
  const [discountAuthorizerPassword, setDiscountAuthorizerPassword] = useState("");
  const [prescriptionId, setPrescriptionId] = useState("");
  const [internalPrescriptions, setInternalPrescriptions] = useState([]);
  const [prescriptionLookup, setPrescriptionLookup] = useState({ error: "", loading: false });
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

  const subtotal = useMemo(
    () =>
      [...lines, ...opticalAdditions].reduce(
        (sum, line) => sum + line.unitPriceCents * line.quantity,
        0,
      ),
    [lines, opticalAdditions],
  );
  const total = Math.max(0, subtotal - Number(discountCents || 0));
  const requiresPrescription = lines.some((line) => line.requiresPrescription);
  const canSell = actor?.permissions.includes("sales.create");

  useEffect(() => {
    if (!patient?.id) return;
    const controller = new AbortController();
    fetch(`/api/prescriptions?patientId=${patient.id}`, { cache: "no-store", signal: controller.signal })
      .then(readResponse)
      .then((items) => { setInternalPrescriptions(items); setPrescriptionLookup({ error: "", loading: false }); })
      .catch((requestError) => { if (requestError.name !== "AbortError") setPrescriptionLookup({ error: requestError.message, loading: false }); });
    return () => controller.abort();
  }, [patient]);

  function chooseCustomer(value) {
    setCustomer(value);
    choosePatient(null);
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
    setPrescriptionLookup({ error: "", loading: Boolean(value?.id) });
  }

  function addProduct(product) {
    setSale(null);
    setNotice("");
    setLines((current) => {
      const found = current.find((line) => line.id === product.id);
      return found
        ? current.map((line) =>
            line.id === product.id
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          )
        : [...current, { ...product, quantity: 1 }];
    });
  }

  function quantity(productId, next) {
    setLines((current) =>
      next < 1
        ? current.filter((line) => line.id !== productId)
        : current.map((line) =>
            line.id === productId ? { ...line, quantity: next } : line,
          ),
    );
  }

  function setExternalEye(side, field, value) {
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

  function addOpticalAddition() {
    const amount = Number(additionDraft.unitPriceCents);
    if (!additionDraft.name.trim() || !Number.isSafeInteger(amount) || amount <= 0) {
      setError("Indica un nombre y un valor entero positivo para el adicional.");
      return;
    }
    setOpticalAdditions((current) => [
      ...current,
      {
        description: null,
        name: additionDraft.name.trim(),
        quantity: 1,
        unitPriceCents: amount,
      },
    ]);
    setAdditionDraft({ name: "", unitPriceCents: "" });
    setError("");
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
      setOpticalAdditions(quote.opticalAdditions ?? []);
      setDiscountCents(quote.discount?.amountCents ?? 0);
      setDiscountReason(quote.discount?.reason ?? "");
      setPrescriptionId(quote.prescription?.id ?? "");
      setPrescriptionMode(quote.externalPrescription ? "external" : "internal");
      setSale(quote);
      setShowQuotations(false);
      setNotice(
        `Cotización N.º ${quote.saleNumber} cargada. Revisa y confirma la venta.`,
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  async function createQuotation() {
    setPending(true);
    setError("");
    setNotice("");
    try {
      let externalPrescriptionId = null;
      if (requiresPrescription && prescriptionMode === "external") {
        const confirmedData = externalPrescriptionData(externalPrescription);
        let response;
        if (prescriptionFile) {
          const body = new FormData();
          body.set("confirmedData", JSON.stringify(confirmedData));
          body.set("customerId", customer.id);
          body.set("image", prescriptionFile);
          body.set("patientId", patient.id);
          response = await fetch("/api/external-prescriptions", {
            body,
            method: "POST",
          });
        } else {
          response = await fetch("/api/external-prescriptions", {
            body: JSON.stringify({
              confirmedData,
              customerId: customer.id,
              patientId: patient.id,
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });
        }
        externalPrescriptionId = (await readResponse(response)).id;
      }
      const created = await readResponse(
        await fetch("/api/sales", {
          body: JSON.stringify({
            customerId: customer.id,
            discount:
              Number(discountCents || 0) > 0
                ? {
                    amountCents: Number(discountCents),
                    authorizerEmail: discountAuthorizerEmail,
                    authorizerPassword: discountAuthorizerPassword,
                    reason: discountReason,
                  }
                : null,
            externalPrescriptionId,
            items: lines.map((line) => ({
              productId: line.id,
              quantity: line.quantity,
            })),
            opticalAdditions,
            patientId: patient?.id ?? null,
            prescriptionId:
              prescriptionMode === "internal" ? prescriptionId || null : null,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setSale(created);
      setDiscountAuthorizerPassword("");
      setNotice(
        `Cotización N.º ${created.saleNumber} creada con trazabilidad.`,
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  async function confirmSale() {
    setPending(true);
    setError("");
    try {
      const confirmed = await readResponse(
        await fetch(`/api/sales/${sale.id}/confirm`, { method: "POST" }),
      );
      setSale(confirmed);
      setNotice("Venta confirmada. Ya puede registrar abonos.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  async function registerPayment(event) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const updated = await readResponse(
        await fetch(`/api/sales/${sale.id}/payments`, {
          body: JSON.stringify({
            amountCents: Number(form.get("amountCents")),
            paymentMethod: form.get("paymentMethod"),
            reference: form.get("reference") || null,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setSale(updated);
      const emailedTo = form.get("email") || customer.email;
      const issuedReceipt = await readResponse(
        await fetch(`/api/sales/${sale.id}/receipt`, {
          body: JSON.stringify({ email: emailedTo }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setReceipt(issuedReceipt);
      setNotice(
        updated.status === "PAID"
          ? "Venta pagada y comprobante emitido."
          : `Abono registrado y comprobante emitido. Saldo: ${money.format(updated.balanceCents)}.`,
      );
      event.currentTarget.reset();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
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
    setOpticalAdditions([]);
    setAdditionDraft({ name: "", unitPriceCents: "" });
    setDiscountCents(0);
    setDiscountReason("");
    setDiscountAuthorizerEmail("");
    setDiscountAuthorizerPassword("");
    setPrescriptionId("");
    setPrescriptionMode("internal");
    setExternalPrescription(EMPTY_EXTERNAL_PRESCRIPTION);
    setPrescriptionFile(null);
    setSale(null);
    setReceipt(null);
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
                      {quotation.customer.firstNames} {quotation.customer.lastNames}
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
      <div className="pos-layout">
        <section className="pos-workspace">
          <article className="app-card pos-section">
            <div className="pos-title">
              <span>1</span>
              <div>
                <h2>Cliente</h2>
                <p>Cliente comercial; no se crea una ficha clínica.</p>
              </div>
              <button
                className="text-button"
                disabled={Boolean(sale)}
                onClick={() => setNewCustomer((value) => !value)}
                type="button"
              >
                {newCustomer ? "Cerrar" : "+ Crear cliente"}
              </button>
            </div>
            {newCustomer ? (
              <form className="quick-customer" onSubmit={createCustomer}>
                <label className="field">
                  <span>RUT</span>
                  <input name="rut" placeholder="12.345.678-5" required />
                </label>
                <label className="field">
                  <span>Nombres</span>
                  <input name="firstNames" required />
                </label>
                <label className="field">
                  <span>Apellidos</span>
                  <input name="lastNames" required />
                </label>
                <label className="field">
                  <span>Teléfono</span>
                  <input name="phone" placeholder="+56912345678" required />
                </label>
                <label className="field">
                  <span>Correo</span>
                  <input name="email" required type="email" />
                </label>
                <label className="field field-wide">
                  <span>Dirección</span>
                  <input name="address" required />
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
                <div className="search-field">
                  <Icon name="search" size={18} />
                  <input
                    aria-label="Buscar cliente"
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    placeholder="Buscar por nombre, RUT, correo o teléfono"
                    value={customerSearch}
                  />
                </div>
                {customer && (
                  <div className="selected-customer">
                    <span>
                      <Icon name="check" size={17} />
                    </span>
                    <div>
                      <strong>
                        {customer.firstNames} {customer.lastNames}
                      </strong>
                      <small>
                        {customer.rut} · {customer.email}
                      </small>
                    </div>
                    <button disabled={Boolean(sale)} onClick={() => chooseCustomer(null)} type="button">
                      Cambiar
                    </button>
                  </div>
                )}
                {!customer && (
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
                            {item.rut} · {item.email}
                          </small>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </article>
          <article className="app-card pos-section">
            <div className="pos-title">
              <span>2</span>
              <div>
                <h2>Paciente</h2>
                <p>Se mantiene separado del cliente y solo se usa para la receta.</p>
              </div>
              <button
                className="text-button"
                disabled={Boolean(sale)}
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
                    <button disabled={Boolean(sale)} onClick={() => choosePatient(null)} type="button">Cambiar</button>
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
          </article>
          <article className="app-card pos-section">
            <div className="pos-title">
              <span>3</span>
              <div>
                <h2>Productos</h2>
                <p>
                  Precios vigentes con disponibilidad simulada hasta integrar inventario.
                </p>
              </div>
            </div>
            <div className="search-field">
              <Icon name="search" size={18} />
              <input
                aria-label="Buscar productos"
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Buscar por nombre o SKU"
                value={productSearch}
              />
            </div>
            <div className="product-results">
              {products.loading ? (
                <p>Cargando productos…</p>
              ) : products.error ? (
                <p className="inline-error">{products.error}</p>
              ) : (
                products.items
                  .filter((item) => item.isActive)
                  .map((item) => (
                    <button
                      disabled={Boolean(sale)}
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
                            ? " · Requiere receta"
                            : ""}
                          {item.availability?.source === "MOCK"
                            ? " · Disponibilidad simulada"
                            : ""}
                        </small>
                      </span>
                      <b>{money.format(item.unitPriceCents)}</b>
                      <em>+</em>
                    </button>
                  ))
              )}
            </div>
          </article>
          <article className="app-card pos-section">
            <div className="pos-title">
              <span>4</span>
              <div>
                <h2>Adicionales ópticos</h2>
                <p>Cargos separados mientras se definen los precios definitivos.</p>
              </div>
            </div>
            <div className="addition-entry">
              <label className="field">
                <span>Nombre</span>
                <input
                  disabled={Boolean(sale)}
                  onChange={(event) => setAdditionDraft({ ...additionDraft, name: event.target.value })}
                  placeholder="Ej.: Antirreflejo premium"
                  value={additionDraft.name}
                />
              </label>
              <label className="field">
                <span>Valor CLP</span>
                <input
                  disabled={Boolean(sale)}
                  min="1"
                  onChange={(event) => setAdditionDraft({ ...additionDraft, unitPriceCents: event.target.value })}
                  type="number"
                  value={additionDraft.unitPriceCents}
                />
              </label>
              <button className="app-button app-button--soft" disabled={Boolean(sale)} onClick={addOpticalAddition} type="button">
                <Icon name="plus" size={16} /> Agregar
              </button>
            </div>
            {opticalAdditions.length ? (
              <div className="addition-list">
                {opticalAdditions.map((addition, index) => (
                  <div key={`${addition.name}-${index}`}>
                    <span><strong>{addition.name}</strong><small>Adicional óptico</small></span>
                    <b>{money.format(addition.unitPriceCents * addition.quantity)}</b>
                    {!sale && <button aria-label={`Quitar ${addition.name}`} onClick={() => setOpticalAdditions((current) => current.filter((_, position) => position !== index))} type="button">×</button>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="addition-empty">Sin adicionales en esta operación.</p>
            )}
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
                  </div>
                  <div className="quantity">
                    <button
                      aria-label={`Quitar ${line.name}`}
                      disabled={Boolean(sale)}
                      onClick={() => quantity(line.id, line.quantity - 1)}
                      type="button"
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      aria-label={`Agregar ${line.name}`}
                      disabled={Boolean(sale)}
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
                  <small>Adicional óptico</small>
                </div>
                <span className="addition-quantity">{addition.quantity}</span>
                <b>{money.format(addition.unitPriceCents * addition.quantity)}</b>
              </div>
            ))}
          </div>
          {requiresPrescription && (
            <div className="prescription-field pos-prescription">
              <label className="field">
                <span>Origen de la receta</span>
                <select
                  disabled={Boolean(sale)}
                  onChange={(event) => setPrescriptionMode(event.target.value)}
                  value={prescriptionMode}
                >
                  <option value="internal">Emitida en Óptica Stylo</option>
                  <option value="external">Receta externa</option>
                </select>
              </label>
              {prescriptionMode === "internal" ? (
                <label className="field">
                  <span>Receta interna activa</span>
                  <select
                    disabled={Boolean(sale)}
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
                      disabled={Boolean(sale)}
                      onChange={(event) =>
                        setPrescriptionFile(event.target.files?.[0] ?? null)
                      }
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
                            disabled={Boolean(sale)}
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
                        disabled={Boolean(sale)}
                        onChange={(event) =>
                          setExternalPrescription({
                            ...externalPrescription,
                            pupillaryDistance: event.target.value,
                          })
                        }
                        step="0.01"
                        type="number"
                        value={externalPrescription.pupillaryDistance}
                      />
                    </label>
                    <label className="field">
                      <span>Notas de fabricación</span>
                      <input
                        disabled={Boolean(sale)}
                        maxLength="1000"
                        onChange={(event) =>
                          setExternalPrescription({
                            ...externalPrescription,
                            fulfillmentNotes: event.target.value,
                          })
                        }
                        value={externalPrescription.fulfillmentNotes}
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="discount-box">
            <label className="field">
              <span>Descuento manual (CLP)</span>
              <input
                disabled={Boolean(sale)}
                min="0"
                onChange={(event) => setDiscountCents(event.target.value)}
                type="number"
                value={discountCents}
              />
            </label>
            {Number(discountCents) > 0 && !sale && (
              <div className="discount-authorization">
                <label className="field">
                  <span>Motivo obligatorio</span>
                  <input
                    maxLength="300"
                    onChange={(event) => setDiscountReason(event.target.value)}
                    placeholder="Ej.: convenio autorizado"
                    value={discountReason}
                  />
                </label>
                <label className="field">
                  <span>Correo del autorizador</span>
                  <input
                    autoComplete="username"
                    onChange={(event) => setDiscountAuthorizerEmail(event.target.value)}
                    type="email"
                    value={discountAuthorizerEmail}
                  />
                </label>
                <label className="field">
                  <span>Contraseña del autorizador</span>
                  <input
                    autoComplete="current-password"
                    onChange={(event) => setDiscountAuthorizerPassword(event.target.value)}
                    type="password"
                    value={discountAuthorizerPassword}
                  />
                  <small>Debe ser una cuenta con permiso para autorizar descuentos.</small>
                </label>
              </div>
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
          {!sale && (
            <button
              className="app-button app-button--primary ticket-action"
              disabled={
                pending ||
                !canSell ||
                !customer ||
                !lines.length ||
                total <= 0 ||
                (requiresPrescription && !patient) ||
                (requiresPrescription &&
                  prescriptionMode === "internal" &&
                  !prescriptionId) ||
                (Number(discountCents) > 0 &&
                  (!discountReason.trim() ||
                    !discountAuthorizerEmail.trim() ||
                    !discountAuthorizerPassword))
              }
              onClick={createQuotation}
              type="button"
            >
              {pending ? "Guardando…" : "Crear cotización"}
            </button>
          )}
          {sale?.status === "QUOTATION" && (
            <button
              className="app-button app-button--primary ticket-action"
              disabled={pending}
              onClick={confirmSale}
              type="button"
            >
              Confirmar venta
            </button>
          )}
          {sale?.status === "PENDING" && (
            <form className="payment-form" onSubmit={registerPayment}>
              <h3>Registrar abono</h3>
              <label className="field">
                <span>Monto (máx. {money.format(sale.balanceCents)})</span>
                <input
                  max={sale.balanceCents}
                  min="1"
                  name="amountCents"
                  required
                  type="number"
                />
              </label>
              <label className="field">
                <span>Medio único para esta venta</span>
                <select
                  defaultValue={sale.paymentMethod ?? ""}
                  disabled={Boolean(sale.paymentMethod)}
                  name="paymentMethod"
                  required
                >
                  <option disabled value="">
                    Seleccionar
                  </option>
                  {PAYMENT_METHODS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Referencia opcional</span>
                <input maxLength="200" name="reference" />
              </label>
              <label className="field">
                <span>Enviar comprobante a</span>
                <input defaultValue={customer?.email ?? ""} name="email" required type="email" />
              </label>
              <button
                className="app-button app-button--primary"
                disabled={pending}
                type="submit"
              >
                Registrar abono
              </button>
            </form>
          )}
          {receipt && (
            <div className="receipt-result">
              <span className="status-chip">Comprobante N.º {receipt.receiptNumber}</span>
              <small>
                {receipt.emailStatus === "SENT"
                  ? `Enviado a ${receipt.emailedTo}`
                  : receipt.emailStatus === "SIMULATED"
                    ? "Envío simulado; configura Resend para correo real."
                    : "Comprobante emitido; revisa el estado del correo."}
              </small>
              <a className="app-button app-button--soft" href={`/api/sales/${sale.id}/receipt/print`} rel="noreferrer" target="_blank">
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
