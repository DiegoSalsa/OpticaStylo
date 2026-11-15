"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/icon";
import RutInput from "@/components/ui/rut-input";
import { readStoreResponse } from "@/utils/store-client";

export default function AccountAuth({ onAuthenticated }) {
  const [mode, setMode] = useState("LOGIN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [notice, setNotice] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const pending = useRef(false);
  const registering = mode === "REGISTER";
  const recoverExisting = Boolean(challenge) || ["CUSTOMER_ACCOUNT_REQUIRES_LINKING", "CUSTOMER_ACCOUNT_EMAIL_EXISTS"].includes(error?.code);

  useEffect(() => {
    if (!retryAt) return;
    function tick() {
      const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) setRetryAt(0);
    }
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  function resetVerification() {
    setChallenge(null);
    setNotice("");
    setError(null);
  }

  function changeMode(value) {
    if (pending.current) return;
    setMode(value);
    resetVerification();
  }

  function waitBeforeResending(seconds) {
    setRetryAt(Date.now() + seconds * 1000);
    setRemaining(seconds);
  }

  async function requestCode(event) {
    if (pending.current || remaining > 0) return;
    const form = event.currentTarget.form;
    if (!form.elements.rut.reportValidity() || !form.elements.email.reportValidity()) return;
    const { rut, email } = Object.fromEntries(new FormData(form));
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const response = await fetch("/api/store/accounts/register/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rut, email }),
      });
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After"));
        waitBeforeResending(seconds > 0 ? seconds : 60);
      }
      const result = await readStoreResponse(response);
      setChallenge(result.challengeId);
      setNotice(result.message);
      waitBeforeResending(60);
    } catch (requestError) {
      setError(requestError);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function authenticate(event) {
    event.preventDefault();
    if (pending.current) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (registering && challenge) values.challengeId = challenge;
    pending.current = true;
    setError(null);
    setBusy(true);
    try {
      const endpoint = registering ? "register" : "login";
      const result = await readStoreResponse(await fetch("/api/store/accounts/" + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }));
      onAuthenticated(result.account);
    } catch (requestError) {
      setError(requestError);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="account-page account-access">
      <section className="account-intro">
        <p className="eyebrow">Mi cuenta Stylo</p>
        <h1>{registering ? "Crea tu cuenta" : "Qué bueno verte"}</h1>
        <p>Revisa tus pedidos y conserva tus datos de compra.</p>
        <div className="account-benefits">
          <span><Icon name="receipt" /> Historial de pedidos</span>
          <span><Icon name="cart" /> Compra más rápida</span>
          <span><Icon name="shield" /> Sesión protegida</span>
        </div>
      </section>
      <section className="account-auth">
        <div className="account-tabs">
          <button className={!registering ? "active" : ""} aria-pressed={!registering} disabled={busy} onClick={() => changeMode("LOGIN")} type="button">Ingresar</button>
          <button className={registering ? "active" : ""} aria-pressed={registering} disabled={busy} onClick={() => changeMode("REGISTER")} type="button">Crear cuenta</button>
        </div>
        <form onSubmit={authenticate}>
          {registering && <>
            <label className="field"><span>RUT</span><RutInput name="rut" onChange={resetVerification} placeholder="12.345.678-5" readOnly={busy} required /></label>
            <label className="field"><span>Nombres</span><input autoComplete="given-name" name="firstNames" required /></label>
            <label className="field"><span>Apellidos</span><input autoComplete="family-name" name="lastNames" required /></label>
            <label className="field"><span>Fecha de nacimiento del titular adulto</span><input autoComplete="bday" name="birthDate" required type="date" /></label>
            <label className="field"><span>Teléfono</span><input autoComplete="tel" name="phone" placeholder="+56 9 1234 5678" required type="tel" /></label>
            <label className="field field-full"><span>Dirección</span><input autoComplete="street-address" name="address" required /></label>
          </>}
          <label className="field field-full">
            <span>Correo electrónico</span>
            <input autoComplete="email" name="email" onChange={registering ? resetVerification : undefined} placeholder="nombre@correo.cl" readOnly={busy} required type="email" />
          </label>
          <label className="field field-full">
            <span>{registering ? "Contraseña (mínimo 15 caracteres)" : "Contraseña"}</span>
            <input autoComplete={registering ? "new-password" : "current-password"} key={mode} minLength={registering ? 15 : 1} name="password" required type="password" />
          </label>
          {registering && <>
            <p className="field-full account-help">Si nunca has comprado, puedes crear la cuenta directamente. Si ya compraste y el registro te pide verificar el RUT, solicita el código con el correo de esa compra.</p>
            <button className="button button--secondary field-full" type="button" disabled={busy || remaining > 0} onClick={requestCode}>
              {remaining > 0 ? "Podrás pedir otro código en " + remaining + " s" : "Verificar registro de compras anteriores"}
            </button>
            {challenge && <>
              <label className="field field-full"><span>Código para crear la cuenta</span><input key={challenge} name="verificationCode" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label>
              <button className="button button--secondary field-full" disabled={busy} onClick={resetVerification} type="button">Volver al registro sin código</button>
            </>}
          </>}
          {(!registering || recoverExisting) && <Link className="field-full" href="/cuenta/recuperar">¿Olvidaste tu contraseña?</Link>}
          {registering && recoverExisting && <button className="button button--secondary field-full" disabled={busy} onClick={() => changeMode("LOGIN")} type="button">Ya tengo cuenta</button>}
          {notice && <p className="field-full" role="status">{notice}</p>}
          {error && <p className="inline-error field-full" role="alert">{error.message}</p>}
          <button className="button button--primary field-full" disabled={busy} type="submit">
            {busy ? "Procesando…" : registering ? "Crear cuenta segura" : "Ingresar"}
          </button>
        </form>
      </section>
    </main>
  );
}
