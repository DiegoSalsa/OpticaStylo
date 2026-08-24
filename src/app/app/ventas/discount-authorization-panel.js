"use client";

import { useState } from "react";

import { readResponse } from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";

export default function DiscountAuthorizationPanel({ amountCents, reason, onAuthorized }) {
  const [authorizerEmail, setAuthorizerEmail] = useState("");
  const [authorizerPassword, setAuthorizerPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const authorization = await readResponse(await fetch(
        "/api/sales/discount-authorization",
        {
          body: JSON.stringify({
            amountCents,
            authorizerEmail,
            authorizerPassword,
            reason,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      ));
      setAuthorizerPassword("");
      onAuthorized(authorization);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="discount-authorization" onSubmit={submit}>
      <div>
        <strong>Autorización puntual de supervisor</strong>
        <small>El supervisor ingresa sus datos aquí. La aprobación vence en cinco minutos y queda auditada.</small>
      </div>
      <label className="field">
        <span>Correo del supervisor</span>
        <input
          autoComplete="username"
          onChange={(event) => setAuthorizerEmail(event.target.value)}
          required
          type="email"
          value={authorizerEmail}
        />
      </label>
      <label className="field">
        <span>Contraseña del supervisor</span>
        <input
          autoComplete="current-password"
          onChange={(event) => setAuthorizerPassword(event.target.value)}
          required
          type="password"
          value={authorizerPassword}
        />
      </label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="app-button app-button--soft" disabled={pending} type="submit">
        <Icon name="shield" size={16} /> {pending ? "Validando…" : "Autorizar descuento"}
      </button>
    </form>
  );
}
