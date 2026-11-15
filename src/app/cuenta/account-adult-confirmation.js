"use client";

import { useRef, useState } from "react";
import { readStoreResponse } from "@/utils/store-client";

export default function AccountAdultConfirmation({ onConfirmed, onLogout }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function logout() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await readStoreResponse(await fetch("/api/store/accounts/logout", { method: "POST" }));
      onLogout();
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(false); }
  }
  async function confirm(event) {
    event.preventDefault();
    if (pending.current) return;
    const birthDate = new FormData(event.currentTarget).get("birthDate");
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      onConfirmed(await readStoreResponse(await fetch("/api/store/accounts/me/age", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ birthDate }),
      })));
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <main className="account-page"><section className="account-card">
    <h1>Completa los datos del titular</h1>
    <p>Las cuentas pertenecen a adultos. Puedes añadir a los menores que tengas a tu cargo desde tu cuenta.</p>
    <form className="clinical-link-form" onSubmit={confirm}>
      <label className="field"><span>Tu fecha de nacimiento</span><input autoComplete="bday" name="birthDate" required type="date" disabled={busy} /></label>
      <button className="button button--primary" type="submit" disabled={busy}>Guardar y continuar</button>
    </form>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <button className="button button--secondary" disabled={busy} onClick={logout} type="button">Cerrar sesión</button>
  </section></main>;
}
