"use client";

import { useEffect, useRef, useState } from "react";
import { VTO_BUILD_IDENTITY } from "@/virtual-try-on-3d/build-identity";
import { cameraTrackSnapshot } from "@/virtual-try-on-3d/camera-acquisition";
import { framePresentation } from "@/virtual-try-on-3d/frame-presentation";
import styles from "./virtual-try-on-3d.module.css";

const rectangle = (element) => {
  if (!element?.isConnected) return null;
  const { x, y, width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0 ? { x, y, width, height } : null;
};

// Mounted exclusively by ?vtoDebug=1. This preview shares the original stream;
// it neither crops frames nor sends them anywhere nor stops the camera track.
export default function CameraDiagnostics({ videoRef, viewerRef, rendererCanvasRef, metricsRef, cameraStatus, dimensions }) {
  const outputRef = useRef(null), summaryRef = useRef(null), rawRef = useRef(null);
  const [showRaw, setShowRaw] = useState(false);
  useEffect(() => {
    const update = () => {
      const video = videoRef.current, viewer = rectangle(viewerRef.current);
      const videoRect = rectangle(video), canvasRect = rectangle(rendererCanvasRef.current);
      const width = cameraStatus === "photo" ? dimensions.width : video?.videoWidth;
      const height = cameraStatus === "photo" ? dimensions.height : video?.videoHeight;
      const presentation = framePresentation(width, height, viewer?.width, viewer?.height);
      const alignmentErrorPx = videoRect && canvasRect
        ? Math.max(...["x", "y", "width", "height"].map((key) => Math.abs(videoRect[key] - canvasRect[key]))) : null;
      const camera = metricsRef.current.camera;
      if (camera && video?.srcObject) Object.assign(camera, cameraTrackSnapshot(video.srcObject, camera.supportedConstraints));
      metricsRef.current.presentation = { ...presentation, videoRectangle: videoRect, canvasRectangle: canvasRect, alignmentErrorPx };
      if (outputRef.current) outputRef.current.textContent = JSON.stringify({ build: VTO_BUILD_IDENTITY, cameraStatus,
        videoWidth: video?.videoWidth ?? 0, videoHeight: video?.videoHeight ?? 0, ...metricsRef.current }, null, 2);
      if (summaryRef.current) summaryRef.current.textContent = `Frame ${width ?? 0}×${height ?? 0} · fuente visible ${((presentation?.visibleFraction ?? 0) * 100).toFixed(1)}% · cámara real ${camera?.actualFacingMode ?? "no informada"} · zoom ${camera?.zoom?.current ?? "no informado"} · backend ${metricsRef.current.backend ?? "pendiente"}`;
    };
    update(); const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [videoRef, viewerRef, rendererCanvasRef, metricsRef, cameraStatus, dimensions]);
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
    <details onToggle={(event) => setShowRaw(event.currentTarget.open)}>
      <summary>Ver frame original completo (local, sin espejo)</summary>
      <video ref={rawRef} className={styles.originalFrame} muted playsInline autoPlay aria-label="Frame original sin recortes" />
      <p>Si aquí falta parte de la cara, el problema precede al CSS. Este frame también es la entrada de MediaPipe.</p>
    </details>
    <details><summary>Constraints, ROI, detección y tiempos</summary><pre><output ref={outputRef} aria-label="Diagnóstico completo de cámara" /></pre></details>
    <p>Prueba frontal → trasera → frontal. Compara el frame original con el visor y verifica este SHA antes de evaluar el teléfono.</p>
  </aside>;
}
