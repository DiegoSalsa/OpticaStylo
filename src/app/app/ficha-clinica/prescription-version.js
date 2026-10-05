import { formatOpticalValue } from "./clinical-form-model";

export default function PrescriptionVersion({ item }) {
  return (
    <article className="prescription-version">
      <header>
        <strong>Versión {item.version}</strong>
        <span
          className={
            item.status === "ACTIVE"
              ? "status-chip"
              : "status-chip status-chip--muted"
          }
        >
          {item.status === "ACTIVE" ? "Activa" : "Reemplazada"}
        </span>
      </header>
      <div className="prescription-values" role="table">
        <strong>Ojo</strong>
        <strong>Esfera</strong>
        <strong>Cilindro</strong>
        <strong>Eje</strong>
        <strong>Adición</strong>
        {[
          ["OD", item.rightEye],
          ["OI", item.leftEye],
        ].map(([label, eyeData]) => (
          <div key={label} role="row" style={{ display: "contents" }}>
            <b>{label}</b>
            <span>{formatOpticalValue(eyeData.sphere)}</span>
            <span>{formatOpticalValue(eyeData.cylinder)}</span>
            <span>{formatOpticalValue(eyeData.axis, { axis: true })}</span>
            <span>{formatOpticalValue(eyeData.addition)}</span>
          </div>
        ))}
      </div>
      <p>
        DP: {item.pupillaryDistance ?? "No registrada"}
        {item.fulfillmentNotes ? ` · ${item.fulfillmentNotes}` : ""}
      </p>
      <small>
        Emitida el {new Date(item.issuedAt).toLocaleString("es-CL")} por{" "}
        {item.issuedBy.firstName} {item.issuedBy.lastName}
      </small>
      {item.replacementReason && (
        <small>Motivo del reemplazo: {item.replacementReason}</small>
      )}
    </article>
  );
}
