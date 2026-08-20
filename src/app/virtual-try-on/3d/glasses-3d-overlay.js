"use client";

import { Canvas } from "@react-three/fiber";
import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import {
  DEMO_3D_GLASSES,
  FACE_LANDMARKER_MODEL_URL,
  MEDIAPIPE_WASM_URL,
} from "@/constants/virtual-try-on";
import {
  landmarksToGlassesPose,
  smoothGlassesPose3D,
} from "@/utils/virtual-try-on-3d-geometry";
import { validateTryOnModelMetadata } from "@/virtual-try-on-3d/model-contract";

import styles from "./virtual-try-on-3d.module.css";

const GlassesModel = dynamic(() => import("./glasses-model"), { ssr: false });
const FACE_LOST_GRACE_MS = 280;
const TRACKING_INTERVAL_MS = 50;

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError") {
    return "El permiso fue rechazado. Habilita la cámara para este sitio y vuelve a intentarlo.";
  }
  if (error?.name === "NotFoundError") {
    return "No encontramos una cámara disponible en este dispositivo.";
  }
  if (error?.name === "NotReadableError") {
    return "Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.";
  }
  if (error?.name === "SecurityError") {
    return "El navegador necesita una conexión segura para permitir la cámara.";
  }
  return "No pudimos iniciar la cámara. Inténtalo otra vez o prueba en otro dispositivo.";
}

async function createFaceTracking() {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
  const commonOptions = {
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    numFaces: 1,
    runningMode: "VIDEO",
  };

  let tracking = null;
  let lastError = null;
  const attempts = [
    { delegate: "GPU" },
    { delegate: null },
  ];
  for (const attempt of attempts) {
    try {
      const baseOptions = { modelAssetPath: FACE_LANDMARKER_MODEL_URL };
      if (attempt.delegate) baseOptions.delegate = attempt.delegate;
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...commonOptions,
        baseOptions,
        outputFacialTransformationMatrixes: false,
      });
      tracking = { landmarker };
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!tracking) throw lastError ?? new Error("No se pudo iniciar el seguimiento facial.");

  const faceMeshTriangleIndices = FaceLandmarker.FACE_LANDMARKS_TESSELATION
    .filter((_, index) => index % 3 === 0)
    .flatMap((edge, triangleIndex) => {
      const nextEdge = FaceLandmarker.FACE_LANDMARKS_TESSELATION[triangleIndex * 3 + 1];
      return [edge.start, edge.end, nextEdge.end];
    });
  return { faceMeshTriangleIndices, ...tracking };
}

export default function Glasses3DOverlay() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const runningRef = useRef(false);
  const lastDetectionAtRef = useRef(0);
  const lastFaceSeenAtRef = useRef(0);
  const smoothedPoseRef = useRef(null);
  const cameraRequestRef = useRef(0);
  const poseRef = useRef(null);
  const modelMetadataRef = useRef(null);

  const [cameraStatus, setCameraStatus] = useState("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Te pediremos permiso para usar la cámara de este dispositivo.",
  );
  const [cameraAspectRatio, setCameraAspectRatio] = useState(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [modelMetadata, setModelMetadata] = useState(null);
  const [modelError, setModelError] = useState(false);
  const [faceMeshTriangleIndices, setFaceMeshTriangleIndices] = useState(null);
  const [videoDimensions, setVideoDimensions] = useState({ width: 1280, height: 720 });

  const releaseResources = useCallback(() => {
    cameraRequestRef.current += 1;
    runningRef.current = false;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    for (const track of streamRef.current?.getTracks?.() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.onresize = null;
      videoRef.current.srcObject = null;
    }
    faceLandmarkerRef.current?.close?.();
    faceLandmarkerRef.current = null;
    smoothedPoseRef.current = null;
    poseRef.current = null;
    lastFaceSeenAtRef.current = 0;
  }, []);

  useEffect(() => releaseResources, [releaseResources]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadModelMetadata() {
      try {
        const response = await fetch(DEMO_3D_GLASSES.metadataUrl, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const metadata = validateTryOnModelMetadata(await response.json());
        if (metadata.analysis.status !== "valid") {
          throw new Error("El modelo 3D requiere revisión.");
        }
        modelMetadataRef.current = metadata;
        setModelMetadata(metadata);
      } catch (error) {
        if (error?.name !== "AbortError") setModelError(true);
      }
    }
    void loadModelMetadata();
    return () => controller.abort();
  }, []);

  const stopCamera = useCallback(() => {
    releaseResources();
    setCameraAspectRatio(null);
    setCameraStatus("idle");
    setFaceDetected(false);
    setStatusMessage("Cámara apagada. No guardamos ningún fotograma.");
  }, [releaseResources]);

  const startCamera = useCallback(async () => {
    if (!window.isSecureContext) {
      setCameraStatus("error");
      setStatusMessage("Abre el probador mediante HTTPS para poder usar la cámara.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("error");
      setStatusMessage("Este navegador no permite usar la cámara desde esta página.");
      return;
    }

    releaseResources();
    const requestId = cameraRequestRef.current;
    setCameraAspectRatio(null);
    setCameraStatus("loading");
    setFaceDetected(false);
    setStatusMessage("Esperando que autorices el uso de la cámara…");

    const isMobilePortrait = window.matchMedia(
      "(max-width: 768px) and (orientation: portrait)",
    ).matches;
    const trackingPromise = createFaceTracking().catch(() => null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          aspectRatio: { ideal: isMobilePortrait ? 0.75 : 16 / 9 },
          height: { ideal: isMobilePortrait ? 960 : 720 },
          width: { ideal: isMobilePortrait ? 720 : 1280 },
        },
      });

      if (cameraRequestRef.current !== requestId) {
        for (const track of stream.getTracks()) track.stop();
        const staleTracking = await trackingPromise;
        staleTracking?.landmarker.close?.();
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      const syncDimensions = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          setCameraAspectRatio(video.videoWidth / video.videoHeight);
          setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
        }
      };
      video.onresize = syncDimensions;
      await video.play();
      syncDimensions();
      runningRef.current = true;
      setCameraStatus("ready");
      setStatusMessage("Cámara activa. Preparando el seguimiento facial…");

      let previousFaceState = false;
      const renderFrame = (timestamp) => {
        if (!runningRef.current) return;

        if (
          faceLandmarkerRef.current
          && timestamp - lastDetectionAtRef.current >= TRACKING_INTERVAL_MS
          && video.readyState >= 2
        ) {
          lastDetectionAtRef.current = timestamp;
          let landmarks = null;
          let faceTransform = null;
          try {
            const result = faceLandmarkerRef.current.detectForVideo(video, timestamp);
            landmarks = result.faceLandmarks?.[0] ?? null;
            faceTransform = result.facialTransformationMatrixes?.[0] ?? null;
          } catch {
            landmarks = null;
          }

          if (landmarks) {
            let nextPose = null;
            try {
              nextPose = landmarksToGlassesPose(
                landmarks,
                video.videoWidth,
                video.videoHeight,
                modelMetadataRef.current,
                faceTransform,
              );
            } catch {
              nextPose = null;
            }
            if (nextPose) {
              lastFaceSeenAtRef.current = timestamp;
              smoothedPoseRef.current = smoothGlassesPose3D(
                smoothedPoseRef.current,
                nextPose,
              );
              poseRef.current = smoothedPoseRef.current;
            } else if (timestamp - lastFaceSeenAtRef.current > FACE_LOST_GRACE_MS) {
              poseRef.current = null;
              smoothedPoseRef.current = null;
            }
          } else if (timestamp - lastFaceSeenAtRef.current > FACE_LOST_GRACE_MS) {
            poseRef.current = null;
            smoothedPoseRef.current = null;
          }

          const currentFaceState = Boolean(poseRef.current);
          if (currentFaceState !== previousFaceState) {
            previousFaceState = currentFaceState;
            setFaceDetected(currentFaceState);
          }
        }

        animationFrameRef.current = requestAnimationFrame(renderFrame);
      };
      animationFrameRef.current = requestAnimationFrame(renderFrame);

      const tracking = await trackingPromise;
      if (cameraRequestRef.current !== requestId) {
        tracking?.landmarker.close?.();
        return;
      }
      if (tracking) {
        faceLandmarkerRef.current = tracking.landmarker;
        setFaceMeshTriangleIndices(tracking.faceMeshTriangleIndices);
        setStatusMessage("Cámara activa. Centra tu rostro para probarte el marco.");
      } else {
        setStatusMessage("La cámara funciona, pero el seguimiento facial no pudo cargarse. Recarga la página.");
      }
    } catch (error) {
      void trackingPromise.then((unusedTracking) => unusedTracking?.landmarker.close?.());
      releaseResources();
      setCameraStatus("error");
      setFaceDetected(false);
      setStatusMessage(cameraErrorMessage(error));
    }
  }, [releaseResources]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void startCamera();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [startCamera]);

  const handleModelReady = useCallback(() => setModelReady(true), []);
  const halfWidth = videoDimensions.width / 2;
  const halfHeight = videoDimensions.height / 2;
  const viewerState = cameraStatus === "ready"
    ? (faceDetected ? "tracking" : "searching")
    : cameraStatus;

  return (
    <section className={styles.experience} aria-label="Probador virtual 3D">
      <div className={styles.viewerPanel}>
        <div
          className={styles.viewer}
          data-status={viewerState}
          style={cameraAspectRatio
            ? { "--camera-aspect-ratio": String(cameraAspectRatio) }
            : undefined}
        >
          <video
            className={styles.videoElement}
            ref={videoRef}
            autoPlay
            muted
            playsInline
            data-hidden={cameraStatus !== "ready"}
          />

          {cameraStatus === "ready" && (
            <Canvas
              key={`${videoDimensions.width}x${videoDimensions.height}`}
              className={styles.threeCanvas}
              dpr={[1, 1.5]}
              gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
              orthographic
              camera={{
                left: -halfWidth,
                right: halfWidth,
                top: halfHeight,
                bottom: -halfHeight,
                near: -2000,
                far: 2000,
                position: [0, 0, 500],
              }}
              style={{ pointerEvents: "none" }}
            >
              <hemisphereLight args={["#ffffff", "#52635e", 1.35]} />
              <directionalLight position={[250, 320, 480]} intensity={2.1} />
              <directionalLight position={[-280, 40, 260]} intensity={0.8} />
              <Suspense fallback={null}>
                {modelMetadata && (
                  <GlassesModel
                    faceMeshTriangleIndices={faceMeshTriangleIndices}
                    modelMetadata={modelMetadata}
                    modelUrl={DEMO_3D_GLASSES.modelUrl}
                    onReady={handleModelReady}
                    poseRef={poseRef}
                  />
                )}
              </Suspense>
            </Canvas>
          )}

          <div className={styles.focusGuide} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>

          {cameraStatus !== "ready" && (
            <div className={styles.viewerPlaceholder}>
              <span className={styles.placeholderIcon} aria-hidden="true">
                <span />
              </span>
              <strong>
                {cameraStatus === "loading" ? "Autoriza tu cámara" : "Activa tu cámara"}
              </strong>
              <span>
                {cameraStatus === "loading"
                  ? "Acepta el permiso que muestra tu navegador."
                  : "Tu imagen se procesa solo en este dispositivo."}
              </span>
            </div>
          )}

          {cameraStatus === "ready" && !faceDetected && (
            <div className={styles.faceHint}>
              <span aria-hidden="true" />
              Centra tu rostro y mira de frente
            </div>
          )}

          {cameraStatus === "ready" && (!modelReady || modelError) && (
            <div className={styles.modelLoading}>
              {modelError ? "El marco 3D necesita revisión." : "Preparando el marco 3D…"}
            </div>
          )}

          <div className={styles.liveBadge} data-active={cameraStatus === "ready"}>
            <span aria-hidden="true" />
            {cameraStatus === "ready" ? "En vivo" : "Cámara apagada"}
          </div>
          <div className={styles.trackingBadge} data-active={faceDetected}>
            <span aria-hidden="true">{faceDetected ? "✓" : "⌁"}</span>
            {faceDetected ? "Ajuste listo" : "Buscando rostro"}
          </div>
        </div>

        <div className={styles.viewerFooter}>
          <p className={styles.status} aria-live="polite">{statusMessage}</p>
          {cameraStatus === "ready" ? (
            <button className={styles.cameraButton} type="button" onClick={stopCamera}>
              Apagar cámara
            </button>
          ) : (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={startCamera}
              disabled={cameraStatus === "loading"}
            >
              {cameraStatus === "loading" ? "Esperando permiso…" : "Activar cámara"}
            </button>
          )}
        </div>
      </div>

      <aside className={styles.controlsPanel}>
        <div className={styles.modelHeader}>
          <div className={styles.modelIcon} aria-hidden="true">
            <span />
            <span />
          </div>
          <div>
            <p className={styles.stepLabel}>Marco de prueba</p>
            <h2>{DEMO_3D_GLASSES.name}</h2>
            <p className={styles.modelLabel}>{DEMO_3D_GLASSES.sku} · Modelo 3D real</p>
          </div>
        </div>

        <div className={styles.autoFitCard} data-active={faceDetected}>
          <span className={styles.autoFitIcon} aria-hidden="true">
            {faceDetected ? "✓" : "⌁"}
          </span>
          <div>
            <p className={styles.stepLabel}>Calce automático</p>
            <strong>{faceDetected ? "Ajustado a tu rostro" : "Esperando tu rostro"}</strong>
            <p>
              El ancho, la posición y la perspectiva se calculan en tiempo real.
            </p>
          </div>
        </div>

        <div className={styles.tipsCard}>
          <p className={styles.stepLabel}>Para verlo mejor</p>
          <ul>
            <li>Mantén el rostro completo dentro del cuadro.</li>
            <li>Busca luz frontal y evita una ventana detrás.</li>
            <li>Gira suavemente para apreciar las patillas.</li>
          </ul>
        </div>

        <div className={styles.panelFooter}>
          <a href="/virtual-try-on" className={styles.linkCard}>
            <span aria-hidden="true">←</span>
            Probar otros marcos en 2D
          </a>
          <div className={styles.privacyNote}>
            <span aria-hidden="true">●</span>
            <p><strong>Privado por diseño.</strong> El video no sale de tu dispositivo.</p>
          </div>
        </div>
      </aside>
    </section>
  );
}
