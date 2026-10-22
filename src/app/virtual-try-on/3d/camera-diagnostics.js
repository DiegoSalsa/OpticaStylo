"use client";

import { useEffect, useRef, useState } from "react";
import { VTO_BUILD_IDENTITY } from "@/virtual-try-on-3d/build-identity";
import { cameraTrackSnapshot } from "@/virtual-try-on-3d/camera-acquisition";
import { framePresentation } from "@/virtual-try-on-3d/frame-presentation";
import { technicalReport } from "@/virtual-try-on-3d/technical-report";
import styles from "./virtual-try-on-3d.module.css";

const rectangle = (element) => {
  if (!element?.isConnected) return null;
  const { x, y, width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0 ? { x, y, width, height } : null;
};

// Sólo se monta con ?vtoDebug=1; la vista original comparte el stream local.
export default function CameraDiagnostics({ videoRef, photoImageRef, viewerRef, rendererCanvasRef, metricsRef, cameraStatus, dimensions }) {
  const outputRef = useRef(null), summaryRef = useRef(null), rawRef = useRef(null);
  const [showRaw, setShowRaw] = useState(false);
  useEffect(() => {
    const update = () => {
      const video = videoRef.current, viewer = rectangle(viewerRef.current);
      const videoRect = rectangle(cameraStatus === "photo" ? photoImageRef.current : video), canvasRect = rectangle(rendererCanvasRef.current);
      const width = cameraStatus === "photo" ? dimensions.width : video?.videoWidth;
      const height = cameraStatus === "photo" ? dimensions.height : video?.videoHeight;
      const presentation = framePresentation(width, height, viewer?.width, viewer?.height);
      const alignmentErrorPx = videoRect && canvasRect
        ? Math.max(...["x", "y", "width", "height"].map((key) => Math.abs(videoRect[key] - canvasRect[key]))) : null;
      const camera = metricsRef.current.camera;
      if (camera && video?.srcObject) Object.assign(camera, cameraTrackSnapshot(video.srcObject, camera.supportedConstraints));
      metricsRef.current.presentation = { ...presentation, sourceKind: cameraStatus === "photo" ? "photo" : "camera",
        videoRectangle: videoRect, canvasRectangle: canvasRect, alignmentErrorPx };
      if (outputRef.current) outputRef.current.textContent = JSON.stringify({ build: VTO_BUILD_IDENTITY, cameraStatus,
        videoWidth: video?.videoWidth ?? 0, videoHeight: video?.videoHeight ?? 0, ...technicalReport(metricsRef.current, VTO_BUILD_IDENTITY) }, null, 2);
      const m = metricsRef.current;
      if (summaryRef.current) summaryRef.current.textContent = `Frame ${width ?? 0}×${height ?? 0} · visible ${((presentation?.visibleFraction ?? 0) * 100).toFixed(1)}% · cámara solicitada ${camera?.requestedFacingMode ?? "—"} / real ${camera?.actualFacingMode ?? "no informada"} · zoom ${camera?.zoom?.current ?? "no informado"} · ${m.backend ?? "pendiente"} · FPS cámara ${m.cameraFps?.toFixed(1) ?? "—"} / inferencia ${m.inferenceFps?.toFixed(1) ?? "—"} · estado ${m.trackingState ?? "—"} · edad ${m.resultAgeMs?.toFixed(0) ?? "—"} ms · escala ${m.pixelsPerMm?.toFixed(3) ?? "—"} px/mm (estimada, ${m.scaleSource ?? "—"}, ${m.irisConfidence ?? "—"}) · rostro sí/no ${m.detection?.inferencesWithFace ?? 0}/${m.detection?.inferencesWithoutFace ?? 0} · rechazos pose ${m.detection?.poseConversionRejections ?? 0}`;
    };
    update(); const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [videoRef, photoImageRef, viewerRef, rendererCanvasRef, metricsRef, cameraStatus, dimensions]);
  useEffect(() => {
    const raw = rawRef.current;
    if (showRaw && cameraStatus === "ready" && raw) {
      raw.srcObject = videoRef.current?.srcObject ?? null;
      void raw.play().catch(() => {});
    }
    return () => { if (raw) raw.srcObject = null; };
  }, [showRaw, cameraStatus, videoRef]);
  return <aside className={styles.cameraDiagnostics} aria-label="Diagnóstico de cámara">
    <strong>Build: <code>{VTO_BUILD_IDENTITY.commit}</code></strong>
    <p>{VTO_BUILD_IDENTITY.branch} · {VTO_BUILD_IDENTITY.builtAt} · {VTO_BUILD_IDENTITY.dirty ? "con cambios locales" : "commit sin cambios locales"}</p>
    <p ref={summaryRef} />
    <button type="button" onClick={() => {
      const blob = new Blob([JSON.stringify(technicalReport(metricsRef.current, VTO_BUILD_IDENTITY), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "optica-stylo-diagnostico.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Descargar informe técnico JSON</button>
    <p>FPS y dimensiones medidos; escala y focal estimadas. Intrínsecos ópticos no disponibles. El informe sólo incluye métricas agregadas y no se envía a servidores.</p>
    <details onToggle={(event) => setShowRaw(event.currentTarget.open)}>
      <summary>Ver frame original completo (local, sin espejo)</summary>
      <video ref={rawRef} className={styles.originalFrame} muted playsInline autoPlay aria-label="Frame original sin recortes" />
      <p>Si aquí falta parte de la cara, el problema precede al CSS. Este frame también es la entrada de MediaPipe.</p>
    </details>
    <details><summary>Constraints, ROI, detección y tiempos</summary><pre><output ref={outputRef} aria-label="Diagnóstico completo de cámara" /></pre></details>
    <p>Prueba frontal → trasera → frontal. Compara el frame original con el visor y verifica este SHA antes de evaluar el teléfono.</p>
  </aside>;
}
