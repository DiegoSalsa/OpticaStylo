"use client";

import { PRESCRIPTION_READER_IMAGE_TYPES } from "./pos-form-model";

export default function PosPrescriptionPanel({ model }) {
  const {
    attachPrescription,
    canEdit,
    externalPrescription,
    internalPrescriptions,
    offersPrescriptionAttachment,
    patient,
    pending,
    prescriptionFile,
    prescriptionId,
    prescriptionLookup,
    prescriptionMode,
    prescriptionReader,
    readExternalPrescriptionImage,
    setAttachPrescription,
    setExternalEye,
    setExternalPrescription,
    setExternalPrescriptionId,
    setPrescriptionFile,
    setPrescriptionId,
    setPrescriptionMode,
    setPrescriptionReader,
  } = model;

  return (
    <>
      {offersPrescriptionAttachment && (
        <div className="prescription-field pos-prescription">
          <div className="prescription-heading">
            <strong>Receta opcional para esta venta</strong>
            <p>
              La venta puede continuar sin receta. Si la adjuntas, selecciona
              una interna o ingresa una externa manualmente o con imagen.
            </p>
          </div>
          <label className="field">
            <span>¿Deseas adjuntar una receta?</span>
            <input
              checked={attachPrescription}
              disabled={!canEdit}
              onChange={(event) => setAttachPrescription(event.target.checked)}
              type="checkbox"
            />
          </label>
          {attachPrescription && (
            <>
              <label className="field">
                <span>Origen de la receta</span>
                <select
                  disabled={!canEdit}
                  onChange={(event) => {
                    setPrescriptionMode(event.target.value);
                    setExternalPrescriptionId(null);
                  }}
                  value={prescriptionMode}
                >
                  <option value="internal">Emitida en Óptica Stylo</option>
                  <option value="external">Ingresar receta externa</option>
                </select>
              </label>
              {prescriptionMode === "internal" ? (
                <label className="field">
                  <span>Receta interna activa</span>
                  <select
                    disabled={!canEdit}
                    onChange={(event) => setPrescriptionId(event.target.value)}
                    value={prescriptionId}
                  >
                    <option value="">
                      {prescriptionLookup.loading
                        ? "Consultando recetas…"
                        : "Seleccionar receta"}
                    </option>
                    {internalPrescriptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        Emitida{" "}
                        {new Date(item.issuedAt).toLocaleDateString("es-CL")} ·
                        versión {item.version}
                      </option>
                    ))}
                  </select>
                  {!patient && (
                    <small>Selecciona primero al paciente de la receta.</small>
                  )}
                  {patient &&
                    !prescriptionLookup.loading &&
                    !internalPrescriptions.length && (
                      <small>
                        No hay recetas internas activas y finalizadas para este
                        paciente.
                      </small>
                    )}
                  {prescriptionLookup.error && (
                    <small className="inline-error">
                      {prescriptionLookup.error}
                    </small>
                  )}
                </label>
              ) : (
                <>
                  <label className="field">
                    <span>Imagen opcional de respaldo</span>
                    <input
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      disabled={!canEdit}
                      onChange={(event) => {
                        setPrescriptionFile(event.target.files?.[0] ?? null);
                        setExternalPrescriptionId(null);
                        setPrescriptionReader({
                          file: null,
                          loading: false,
                          result: null,
                        });
                      }}
                      type="file"
                    />
                    <small>
                      Se guarda de forma privada al confirmar la venta. Los
                      valores de abajo deben ser revisados y confirmados por una
                      persona.
                    </small>
                  </label>
                  {prescriptionFile &&
                    PRESCRIPTION_READER_IMAGE_TYPES.has(
                      prescriptionFile.type,
                    ) && (
                      <button
                        className="button button--secondary"
                        disabled={
                          !canEdit ||
                          pending ||
                          prescriptionReader.loading ||
                          prescriptionReader.file === prescriptionFile
                        }
                        onClick={readExternalPrescriptionImage}
                        type="button"
                      >
                        {prescriptionReader.loading
                          ? "Leyendo receta…"
                          : prescriptionReader.file === prescriptionFile
                            ? "Lectura aplicada"
                            : "Leer receta automáticamente"}
                      </button>
                    )}
                  {prescriptionFile &&
                    !PRESCRIPTION_READER_IMAGE_TYPES.has(
                      prescriptionFile.type,
                    ) && (
                      <small>
                        HEIC y HEIF se conservan como respaldo, pero deben
                        completarse manualmente.
                      </small>
                    )}
                  {prescriptionReader.result &&
                    prescriptionReader.file === prescriptionFile && (
                      <div className="inline-success">
                        <strong>
                          Lectura automática:{" "}
                          {prescriptionReader.result.confidence === "HIGH"
                            ? "confianza alta"
                            : prescriptionReader.result.confidence === "MEDIUM"
                              ? "confianza media"
                              : "confianza baja"}
                          .
                        </strong>
                        <span> Revisa todos los campos antes de guardar.</span>
                        {prescriptionReader.result.warnings?.length > 0 && (
                          <ul>
                            {prescriptionReader.result.warnings.map(
                              (warning) => (
                                <li key={warning}>{warning}</li>
                              ),
                            )}
                          </ul>
                        )}
                      </div>
                    )}
                  <div className="pos-eye-grid">
                    <strong />
                    {[
                      ["sphere", "Esfera"],
                      ["cylinder", "Cilindro"],
                      ["axis", "Eje"],
                      ["addition", "Adición"],
                    ].map(([, label]) => (
                      <small key={label}>{label}</small>
                    ))}
                    {[
                      ["rightEye", "OD"],
                      ["leftEye", "OI"],
                    ].map(([side, label]) => (
                      <div key={side} style={{ display: "contents" }}>
                        <strong>{label}</strong>
                        {[
                          ["sphere", false],
                          ["cylinder", false],
                          ["axis", true],
                          ["addition", true],
                        ].map(([field, nullable]) => (
                          <input
                            aria-label={`${label} ${field}`}
                            disabled={!canEdit}
                            key={field}
                            max={field === "axis" ? 180 : undefined}
                            min={field === "axis" ? 0 : undefined}
                            onChange={(event) =>
                              setExternalEye(side, field, event.target.value)
                            }
                            required={!nullable}
                            step={field === "axis" ? 1 : 0.25}
                            type="number"
                            value={externalPrescription[side][field]}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="pos-prescription-extra">
                    <label className="field">
                      <span>Distancia pupilar</span>
                      <input
                        disabled={!canEdit}
                        onChange={(event) => {
                          setExternalPrescriptionId(null);
                          setExternalPrescription({
                            ...externalPrescription,
                            pupillaryDistance: event.target.value,
                          });
                        }}
                        step="0.01"
                        type="number"
                        value={externalPrescription.pupillaryDistance}
                      />
                    </label>
                    <label className="field">
                      <span>Notas de fabricación</span>
                      <input
                        disabled={!canEdit}
                        maxLength="1000"
                        onChange={(event) => {
                          setExternalPrescriptionId(null);
                          setExternalPrescription({
                            ...externalPrescription,
                            fulfillmentNotes: event.target.value,
                          });
                        }}
                        value={externalPrescription.fulfillmentNotes}
                      />
                    </label>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
