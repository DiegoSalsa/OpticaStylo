"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import { buildPosPaymentInput } from "@/utils/pos-payment";
import PosInterface from "./pos-interface";
import {
  ADULT_BIRTH_DATE_CUTOFF,
  EMPTY_EXTERNAL_PRESCRIPTION,
  externalPrescriptionData,
  externalPrescriptionDraft,
  MONEY_FORMATTER,
  PRESCRIPTION_READER_IMAGE_TYPES,
} from "./pos-form-model";
import useResourceSearch from "./use-resource-search";

const money = MONEY_FORMATTER;

export default function PosExperience() {
  const actor = useInternalActor();
  const [customerSearch, setCustomerSearch] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const customers = useResourceSearch("/api/customers", customerSearch);
  const patients = useResourceSearch("/api/patients", patientSearch);
  const products = useResourceSearch(
    "/api/products",
    productSearch,
    "excludeCategory=PRESCRIPTION_LENS",
  );
  const lensOptions = useResourceSearch(
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
  const [prescriptionLookup, setPrescriptionLookup] = useState({
    error: "",
    loading: false,
  });
  const [attachPrescription, setAttachPrescription] = useState(false);
  const [prescriptionMode, setPrescriptionMode] = useState("internal");
  const [externalPrescription, setExternalPrescription] = useState(
    EMPTY_EXTERNAL_PRESCRIPTION,
  );
  const [prescriptionFile, setPrescriptionFile] = useState(null);
  const [prescriptionReader, setPrescriptionReader] = useState({
    file: null,
    loading: false,
    result: null,
  });
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
  const offersPrescriptionAttachment = lines.some(
    (line) => line.requiresPrescription,
  );
  const soldFrames = lines.filter((line) => line.category === "FRAME");
  const selectedLens = lensOptions.items.find(
    (item) => item.id === selectedLensId,
  );
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
            : attachPrescription &&
                prescriptionMode === "internal" &&
                !prescriptionId
              ? "Selecciona la receta interna que decidiste adjuntar."
              : Number(discountCents) > 0 &&
                  (!discountReason.trim() || !discountAuthorization)
                ? "Indica el motivo y la autorización temporal para aplicar el descuento."
                : "";
  const draftIncomplete =
    !lines.length ||
    total <= 0 ||
    (attachPrescription && !patient) ||
    (attachPrescription && prescriptionMode === "external" && !customer) ||
    (attachPrescription &&
      prescriptionMode === "internal" &&
      !prescriptionId) ||
    (Number(discountCents) > 0 &&
      (!discountReason.trim() || !discountAuthorization));

  useEffect(() => {
    if (!sale || sale.status === "QUOTATION") scannerRef.current?.focus();
  }, [sale]);

  useEffect(() => {
    if (
      !offersPrescriptionAttachment ||
      !attachPrescription ||
      prescriptionMode !== "internal" ||
      !patient?.id
    ) {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/prescriptions?patientId=${patient.id}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(readResponse)
      .then((items) => {
        setInternalPrescriptions(items);
        setPrescriptionLookup({ error: "", loading: false });
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError")
          setPrescriptionLookup({
            error: requestError.message,
            loading: false,
          });
      });
    return () => controller.abort();
  }, [
    attachPrescription,
    offersPrescriptionAttachment,
    patient,
    prescriptionMode,
  ]);

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
      existing &&
      mount &&
      (existing.mount?.source !== mount.source ||
        existing.mount?.frameProductId !== mount.frameProductId)
    ) {
      setError(
        "Este tipo de cristal ya está configurado con otra montura en el ticket.",
      );
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
      setError(
        "Selecciona la montura antes de agregar los cristales al ticket.",
      );
      return false;
    }
    const added = addLine(product);
    if (added && product.category === "FRAME")
      setSelectedLensMountId(product.id);
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
    const attachedLenses =
      next < 1 && product?.category === "FRAME"
        ? lines.filter(
            (line) =>
              line.mount?.source === "SOLD_FRAME" &&
              line.mount.frameProductId === productId,
          )
        : [];
    if (attachedLenses.length) {
      setNotice(
        "También se quitaron los cristales configurados para esa montura.",
      );
    }
    if (next < 1 && selectedLensMountId === productId) {
      setSelectedLensMountId("");
    }
    if (next < 1 && product?.requiresPrescription && product.quantity === 1) {
      setNotice("");
    }
    setLines((current) =>
      next < 1
        ? current.filter(
            (line) =>
              line.id !== productId && line.mount?.frameProductId !== productId,
          )
        : current.map((line) =>
            line.id === productId ? { ...line, quantity: next } : line,
          ),
    );
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
    return (
      globalThis.crypto?.randomUUID?.() ??
      `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }

  async function readExternalPrescriptionImage() {
    if (
      !prescriptionFile ||
      !PRESCRIPTION_READER_IMAGE_TYPES.has(prescriptionFile.type)
    ) {
      setError("La lectura automática admite imágenes JPEG, PNG o WEBP.");
      return;
    }
    setError("");
    setPrescriptionReader({
      file: prescriptionFile,
      loading: true,
      result: null,
    });
    try {
      const form = new FormData();
      form.set("image", prescriptionFile);
      const extraction = await readResponse(
        await fetch("/api/external-prescriptions/extract", {
          body: form,
          method: "POST",
        }),
      );
      setExternalPrescription(externalPrescriptionDraft(extraction.data));
      setExternalPrescriptionId(null);
      setPrescriptionReader({
        file: prescriptionFile,
        loading: false,
        result: extraction.data,
      });
      setNotice(
        "Revisa y corrige cada valor sugerido antes de guardar la receta externa.",
      );
    } catch (requestError) {
      setPrescriptionReader({ file: null, loading: false, result: null });
      setError(requestError.message);
    }
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
    const created = await readResponse(response);
    setExternalPrescriptionId(created.id);
    return created.id;
  }

  async function buildDraft() {
    const selectedExternalPrescriptionId =
      attachPrescription && prescriptionMode === "external"
        ? await ensureExternalPrescription()
        : null;
    return {
      customerId: customer?.id ?? null,
      discount:
        Number(discountCents || 0) > 0
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
      prescriptionId:
        attachPrescription && prescriptionMode === "internal"
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
        const updated = await readResponse(
          await fetch(`/api/sales/${sale.id}`, {
            body: JSON.stringify(draft),
            headers: { "Content-Type": "application/json" },
            method: "PATCH",
          }),
        );
        if (operation === "SALE") {
          const confirmed = await readResponse(
            await fetch(`/api/sales/${updated.id}/confirm`, {
              method: "POST",
            }),
          );
          setSale(confirmed);
          setNotice("Cotización actualizada y confirmada para cobro.");
        } else {
          setSale(updated);
          setNotice(`Cotización N.º ${updated.saleNumber} actualizada.`);
        }
      } else {
        requestKeys.current.sale ??= createRequestKey();
        const created = await readResponse(
          await fetch("/api/sales", {
            body: JSON.stringify({ ...draft, operation }),
            headers: {
              "Content-Type": "application/json",
              "X-Idempotency-Key": requestKeys.current.sale,
            },
            method: "POST",
          }),
        );
        setSale(created);
        requestKeys.current.sale = null;
        setNotice(
          operation === "SALE"
            ? `Venta N.º ${created.saleNumber} lista para cobrar.`
            : `Cotización N.º ${created.saleNumber} creada con trazabilidad.`,
        );
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
            "X-Idempotency-Key": (requestKeys.current.payment ??=
              createRequestKey()),
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
      setSale((current) =>
        current
          ? {
              ...current,
              receipt: issuedReceipt,
              payments: current.payments.map((payment) =>
                payment.id === registeredPayment.id
                  ? { ...payment, receipt: issuedReceipt }
                  : payment,
              ),
            }
          : current,
      );
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
      const cancelled = await readResponse(
        await fetch(`/api/sales/${sale.id}/status`, {
          body: JSON.stringify({
            cancellationReason: cancelReason,
            status: "CANCELLED",
          }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        }),
      );
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
      const result = await readResponse(
        await fetch(
          `/api/products?search=${encodeURIComponent(code)}&pageSize=12`,
          { cache: "no-store" },
        ),
      );
      const product = result.items.find(
        (item) => item.isActive && item.sku === code,
      );
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
    <PosInterface
      model={{
        activeCategory,
        addConfiguredLens,
        addProduct,
        attachPrescription,
        canEdit,
        canSell,
        cancelQuotation,
        cancelReason,
        cashReceivedCents,
        cashRegister,
        checkoutBlockedReason,
        chooseCustomer,
        choosePatient,
        createCustomer,
        createPatient,
        customer,
        customerSearch,
        customers,
        discountAuthorization,
        discountCents,
        discountReason,
        draftIncomplete,
        error,
        externalPrescription,
        internalPrescriptions,
        issueCurrentReceipt,
        lensOptions,
        lines,
        loadQuotation,
        loadQuotations,
        money,
        newCustomer,
        newPatient,
        notice,
        offersPrescriptionAttachment,
        opticalAdditions,
        patient,
        patientBirthDate,
        patientSearch,
        patients,
        paymentMethod,
        pending,
        prescriptionFile,
        prescriptionId,
        prescriptionLookup,
        prescriptionMode,
        prescriptionReader,
        productSearch,
        products,
        quantity,
        quotations,
        readExternalPrescriptionImage,
        receipt,
        registerPayment,
        reset,
        sale,
        saveOperation,
        scanSku,
        scannerRef,
        selectedLensId,
        selectedLensMountId,
        setActiveCategory,
        setAttachPrescription,
        setCancelReason,
        setCashReceivedCents,
        setCashRegister,
        setCustomerSearch,
        setDiscountAuthorization,
        setDiscountCents,
        setDiscountReason,
        setExternalEye,
        setExternalPrescription,
        setExternalPrescriptionId,
        setNewCustomer,
        setNewPatient,
        setPatientBirthDate,
        setPatientSearch,
        setPaymentMethod,
        setPrescriptionFile,
        setPrescriptionId,
        setPrescriptionMode,
        setPrescriptionReader,
        setProductSearch,
        setSelectedLensId,
        setSelectedLensMountId,
        setShowQuotations,
        showQuotations,
        soldFrames,
        subtotal,
        total,
      }}
    />
  );
}
