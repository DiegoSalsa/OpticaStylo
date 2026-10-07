"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Canvas } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { createFaceTracking } from "../../face-tracking";
import { MetricWindow } from "@/virtual-try-on-3d/tracking-performance";
import { TrackingTimeline } from "@/virtual-try-on-3d/tracking-timeline";
import { PoseFilter } from "@/virtual-try-on-3d/pose-filter";
import { cameraProjection } from "@/virtual-try-on-3d/camera-projection";
import { landmarksToGlassesPose } from "@/utils/virtual-try-on-3d-geometry";
import styles from "../../virtual-try-on-3d.module.css";

const GlassesModel = dynamic(() => import("../../glasses-model"), { ssr: false });
const noop = () => {};

// Development-only fixture harness. Real SDK and real RB2140 renderer; a static
// local image supplies frames at 30 Hz. It cannot measure human tracking lag.
export default function PerformanceValidation({ metadata, modelUrl, lensOpacity, lensTintStrength }) {
  const [backend, setBackend] = useState("worker"), [url, setUrl] = useState(""), [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState("Seleccionar imagen local"), [report, setReport] = useState(null);
  const [triangles, setTriangles] = useState(null);
  const imageRef = useRef(null), inputRef = useRef(null), sessionRef = useRef(null), aliveRef = useRef(true);
  const poseRef = useRef(null), filterRef = useRef(null), metricsRef = useRef({});
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; sessionRef.current?.landmarker.close(); }; }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function run() {
    setBusy(true); setReport(null);
    try {
      setStatus("Preparando SDK y renderer…");
      const tracking = await createFaceTracking("VIDEO", { preferWorker: backend === "worker" });
      sessionRef.current = tracking; setTriangles(tracking.faceMeshTriangleIndices);
      const cases = [], image = imageRef.current;
      for (const maxDimension of [Infinity, 640, 480, 360]) {
        if (!aliveRef.current) break;
        setStatus(`Midiendo ${Number.isFinite(maxDimension) ? maxDimension : "native"} con WebGL…`);
        const sdk = new MetricWindow(48), delivery = new MetricWindow(48), latency = new MetricWindow(48), preprocessing = new MetricWindow(48), renders = new MetricWindow(48);
        const timeline = new TrackingTimeline(1), filter = new PoseFilter(); filterRef.current = filter;
        let completed = 0, lastDelivered = null, faces = 0, lastResult, lastPose;
        await new Promise((resolve, reject) => {
          let stopped = false;
          const tick = (now) => {
            if (stopped) return;
            if (!aliveRef.current) { stopped = true; resolve(); return; }
            const cameraFrame = Math.floor(now / (1000 / 30));
            if (timeline.observe(cameraFrame) && timeline.begin(now, 1000 / 30 - 1)) {
              const infer = async () => {
                try {
                  const result = await tracking.landmarker.detectForVideo(image, now, { maxDimension });
                  timeline.finish(now, performance.now() - now);
                  const pose = landmarksToGlassesPose(result.faceLandmarks?.[0], result.sourceWidth, result.sourceHeight,
                    metadata, result.facialTransformationMatrixes?.[0], { mirrored: false });
                  filter.update(pose, now); poseRef.current = pose;
                  const deliveredAt = performance.now();
                  if (completed >= 8) {
                    sdk.add(result.inferenceDurationMs); preprocessing.add(result.preprocessingMs);
                    latency.add(deliveredAt - now);
                    if (lastDelivered !== null) delivery.add(deliveredAt - lastDelivered);
                    renders.add(metricsRef.current.renderFps);
                    if (pose) faces++;
                  }
                  lastDelivered = deliveredAt; lastResult = result; lastPose = pose; completed++;
                  if (completed >= 56) { stopped = true; resolve(); }
                } catch (error) { stopped = true; reject(error); }
              };
              void infer();
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        if (!lastResult) continue;
        cases.push({ maxDimension: Number.isFinite(maxDimension) ? maxDimension : "native",
          trackingWidth: lastResult.trackingWidth, trackingHeight: lastResult.trackingHeight, facesOf48: faces,
          inferenceP50Ms: sdk.stats().p50, inferenceP95Ms: sdk.stats().p95,
          deliveryP50Ms: delivery.stats().p50, deliveryP95Ms: delivery.stats().p95,
          latencyP50Ms: latency.stats().p50, latencyP95Ms: latency.stats().p95,
          preprocessingP50Ms: preprocessing.stats().p50, renderFps: renders.stats().p50,
          scale: lastPose?.diagnostics });
      }
      if (aliveRef.current) {
        setReport({ physicalPhone: false, note: "Windows: SDK real + WebGL RB2140, imagen estática a 30 Hz; no mide seguimiento humano ni teléfono físico.",
          backend: tracking.backend, sourceWidth: source.width, sourceHeight: source.height, samplesPerCase: 48,
          graphics: { dpr: 1, environmentResolution: 64, antialias: true }, cases });
        setStatus("Medición completada");
      }
    } catch (error) { if (aliveRef.current) setStatus(`Error: ${error.message}`); }
    finally { sessionRef.current?.landmarker.close(); sessionRef.current = null; if (aliveRef.current) setBusy(false); }
  }
  const projection = source && cameraProjection(source.width, source.height);
  return <main style={{ maxWidth: 800, margin: "80px auto 40px", padding: 16 }}>
    <h1>Validación del rebuild móvil</h1>
    <p>SDK real y marco RB2140. Frame local estático; sólo desarrollo.</p>
    <label>Backend <select value={backend} onChange={(e) => setBackend(e.target.value)} disabled={busy}>
      <option value="worker">Worker si está disponible</option><option value="main-thread">Main thread</option>
    </select></label>{" "}
    <button onClick={() => inputRef.current.click()} disabled={busy}>Seleccionar imagen</button>{" "}
    <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
      const file = e.target.files?.[0]; if (!file) return;
      setSource(null); setUrl(URL.createObjectURL(file)); poseRef.current = null; filterRef.current = null;
    }} />
    <button onClick={run} disabled={busy || !source}>Medir resoluciones</button>
    <p role="status" aria-label="Estado de medición">{status}</p>
    {url && <div className={styles.viewer} style={{ "--camera-aspect-ratio": source ? String(source.width / source.height) : "0.75" }}>
      <div className={styles.mediaLayer}>
        <Image ref={imageRef} src={url} alt="Fixture portrait del rebuild" fill unoptimized sizes="100vw" className={styles.photoElement}
          onLoad={() => setSource({ width: imageRef.current.naturalWidth, height: imageRef.current.naturalHeight })} />
        {source && <Canvas className={styles.threeCanvas} dpr={1} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
          camera={{ fov: projection.fovDegrees, near: 1, far: projection.focalPx * 5, position: [0, 0, projection.focalPx] }}>
          <hemisphereLight args={["#ffffff", "#52635e", 1.05]} />
          <directionalLight position={[250, 320, 480]} intensity={1.7} /><directionalLight position={[-280, 40, 260]} intensity={0.65} />
          <Environment resolution={64}>
            <Lightformer color="#ffffff" form="rect" intensity={3.4} position={[0, 4, 6]} scale={[8, 3, 1]} />
            <Lightformer color="#d9eee7" form="rect" intensity={2.1} position={[-5, 1, 2]} rotation={[0, Math.PI / 2, 0]} scale={[4, 5, 1]} />
            <Lightformer color="#f1d8b8" form="rect" intensity={1.5} position={[5, -1, 1]} rotation={[0, -Math.PI / 2, 0]} scale={[3, 4, 1]} />
          </Environment>
          <Suspense fallback={null}><GlassesModel faceMeshTriangleIndices={triangles} modelMetadata={metadata} modelUrl={modelUrl}
            lensOpacity={lensOpacity} lensTintStrength={lensTintStrength} poseRef={poseRef} poseFilterRef={filterRef} debugMetricsRef={metricsRef} onReady={noop} /></Suspense>
        </Canvas>}
      </div>
    </div>}
    {report && <div style={{ overflowX: "auto" }}><table aria-label="Comparación de resoluciones"><thead><tr>
      <th>Entrada</th><th>SDK p50/p95</th><th>Entrega p50/p95</th><th>Render FPS</th><th>Rostros</th><th>Ratio marco/rostro</th>
    </tr></thead><tbody>{report.cases.map((c) => <tr key={c.maxDimension}>
      <td>{c.trackingWidth} × {c.trackingHeight}</td><td>{c.inferenceP50Ms.toFixed(2)} / {c.inferenceP95Ms.toFixed(2)}</td>
      <td>{c.deliveryP50Ms.toFixed(2)} / {c.deliveryP95Ms.toFixed(2)}</td><td>{c.renderFps?.toFixed(1)}</td>
      <td>{c.facesOf48}/48</td><td>{c.scale?.frameToFaceRatio.toFixed(5)}</td>
    </tr>)}</tbody></table></div>}
    <pre style={{ overflowX: "auto" }}><output aria-label="Resultado de medición">{report ? JSON.stringify(report, null, 2) : ""}</output></pre>
  </main>;
}
