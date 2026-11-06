"use client";

import { useState } from "react";
import Image from "next/image";
import { readStoreResponse } from "@/utils/store-client";
import styles from "./prescription-details.module.css";

export default function PrescriptionDetails({ endpoint, fileEndpoint = `${endpoint}/file`, label = "Ver receta" }) {
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  async function load() {
    setStatus("loading"); setError("");
    try {
      setResult(await readStoreResponse(await fetch(endpoint, { cache: "no-store" })));
      setStatus("ready");
    } catch (requestError) { setError(requestError.message); setStatus("error"); }
  }
  const data = result?.confirmedData ?? (result?.rightEye ? result : null);
  return <details className={styles.details} onToggle={(event) => {
    if (event.currentTarget.open && status === "idle") void load();
  }}>
    <summary>{label}</summary>
    {status === "loading" && <p role="status">Cargando receta…</p>}
    {error && <p role="alert">{error} <button onClick={load} type="button">Reintentar</button></p>}
    {result && <div>
      <p>{result.source === "CLINICAL" || result.rightEye ? "Prescripción clínica asociada" : "Receta comercial"} · {new Date(result.createdAt ?? result.issuedAt).toLocaleDateString("es-CL")}</p>
      {result.patient && <p>Paciente: {result.patient.firstNames} {result.patient.lastNames}</p>}
      {data?.rightEye && data?.leftEye ? <>
        <div className={styles.scroll}><table><caption>Valores de la receta</caption><thead><tr><th scope="col">Ojo</th><th scope="col">Esfera</th><th scope="col">Cilindro</th><th scope="col">Eje</th><th scope="col">Adición</th></tr></thead><tbody>{[["Ojo derecho", data.rightEye], ["Ojo izquierdo", data.leftEye]].map(([eye, values]) => <tr key={eye}><th scope="row">{eye}</th>{["sphere", "cylinder", "axis", "addition"].map((field) => <td key={field}>{values[field] ?? "—"}</td>)}</tr>)}</tbody></table></div>
        <p>Distancia pupilar: {data.pupillaryDistance ?? "—"}</p>
        {data.fulfillmentNotes && <p>Indicaciones: {data.fulfillmentNotes}</p>}
      </> : <p>Los valores están en el archivo adjunto.</p>}
      {data?.notes && <p>{data.notes}</p>}
      {result.hasImage && <>
        {["image/jpeg", "image/png", "image/webp"].includes(result.mediaType) && !imageFailed && <Image alt="Imagen de la receta registrada" className={styles.image} height={600} onError={() => setImageFailed(true)} src={fileEndpoint} unoptimized width={800} />}
        {imageFailed && <p role="alert">No pudimos mostrar la imagen. Puedes volver a abrir el archivo.</p>}
        <a href={fileEndpoint} rel="noopener noreferrer" target="_blank">Abrir archivo de receta{result.originalFilename ? `: ${result.originalFilename}` : ""}</a>
      </>}
    </div>}
  </details>;
}
