"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import BrandLogo from "@/components/brand/brand-logo";
import PasswordRecoveryForm from "@/components/auth/password-recovery-form";
import { readResponse } from "@/components/internal/internal-shell";

export default function LoginExperience() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasRecoveryReference = searchParams.has("recoveryRequest")
    || searchParams.has("recoveryToken");
  const [recoveryCredentials] = useState(() => ({
    recoveryRequest: searchParams.get("recoveryRequest"),
    recoveryToken: searchParams.get("recoveryToken"),
  }));
  const [mode, setMode] = useState(hasRecoveryReference ? "RESET" : "LOGIN");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(""); setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await readResponse(await fetch("/api/auth/login", {
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
        headers: { "Content-Type": "application/json" }, method: "POST",
      }));
      const requested = searchParams.get("next");
      router.replace(requested?.startsWith("/app") ? requested : "/app");
      router.refresh();
    } catch (requestError) { setError(requestError.message); setPending(false); }
  }

  function returnToLogin() {
    setError("");
    setMode("LOGIN");
  }

  const copy = mode === "LOGIN"
    ? {
        eyebrow: "Aplicación interna",
        lead: "Ingresa con tu cuenta de Óptica Stylo. Las funciones se muestran según tu rol.",
        title: "Bienvenido de vuelta",
      }
    : mode === "REQUEST"
      ? {
          eyebrow: "Acceso seguro",
          lead: "Escribe tu correo de trabajo. La respuesta será la misma exista o no una cuenta asociada.",
          title: "Recupera tu acceso",
        }
      : {
          eyebrow: "Acceso seguro",
          lead: "Crea una contraseña extensa y distinta de las que utilizas en otros servicios.",
          title: "Nueva contraseña",
        };

  return (
    <main className="login-page">
      <section className="login-panel">
        <Link href="/" aria-label="Ir al inicio de Óptica Stylo"><BrandLogo priority /></Link>
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="login-lead">{copy.lead}</p>
        {mode === "LOGIN" ? (
          <>
            <form onSubmit={submit}>
              <label>
                Correo electrónico
                <input autoComplete="username" name="email" placeholder="nombre@opticastylo.cl" required type="email" />
              </label>
              <label>
                Contraseña
                <input autoComplete="current-password" maxLength={128} name="password" required type="password" />
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="button button--primary" disabled={pending} type="submit">
                {pending ? "Ingresando…" : "Ingresar de forma segura"}
              </button>
            </form>
            <button className="login-recovery-link" onClick={() => setMode("REQUEST")} type="button">
              ¿Olvidaste tu contraseña?
            </button>
          </>
        ) : (
          <PasswordRecoveryForm
            endpointBase="/api/auth"
            flow={mode}
            onBack={returnToLogin}
            recoveryRequest={recoveryCredentials.recoveryRequest}
            recoveryToken={recoveryCredentials.recoveryToken}
          />
        )}
        <Link className="back-link" href="/">← Volver al sitio público</Link>
      </section>
      <aside className={`login-visual ${mode !== "LOGIN" ? "login-visual--recovery" : ""}`}>
        <div>
          <span>{mode === "LOGIN" ? "STYLO POS" : "ACCESO PROTEGIDO"}</span>
          <h2>{mode === "LOGIN" ? <>Ventas claras.<br />Atención más simple.</> : <>Vuelve a tu cuenta.<br />Sin perder el control.</>}</h2>
          <p>{mode === "LOGIN" ? "Una aplicación diseñada para el trabajo real del local." : "El enlace es personal, vence pronto y solo puede utilizarse una vez."}</p>
        </div>
      </aside>
    </main>
  );
}
