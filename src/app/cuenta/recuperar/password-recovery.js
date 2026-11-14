"use client";

import Link from "next/link";
import { useState } from "react";
import { readStoreResponse } from "@/utils/store-client";

function submitReset(endpoint, values) {
  return fetch(`/api/store/accounts/password-reset/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  }).then(readStoreResponse);
}

export default function PasswordRecovery() {
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setError("");
    if (challengeId && values.password !== values.confirmPassword) {
      setError("Las contraseñas deben coincidir.");
      return;
    }

    setSaving(true);
    try {
      if (challengeId) {
        await submitReset("confirm", { challengeId, code: values.code, password: values.password });
        setDone(true);
      } else {
        setEmail(values.email);
        const result = await submitReset("request", { email: values.email });
        setChallengeId(result.challengeId);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
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
          <Link className="button button--primary" href="/cuenta">Ir a iniciar sesión</Link>
        ) : (
          <form key={challengeId || "request"} method="post" onSubmit={submit}>
            {challengeId ? (
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
                <input autoComplete="email" defaultValue={email} name="email" required type="email" />
              </label>
            )}
            {error && <p className="inline-error field-full" role="alert">{error}</p>}
            <button className="button button--primary field-full" disabled={saving} type="submit">
              {saving ? "Procesando…" : challengeId ? "Cambiar contraseña" : "Enviar código"}
            </button>
            {challengeId && (
              <button className="button button--secondary field-full" disabled={saving} type="button" onClick={() => { setChallengeId(""); setError(""); }}>
                Solicitar otro código
              </button>
            )}
            <Link className="field-full" href="/cuenta">Volver a iniciar sesión</Link>
          </form>
        )}
      </section>
    </main>
  );
}
