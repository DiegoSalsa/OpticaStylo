"use client";

import Icon from "@/components/ui/icon";
import DiscountAuthorizationPanel from "./discount-authorization-panel";
import { lensMountLabel } from "./pos-form-model";
import PosPaymentPanel from "./pos-payment-panel";
import PosPrescriptionPanel from "./pos-prescription-panel";

export default function PosTicketPanel({ model }) {
  const {
    canEdit,
    canSell,
    cancelQuotation,
    cancelReason,
    checkoutBlockedReason,
    discountAuthorization,
    discountCents,
    discountReason,
    draftIncomplete,
    error,
    lines,
    money,
    notice,
    offersPrescriptionAttachment,
    opticalAdditions,
    pending,
    quantity,
    sale,
    saveOperation,
    setCancelReason,
    setDiscountAuthorization,
    setDiscountCents,
    setDiscountReason,
    subtotal,
    total,
  } = model;

  return (
    <aside className="app-card pos-ticket">
      <div className="ticket-head">
        <div>
          <p className="eyebrow">Detalle</p>
          <h2>{sale ? `Venta N.º ${sale.saleNumber}` : "Nueva venta"}</h2>
        </div>
        {sale && <span className="status-chip">{sale.status}</span>}
      </div>
      <div className="ticket-lines">
        {lines.length === 0 ? (
          <div className="ticket-empty">
            <Icon name="receipt" size={32} />
            <p>Agrega productos para comenzar.</p>
          </div>
        ) : (
          lines.map((line) => (
            <div className="ticket-line" key={line.id}>
              <div>
                <strong>{line.name}</strong>
                <small>{money.format(line.unitPriceCents)} c/u</small>
                {lensMountLabel(line, lines) && (
                  <small className="ticket-line-mount">
                    {lensMountLabel(line, lines)}
                  </small>
                )}
              </div>
              <div className="quantity">
                <button
                  aria-label={`Quitar ${line.name}`}
                  disabled={!canEdit}
                  onClick={() => quantity(line.id, line.quantity - 1)}
                  type="button"
                >
                  −
                </button>
                <span>{line.quantity}</span>
                <button
                  aria-label={`Agregar ${line.name}`}
                  disabled={!canEdit}
                  onClick={() => quantity(line.id, line.quantity + 1)}
                  type="button"
                >
                  +
                </button>
              </div>
              <b>{money.format(line.unitPriceCents * line.quantity)}</b>
            </div>
          ))
        )}
        {opticalAdditions.map((addition, index) => (
          <div
            className="ticket-line ticket-line--addition"
            key={`${addition.name}-${index}`}
          >
            <div>
              <strong>{addition.name}</strong>
              <small>Adicional óptico histórico</small>
            </div>
            <span className="addition-quantity">{addition.quantity}</span>
            <b>{money.format(addition.unitPriceCents * addition.quantity)}</b>
          </div>
        ))}
      </div>
      {!offersPrescriptionAttachment && lines.length > 0 && (
        <p className="prescription-hint">
          La montura se puede vender sola. Puedes adjuntar una receta solo si
          corresponde.
        </p>
      )}
      <PosPrescriptionPanel model={model} />
      <div className="discount-box">
        <label className="field">
          <span>Descuento manual (CLP)</span>
          <input
            disabled={!canEdit}
            min="0"
            onChange={(event) => {
              setDiscountCents(event.target.value);
              setDiscountAuthorization(null);
            }}
            type="number"
            value={discountCents}
          />
        </label>
        {Number(discountCents) > 0 && canEdit && (
          <>
            <label className="field">
              <span>Motivo obligatorio</span>
              <input
                maxLength="300"
                onChange={(event) => {
                  setDiscountReason(event.target.value);
                  setDiscountAuthorization(null);
                }}
                placeholder="Ej.: convenio autorizado"
                value={discountReason}
              />
            </label>
            {discountAuthorization ? (
              <p className="inline-success" role="status">
                Descuento autorizado temporalmente hasta{" "}
                {new Date(discountAuthorization.expiresAt).toLocaleTimeString(
                  "es-CL",
                  { hour: "2-digit", minute: "2-digit" },
                )}
                .
              </p>
            ) : discountReason.trim() ? (
              <DiscountAuthorizationPanel
                amountCents={Number(discountCents)}
                onAuthorized={setDiscountAuthorization}
                reason={discountReason}
              />
            ) : (
              <small>
                Indica el motivo antes de solicitar la autorización puntual.
              </small>
            )}
          </>
        )}
      </div>
      <dl className="ticket-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{money.format(subtotal)}</dd>
        </div>
        {Number(discountCents) > 0 && (
          <div className="discount-row">
            <dt>Descuento</dt>
            <dd>− {money.format(Number(discountCents))}</dd>
          </div>
        )}
        <div>
          <dt>Total</dt>
          <dd>{money.format(total)}</dd>
        </div>
      </dl>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inline-success" role="status">
          {notice}
        </p>
      )}
      {canEdit && (
        <div className="ticket-operation-actions">
          <button
            className="app-button app-button--primary ticket-action"
            disabled={pending || !canSell || draftIncomplete}
            onClick={() => saveOperation("SALE")}
            type="button"
          >
            <Icon name="check" size={16} />{" "}
            {sale ? "Confirmar y cobrar" : "Continuar al cobro"}
          </button>
          <button
            className="app-button app-button--soft ticket-action"
            disabled={pending || !canSell || draftIncomplete}
            onClick={() => saveOperation("QUOTATION")}
            type="button"
          >
            <Icon name="file" size={16} />{" "}
            {sale ? "Guardar cotización" : "Crear cotización"}
          </button>
        </div>
      )}
      {canEdit && checkoutBlockedReason && (
        <p className="prescription-hint">{checkoutBlockedReason}</p>
      )}
      {sale?.status === "QUOTATION" && (
        <div className="quotation-cancel">
          <label className="field">
            <span>Motivo para cancelar</span>
            <input
              maxLength="500"
              onChange={(event) => setCancelReason(event.target.value)}
              value={cancelReason}
            />
          </label>
          <button
            className="app-button app-button--soft"
            disabled={pending || !cancelReason.trim()}
            onClick={cancelQuotation}
            type="button"
          >
            Cancelar cotización
          </button>
        </div>
      )}
      <PosPaymentPanel model={model} />
    </aside>
  );
}
