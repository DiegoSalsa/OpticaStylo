"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import BrandLogo from "@/components/brand/brand-logo";
import { readResponse } from "@/components/internal/internal-shell";

export default function LoginExperience() {
  const router = useRouter();
  const searchParams = useSearchParams();
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

  return <main className="login-page">
    <section className="login-panel">
      <Link href="/"><BrandLogo priority /></Link>
      <p className="eyebrow">Aplicación interna</p>
      <h1>Bienvenido de vuelta</h1>
      <p className="login-lead">Ingresa con tu cuenta de Óptica Stylo. Las funciones se muestran según tu rol.</p>
      <form onSubmit={submit}>
        <label>Correo electrónico<input autoComplete="username" name="email" placeholder="nombre@opticastylo.cl" required type="email" /></label>
        <label>Contraseña<input autoComplete="current-password" minLength="12" name="password" required type="password" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button--primary" disabled={pending} type="submit">{pending ? "Ingresando…" : "Ingresar de forma segura"}</button>
      </form>
      <Link className="back-link" href="/">← Volver al sitio público</Link>
    </section>
    <aside className="login-visual"><div><span>STYLO POS</span><h2>Ventas claras.<br />Atención más simple.</h2><p>Una aplicación diseñada para el trabajo real del local.</p></div></aside>
  </main>;
}
