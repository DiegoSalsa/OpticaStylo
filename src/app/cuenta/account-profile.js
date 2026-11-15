"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { formatChileanRut } from "@/utils/chilean-rut";
import { readStoreResponse } from "@/utils/store-client";

export default function AccountProfile({ account, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);

  function edit(value) {
    setEditing(value);
    setError("");
    setNotice("");
  }

  async function save(event) {
    event.preventDefault();
    if (pending.current) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => value.trim() !== (account[key] ?? "")));
    if (!Object.keys(changes).length) {
      edit(false);
      return;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await readStoreResponse(await fetch("/api/store/accounts/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      }));
      onUpdated(result);
      setNotice("Guardamos tus datos de contacto.");
      setEditing(false);
    } catch (failure) {
      setError(failure.message);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <section className="account-card account-data" id="datos">
    <div className="account-card-heading"><h2>Mis datos</h2></div>
    <dl>
      <div><dt>Nombre</dt><dd>{account.firstNames} {account.lastNames}</dd></div>
      <div><dt>RUT</dt><dd>{formatChileanRut(account.rut ?? "")}</dd></div>
      <div><dt>Correo para iniciar sesión</dt><dd>{account.email}</dd></div>
      <div><dt>Teléfono</dt><dd>{account.phone || "Sin teléfono registrado"}</dd></div>
      <div><dt>Dirección</dt><dd>{account.address || "Sin dirección registrada"}</dd></div>
    </dl>
    {!editing && <div className="account-card-actions">
      <button className="button button--secondary" type="button" onClick={() => edit(true)}>Editar teléfono y dirección</button>
      <Link href="/contacto">Solicitar cambio de correo</Link>
    </div>}
    {editing && <form onSubmit={save} className="account-profile-form">
      <label className="field"><span>Teléfono</span><input name="phone" autoComplete="tel" defaultValue={account.phone ?? ""} required type="tel" /></label>
      <label className="field"><span>Dirección</span><input name="address" autoComplete="street-address" defaultValue={account.address ?? ""} maxLength={500} required /></label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="account-card-actions">
        <button className="button button--primary" disabled={saving} type="submit">{saving ? "Guardando…" : "Guardar datos"}</button>
        <button className="button button--secondary" disabled={saving} type="button" onClick={() => edit(false)}>Cancelar</button>
      </div>
    </form>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
