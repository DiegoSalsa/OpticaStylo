"use client";

import { useEffect, useRef, useState } from "react";
import { createFaceTracking } from "../../face-tracking";
import { SampleWindow } from "@/virtual-try-on-3d/tracking-quality";
import { landmarksToGlassesPose } from "@/utils/virtual-try-on-3d-geometry";

export default function PerformanceValidation({ metadata }) {
  const [backend, setBackend] = useState("worker"), [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState("Seleccionar imagen local"), [report, setReport] = useState(null);
  const input = useRef(null), session = useRef(null);
  useEffect(() => () => session.current?.landmarker.close(), []);
  async function run() {
    setBusy(true); setReport(null);
    let imageUrl;
    try {
      setStatus("Preparando SDK…");
      const tracking = await createFaceTracking("VIDEO", { preferWorker: backend === "worker" });
      session.current = tracking;
      imageUrl = URL.createObjectURL(file);
      const image = new Image(); image.src = imageUrl; await image.decode();
      const cases = [];
      for (const maxDimension of [Infinity, 640, 480, 360]) {
        setStatus(`Midiendo ${Number.isFinite(maxDimension) ? maxDimension : "native"}…`);
        const sdk = new SampleWindow(32), processing = new SampleWindow(32), prep = new SampleWindow(32);
        let faces = 0, lastResult = null, geometry = null;
        for (let i = 0; i < 36; i++) {
          // A real event-loop turn between calls keeps progress visible. No
          // backlog, artificial SDK delay or duplicate VIDEO timestamp.
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const started = performance.now();
          const result = await tracking.landmarker.detectForVideo(image, started, { maxDimension });
          const duration = performance.now() - started;
          if (i >= 4) {
            sdk.add(result.inferenceDurationMs); processing.add(duration); prep.add(result.preprocessingMs);
            if (result.faceLandmarks?.length) faces++;
          }
          lastResult = result;
          if (result.faceLandmarks?.[0]) {
            geometry = {};
            landmarksToGlassesPose(result.faceLandmarks[0], image.naturalWidth, image.naturalHeight,
              metadata, result.facialTransformationMatrixes?.[0], { mirrored: false }, geometry);
          }
        }
        cases.push({ maxDimension: Number.isFinite(maxDimension) ? maxDimension : "native",
          trackingWidth: lastResult.trackingWidth, trackingHeight: lastResult.trackingHeight,
          facesOf32: faces, sdkP50Ms: sdk.percentile(0.5), sdkP95Ms: sdk.percentile(0.95),
          processingP50Ms: processing.percentile(0.5), processingP95Ms: processing.percentile(0.95),
          preprocessingP50Ms: prep.percentile(0.5), geometry });
      }
      setReport({ physicalPhone: false, note: "SDK real con imagen estática local; no mide seguimiento humano ni render 3D.",
        backend: tracking.backend, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight, samplesPerCase: 32, cases });
      setStatus("Medición completada");
    } catch (error) { setStatus(`Error: ${error.message}`); }
    finally { session.current?.landmarker.close(); session.current = null; if (imageUrl) URL.revokeObjectURL(imageUrl); setBusy(false); }
  }
  return <main style={{ padding: 24 }}>
    <h1>Medición local de tracking</h1>
    <p>Comparar el mismo frame completo y reducido. Sólo desarrollo; la imagen se procesa en este dispositivo.</p>
    <label>Backend <select value={backend} onChange={(e) => setBackend(e.target.value)} disabled={busy}>
      <option value="worker">Worker si está disponible</option><option value="main-thread">Main thread</option>
    </select></label>{" "}
    <button onClick={() => input.current.click()} disabled={busy}>Seleccionar imagen</button>{" "}
    <input ref={input} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setFile(e.target.files[0] ?? null)} />
    <button onClick={run} disabled={busy || !file}>Medir resoluciones</button>
    <p role="status" aria-label="Estado de medición">{status}</p>
    {report && <div style={{ overflowX: "auto" }}><table aria-label="Comparación de resoluciones"><thead><tr>
      <th>Entrada</th><th>SDK p50</th><th>SDK p95</th><th>Total p95</th><th>Rostros</th><th>Scale</th><th>Projection</th>
    </tr></thead><tbody>{report.cases.map((c) => <tr key={c.maxDimension}>
      <td>{c.trackingWidth} × {c.trackingHeight}</td><td>{c.sdkP50Ms.toFixed(2)} ms</td><td>{c.sdkP95Ms.toFixed(2)} ms</td>
      <td>{c.processingP95Ms.toFixed(2)} ms</td><td>{c.facesOf32}/32</td>
      <td>{c.geometry?.poseScale?.toFixed(4) ?? "—"}</td><td>{c.geometry?.projectionLength?.toFixed(4) ?? "—"}</td>
    </tr>)}</tbody></table></div>}
    <pre><output aria-label="Resultado de medición">{report ? JSON.stringify(report, null, 2) : ""}</output></pre>
  </main>;
}
