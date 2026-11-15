"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readStoreResponse } from "@/utils/store-client";

async function submitReset(endpoint, values) {
  const response = await fetch(`/api/store/accounts/password-reset/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  try {
    return await readStoreResponse(response);
  } catch (error) {
    if (response.status === 429) error.retryAfterSeconds = Number(response.headers.get("Retry-After"));
    throw error;
  }
}

export default function PasswordRecovery({ fromBooking }) {
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retryByEmail, setRetryByEmail] = useState(() => new Map());
  const [clock, setClock] = useState(0);
  const pending = useRef(false);
  const activeEmail = challenge?.email ?? email.trim().toLowerCase();
  const retryUntil = retryByEmail.get(activeEmail) ?? 0;
  const retrySeconds = Math.max(0, Math.ceil((retryUntil - clock) / 1000));

  useEffect(() => {
    if (!retryUntil) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= retryUntil) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryUntil]);

  function waitBeforeResend(address, seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const now = Date.now();
    setClock(now);
    setRetryByEmail((previous) => {
      const updated = new Map([...previous].filter(([, deadline]) => deadline > now));
      updated.set(address, Math.max(updated.get(address) ?? 0, now + seconds * 1000));
      return updated;
    });
  }

  async function perform(operation, address) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await operation();
    } catch (requestError) {
      if (address) waitBeforeResend(address, requestError.retryAfterSeconds);
      setError(requestError.message);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  function requestCode(value) {
    const address = value.trim().toLowerCase();
    if (Date.now() < (retryByEmail.get(address) ?? 0)) return;
    return perform(async () => {
      setEmail(address);
      const result = await submitReset("request", { email: address });
      waitBeforeResend(address, result.retryAfterSeconds);
      setChallenge({ id: result.challengeId, email: address });
    }, address);
  }

  async function submit(event) {
    event.preventDefault();
    if (pending.current) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (!challenge) return requestCode(values.email);
    if (values.password !== values.confirmPassword) {
      setError("Las contraseñas deben coincidir.");
      return;
    }

    return perform(async () => {
      await submitReset("confirm", { challengeId: challenge.id, code: values.code, password: values.password });
      setDone(true);
    });
  }

  return (
    <main className="account-page account-access">
      <section className="account-intro">
        <p className="eyebrow">Mi cuenta Stylo</p>
        <h1>{done ? "Contraseña actualizada" : "Recupera tu contraseña"}</h1>
        <p>{done ? "Ya puedes iniciar sesión con tu nueva contraseña." : "Usa el correo con el que creaste tu cuenta en la tienda."}</p>
      </section>
      <section className="account-auth">
        {done ? (
          <Link className="button button--primary" href={fromBooking ? "/reservar" : "/cuenta"}>
            {fromBooking ? "Volver a la reserva" : "Ir a iniciar sesión"}
          </Link>
        ) : (
          <form key={challenge?.id || "request"} method="post" onSubmit={submit}>
            {challenge ? (
              <>
                <p className="field-full" role="status">Si el correo corresponde a una cuenta activa, recibirás un código de seis dígitos. Revisa también spam. El código vence en 10 minutos.</p>
                <label className="field field-full">
                  <span>Código de recuperación</span>
                  <input autoComplete="one-time-code" inputMode="numeric" maxLength={6} name="code" pattern="[0-9]{6}" required />
                </label>
                <label className="field field-full">
                  <span>Nueva contraseña (mínimo 15 caracteres)</span>
                  <input autoComplete="new-password" name="password" maxLength={128} minLength={15} required type="password" />
                </label>
                <label className="field field-full">
                  <span>Repite la nueva contraseña</span>
                  <input autoComplete="new-password" name="confirmPassword" maxLength={128} minLength={15} required type="password" />
                </label>
              </>
            ) : (
              <label className="field field-full">
                <span>Correo electrónico</span>
                <input autoComplete="email" name="email" required type="email" value={email} onChange={(event) => {
                  setEmail(event.target.value);
                  setClock(Date.now());
                  setError("");
                }} />
              </label>
            )}
            {error && <p className="inline-error field-full" role="alert">{error}</p>}
            <button className="button button--primary field-full" disabled={saving || (!challenge && retrySeconds > 0)} type="submit">
              {saving ? "Procesando…" : challenge ? "Cambiar contraseña" : "Enviar código"}
            </button>
            {challenge && (
              <>
                <p className="field-full">Solicitar otro código invalida el anterior. Usa el código de la solicitud más reciente, aunque los correos lleguen en otro orden.</p>
                <button className="button button--secondary field-full" disabled={saving || retrySeconds > 0} type="button" onClick={() => requestCode(challenge.email)}>
                  Solicitar otro código
                </button>
                <button className="button button--secondary field-full" disabled={saving} type="button" onClick={() => { setChallenge(null); setError(""); }}>
                  Cambiar correo
                </button>
              </>
            )}
            {retrySeconds > 0 && <p className="field-full">Podrás solicitar otro código para este correo en {retrySeconds} s.</p>}
            <Link className="field-full" href={fromBooking ? "/reservar" : "/cuenta"}>
              {fromBooking ? "Volver a la reserva" : "Volver a iniciar sesión"}
            </Link>
          </form>
        )}
      </section>
    </main>
  );
}
