"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readStoreResponse } from "@/utils/store-client";

export default function AccountClinicalLink({ onLinked, onExpired, dependantId = null }) {
  const [birthDate, setBirthDate] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) setRetryAt(0);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  function cooldown(seconds) {
    setRetryAt(Date.now() + seconds * 1000);
    setRemaining(seconds);
  }

  async function verify(code) {
    if (pending.current || (!code && remaining)) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const path = dependantId ? "dependants/" + dependantId + (code ? "/verify" : "/request-code") : code ? "patient-link" : "patient-link/request-code";
      const response = await fetch("/api/store/accounts/me/" + path, {
        body: JSON.stringify(code ? { code } : dependantId ? {} : { birthDate }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (response.status === 429 && !code) {
        const seconds = Number(response.headers.get("Retry-After"));
        cooldown(seconds > 0 ? seconds : 60);
      }
      const result = await readStoreResponse(response);
      if (result.linked) {
        await onLinked();
      } else {
        setSentTo(result.maskedEmail);
        setChallengeVersion((version) => version + 1);
        cooldown(60);
      }
    } catch (failure) {
      if (failure.status === 401) onExpired();
      else setError(failure.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <div className="account-clinical-link">
    {sentTo ? <>
      <p>Enviamos un código de seis dígitos a {sentTo}. Usa el código más reciente.</p>
      <form className="clinical-link-form" onSubmit={(event) => {
        event.preventDefault();
        void verify(new FormData(event.currentTarget).get("code"));
      }}>
        <label className="field"><span>Código de verificación</span><input key={challengeVersion}
          autoComplete="one-time-code" inputMode="numeric" maxLength={6} name="code" pattern="[0-9]{6}" required
        /></label>
        <button className="button button--primary" disabled={busy} type="submit">Confirmar código</button>
        <button className="button button--secondary" disabled={busy || remaining > 0} type="button" onClick={() => void verify(null)}>
          {remaining > 0 ? "Reenviar en " + remaining + " s" : "Reenviar código"}
        </button>
        <button className="button button--secondary" disabled={busy} type="button" onClick={() => { setSentTo(""); setError(""); }}>Cambiar fecha</button>
      </form>
    </> : <>
      <p>{dependantId ? "Verifica el correo del adulto responsable registrado en la ficha para consultar las atenciones anteriores." : "Verifica tu fecha de nacimiento para recibir un código en el correo registrado en tu ficha."}</p>
      <form className="clinical-link-form" onSubmit={(event) => { event.preventDefault(); void verify(null); }}>
        {!dependantId && <label className="field"><span>Fecha de nacimiento</span><input
          max={new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" })}
          onChange={(event) => setBirthDate(event.target.value)} readOnly={busy} required type="date" value={birthDate}
        /></label>}
        <button className="button button--primary" disabled={busy || remaining > 0} type="submit">
          {busy ? "Verificando…" : remaining > 0 ? "Volver a enviar en " + remaining + " s" : "Enviar código"}
        </button>
      </form>
    </>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <p>Si tu ficha tiene otro correo o no recibes el código, <Link href="/contacto">contacta a la óptica</Link>.</p>
  </div>;
}
