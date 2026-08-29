"use client";

import { useEffect, useState } from "react";

import Icon from "@/components/ui/icon";

import styles from "./password-recovery-form.module.css";

async function readRecoveryResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(
      payload?.error?.message
      ?? "No fue posible completar la solicitud. Inténtalo nuevamente.",
    );
  }
  return payload.data;
}

export default function PasswordRecoveryForm({
  endpointBase,
  flow,
  onBack,
  recoveryRequest = null,
  recoveryToken = null,
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(null);
  const hasValidResetReference = Boolean(recoveryRequest && recoveryToken);

  useEffect(() => {
    if (flow === "RESET" && typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [flow]);

  async function requestRecovery(event) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await readRecoveryResponse(await fetch(`${endpointBase}/password-recovery`, {
        body: JSON.stringify({ email: form.get("email") }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }));
      setResult(response.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  async function resetPassword(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    if (password !== form.get("passwordConfirmation")) {
      setError("Las contraseñas deben coincidir.");
      return;
    }
    setPending(true);
    try {
      const response = await readRecoveryResponse(await fetch(`${endpointBase}/password-reset`, {
        body: JSON.stringify({
          password,
          recoveryRequest,
          recoveryToken,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }));
      setResult(response.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <section className={styles.result} role="status">
        <span className={styles.resultIcon}><Icon name="check" size={24} /></span>
        <div>
          <strong>{flow === "RESET" ? "Contraseña actualizada" : "Revisa tu correo"}</strong>
          <p>{result}</p>
        </div>
        <button className={`button button--primary ${styles.fullButton}`} onClick={onBack} type="button">
          {flow === "RESET" ? "Volver a ingresar" : "Entendido"}
        </button>
      </section>
    );
  }

  if (flow === "RESET" && !hasValidResetReference) {
    return (
      <section className={styles.result} role="alert">
        <span className={`${styles.resultIcon} ${styles.resultIconMuted}`}>
          <Icon name="shield" size={24} />
        </span>
        <div>
          <strong>El enlace no es válido</strong>
          <p>Solicita un nuevo correo de recuperación para continuar de forma segura.</p>
        </div>
        <button className={`button button--primary ${styles.fullButton}`} onClick={onBack} type="button">
          Solicitar otro enlace
        </button>
      </section>
    );
  }

  return (
    <div className={styles.recoveryShell}>
      <form className={styles.form} onSubmit={flow === "RESET" ? resetPassword : requestRecovery}>
        {flow === "REQUEST" ? (
          <label className={styles.field}>
            <span>Correo electrónico</span>
            <input
              autoComplete="email"
              autoFocus
              name="email"
              placeholder="nombre@correo.cl"
              required
              type="email"
            />
          </label>
        ) : (
          <>
            <label className={styles.field}>
              <span>Nueva contraseña</span>
              <input
                autoComplete="new-password"
                autoFocus
                maxLength={128}
                minLength={15}
                name="password"
                required
                type="password"
              />
              <small>Usa entre 15 y 128 caracteres.</small>
            </label>
            <label className={styles.field}>
              <span>Confirmar contraseña</span>
              <input
                autoComplete="new-password"
                maxLength={128}
                minLength={15}
                name="passwordConfirmation"
                required
                type="password"
              />
            </label>
          </>
        )}
        <p
          aria-live="polite"
          className={error ? styles.error : styles.status}
          role={error ? "alert" : "status"}
        >
          {error}
        </p>
        <button className={`button button--primary ${styles.fullButton}`} disabled={pending} type="submit">
          {pending
            ? "Procesando…"
            : flow === "RESET"
              ? "Guardar nueva contraseña"
              : "Enviar instrucciones"}
        </button>
      </form>
      <button className={styles.backButton} disabled={pending} onClick={onBack} type="button">
        <span aria-hidden="true">←</span> Volver al ingreso
      </button>
    </div>
  );
}
