"use client";

import { useEffect, useState } from "react";
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
  <p>Indique el número del pedido. La recuperación exige un código en el correo de esa compra y coincidencia con la identidad de esta cuenta.</p>
  <form onSubmit={submit}>
    {step === "request" ? <label className="field"><span>Número del pedido anterior</span><input name="orderId" inputMode="numeric" pattern="[0-9]{1,18}" required /></label> : <label className="field"><span>Código del pedido anterior</span><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>}
    <button className="button button--primary" disabled={busy}>{step === "request" ? "Solicitar código del pedido" : "Confirmar recuperación"}</button>
  </form>
  {message && <p role="status">{message}</p>}
  {step === "confirm" && <button type="button" onClick={() => setStep("request")}>Solicitar otro código</button>}
</details>;
}
export function AccountContactPreferences() {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/store/accounts/me/contact", {
      cache: "no-store"
    }).then(readStoreResponse).then(d => {
      if (active) setData(d);
    }).catch(e => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, []);
  async function revoke(channel) {
    try {
      const d = await readStoreResponse(await fetch("/api/store/accounts/me/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          channel,
          decision: "REVOKED"
        })
      }));
      setData(d);
    } catch (e) {
      setError(e.message);
    }
  }
  return <details className="account-card">
  <summary>Mis preferencias de comunicación comercial</summary>
  <p>Comprar o crear una cuenta no autoriza publicidad. Los correos necesarios para tus pedidos se gestionan por separado.</p>
  {data?.channels.map(c => <div key={c.channel}>
    <p>{c.channel === "EMAIL" ? "Correo" : "Teléfono"}: {c.state === "GRANTED" ? "Autorización registrada" : c.state === "REVOKED" ? "Revocada / oposición" : "Sin autorización vigente"}</p>
    <button className="button button--secondary" type="button" onClick={() => revoke(c.channel)}>Revocar comunicaciones por {c.channel === "EMAIL" ? "correo" : "teléfono"}</button>
  </div>)}
  {error && <p role="alert">{error}</p>}
</details>;
}
