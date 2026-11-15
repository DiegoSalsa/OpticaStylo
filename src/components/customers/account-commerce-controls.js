"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readStoreResponse } from "@/utils/store-client";
export function RecoverOrder({
  onRecovered
}) {
  const [step, setStep] = useState("request"),
    [challenge, setChallenge] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const input = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const r = await readStoreResponse(await fetch(`/api/store/accounts/me/orders-link${step === "request" ? "/request-code" : ""}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...input,
          challengeId: challenge
        })
      }));
      if (step === "request") {
        setChallenge(r.challengeId);
        setStep("confirm");
        setMessage(r.message);
      } else {
        await onRecovered();
        setStep("request");
        setMessage("Pedido recuperado en esta cuenta.");
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <details className="account-card">
  <summary>Recuperar una compra anterior como invitado</summary>
<p>Usa el número de tu pedido en línea. Para recuperarlo, el RUT y el correo de esa compra deben coincidir con los de tu cuenta.</p><p>¿Compraste con otro correo o falta un pedido? <Link href="/contacto">Pide ayuda a la óptica</Link>.</p>
  <form onSubmit={submit}>
    {step === "request" ? <label className="field"><span>Número del pedido anterior</span><input name="orderId" inputMode="numeric" pattern="[0-9]{1,18}" required /></label> : <label className="field"><span>Código del pedido anterior</span><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>}
    <button className="button button--primary" disabled={busy}>{step === "request" ? "Solicitar código del pedido" : "Confirmar recuperación"}</button>
  </form>
  {message && <p role="status">{message}</p>}
  {step === "confirm" && <button type="button" onClick={() => setStep("request")}>Solicitar otro código</button>}
</details>;
}
export function AccountContactPreferences() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyChannel, setBusyChannel] = useState("");
  const [retry, setRetry] = useState(0);
  const pending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/store/accounts/me/contact", { cache: "no-store", signal: controller.signal })
      .then(readStoreResponse)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [retry]);

  async function revoke(channel) {
    if (pending.current) return;
    pending.current = true;
    setError("");
    setNotice("");
    setBusyChannel(channel);
    try {
      const result = await readStoreResponse(await fetch("/api/store/accounts/me/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, decision: "REVOKED" }),
      }));
      setData(result);
      setNotice(channel === "EMAIL" ? "Guardamos tu oposición a la publicidad por correo." : "Guardamos tu oposición a la publicidad por teléfono.");
    } catch (failure) {
      setError(failure.message);
    } finally {
      pending.current = false;
      setBusyChannel("");
    }
  }

  return <details className="account-card">
    <summary>Mis preferencias de comunicación comercial</summary>
    <p>Comprar o crear una cuenta no autoriza publicidad. Los correos necesarios para tus pedidos se gestionan por separado.</p>
    {!data && !error && <p role="status">Cargando preferencias…</p>}
    {data?.channels.map(({ channel, state }) => <div key={channel}>
      <p>{channel === "EMAIL" ? "Correo" : "Teléfono"}: {state === "GRANTED" ? "Autorización registrada" : state === "REVOKED" ? "Revocada / oposición" : "Sin autorización vigente"}</p>
      {state !== "REVOKED" && <button className="button button--secondary" disabled={Boolean(busyChannel)} type="button" onClick={() => revoke(channel)}>
        {busyChannel === channel ? "Guardando…" : "Revocar comunicaciones por " + (channel === "EMAIL" ? "correo" : "teléfono")}
      </button>}
    </div>)}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error} {!data && <button type="button" onClick={() => { setError(""); setRetry((value) => value + 1); }}>Reintentar</button>}</p>}
  </details>;
}
