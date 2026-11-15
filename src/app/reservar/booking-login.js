"use client";

import Link from "next/link";
import { useState } from "react";
import { readStoreResponse } from "@/utils/store-client";
import styles from "./booking.module.css";

export default function BookingLogin({ onLogin, onRecovery }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function login(event) {
    event.preventDefault();
    if (saving) return;
    const credentials = Object.fromEntries(new FormData(event.currentTarget));
    setSaving(true);
    setError("");
    try {
      const { account } = await readStoreResponse(await fetch("/api/store/accounts/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      }));
      onLogin(account);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.accountHelp}>
      <p>Si ya tienes una cuenta, inicia sesión para usar tus datos. También puedes completar la reserva como invitado.</p>
      {open ? (
        <form method="post" onSubmit={login}>
          <div className={styles.fieldGrid}>
            <div className={styles.field}>
              <label htmlFor="booking-account-email">Correo de tu cuenta</label>
              <input id="booking-account-email" autoComplete="username" name="email" required type="email" />
            </div>
            <div className={styles.field}>
              <label htmlFor="booking-account-password">Contraseña</label>
              <input id="booking-account-password" autoComplete="current-password" name="password" required type="password" />
            </div>
          </div>
          {error && <p className={styles.submitError} role="alert">{error}</p>}
          <div className={styles.accountActions}>
            <button className="button button--primary" disabled={saving} type="submit">{saving ? "Ingresando…" : "Ingresar"}</button>
            <button className="button button--secondary" disabled={saving} onClick={() => { setOpen(false); setError(""); }} type="button">Cancelar</button>
            <Link href="/cuenta/recuperar?desde=reserva" onNavigate={onRecovery}>¿Olvidaste tu contraseña?</Link>
          </div>
        </form>
      ) : (
        <button className="button button--secondary" onClick={() => setOpen(true)} type="button">Iniciar sesión</button>
      )}
    </div>
  );
}
