"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";

import {
  DEFAULT_3D_CALIBRATION,
  DEMO_3D_GLASSES,
  FACE_LANDMARKER_MODEL_URL,
  MEDIAPIPE_WASM_URL,
} from "@/constants/virtual-try-on";
import {
  landmarksToGlassesPose,
  smoothGlassesPose3D,
} from "@/utils/virtual-try-on-3d-geometry";

import styles from "./virtual-try-on-3d.module.css";

const GlassesModel = dynamic(() => import("./glasses-model"), { ssr: false });

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError") {
    return "El permiso fue rechazado. Habilita la cámara para este sitio y presiona Reintentar permiso.";
  }
  if (error?.name === "NotFoundError") {
    return "No se encontró una cámara disponible en este dispositivo.";
  }
  if (error?.name === "NotReadableError") {
    return "Otra aplicación está usando la cámara. Ciérrala e inténtalo nuevamente.";
  }
  if (error?.name === "SecurityError") {
    return "El navegador exige una conexión HTTPS para permitir la cámara.";
  }
  return "No fue posible iniciar la cámara. Puedes volver a intentarlo o usar otro dispositivo.";
}

async function createFaceLandmarker() {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
  const options = {
    baseOptions: {
      delegate: "GPU",
      modelAssetPath: FACE_LANDMARKER_MODEL_URL,
    },
    minFaceDetectionConfidence: 0.55,
    minFacePresenceConfidence: 0.55,
    minTrackingConfidence: 0.5,
    numFaces: 1,
    runningMode: "VIDEO",
  };

  try {
    return await FaceLandmarker.createFromOptions(vision, options);
  } catch {
    return FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL },
    });
  }
}

export default function Glasses3DOverlay() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const runningRef = useRef(false);
  const lastDetectionAtRef = useRef(0);
  const latestLandmarksRef = useRef(null);
  const smoothedPoseRef = useRef(null);
  const cameraRequestRef = useRef(0);
  const calibrationRef = useRef(DEFAULT_3D_CALIBRATION);

  // Shared ref that the Three.js GlassesModel reads every frame
  const poseRef = useRef(null);

  const [calibration, setCalibration] = useState(DEFAULT_3D_CALIBRATION);
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Solicitaremos permiso para usar la cámara en este dispositivo.",
  );
  const [cameraAspectRatio, setCameraAspectRatio] = useState(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState({ width: 1280, height: 720 });

  // Keep calibration ref in sync
  useEffect(() => {
    calibrationRef.current = calibration;
    smoothedPoseRef.current = null;
  }, [calibration]);

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
    latestLandmarksRef.current = null;
    smoothedPoseRef.current = null;
    poseRef.current = null;
  }, []);

  useEffect(() => releaseResources, [releaseResources]);

  const stopCamera = useCallback(() => {
    releaseResources();
    setCameraAspectRatio(null);
    setCameraStatus("idle");
    setFaceDetected(false);
    setStatusMessage("La cámara está apagada.");
  }, [releaseResources]);

  // ── Tracking loop (runs inside rAF, updates poseRef) ─────────────────
  const updatePose = useCallback(() => {
    const landmarks = latestLandmarksRef.current;
    const video = videoRef.current;
    if (!video) return;

    const raw = landmarksToGlassesPose(
      landmarks,
      video.videoWidth,
      video.videoHeight,
      calibrationRef.current,
    );

    if (raw) {
      smoothedPoseRef.current = smoothGlassesPose3D(smoothedPoseRef.current, raw);
      poseRef.current = smoothedPoseRef.current;
    } else {
      poseRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (!window.isSecureContext) {
      setCameraStatus("error");
      setStatusMessage(
        "La cámara no puede solicitarse desde una dirección HTTP de red. Abre el probador mediante HTTPS.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("error");
      setStatusMessage("Este navegador no permite acceder a la cámara desde esta página.");
      return;
    }

    releaseResources();
    const requestId = cameraRequestRef.current;
    setCameraAspectRatio(null);
    setCameraStatus("loading");
    setStatusMessage("Esperando que autorices el uso de la cámara…");

    const isMobilePortrait = window.matchMedia(
      "(max-width: 768px) and (orientation: portrait)",
    ).matches;
    const landmarkerPromise = createFaceLandmarker().catch(() => null);

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
        const staleLandmarker = await landmarkerPromise;
        staleLandmarker?.close?.();
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
      setStatusMessage("Cámara activa. Preparando la alineación 3D…");

      let previousFaceState = false;
      const renderFrame = (timestamp) => {
        if (!runningRef.current) return;
        if (
          faceLandmarkerRef.current
          && timestamp - lastDetectionAtRef.current >= 50
          && video.readyState >= 2
        ) {
          lastDetectionAtRef.current = timestamp;
          try {
            const result = faceLandmarkerRef.current.detectForVideo(video, timestamp);
            latestLandmarksRef.current = result.faceLandmarks?.[0] ?? null;
          } catch {
            latestLandmarksRef.current = null;
          }
        }
        const currentFaceState = Boolean(latestLandmarksRef.current);
        if (currentFaceState !== previousFaceState) {
          previousFaceState = currentFaceState;
          setFaceDetected(currentFaceState);
        }
        updatePose();
        animationFrameRef.current = requestAnimationFrame(renderFrame);
      };
      animationFrameRef.current = requestAnimationFrame(renderFrame);

      const landmarker = await landmarkerPromise;
      if (cameraRequestRef.current !== requestId) {
        landmarker?.close?.();
        return;
      }
      if (landmarker) {
        faceLandmarkerRef.current = landmarker;
        setStatusMessage("Cámara activa. Mira de frente para alinear los lentes 3D.");
      } else {
        setStatusMessage("Cámara activa pero el modelo facial no pudo cargarse. Intenta recargar.");
      }
    } catch (error) {
      void landmarkerPromise.then((unused) => unused?.close?.());
      releaseResources();
      setCameraStatus("error");
      setFaceDetected(false);
      setStatusMessage(cameraErrorMessage(error));
    }
  }, [updatePose, releaseResources]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void startCamera();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [startCamera]);

  const updateCalibration = (field, value) => {
    setCalibration((current) => ({ ...current, [field]: Number(value) }));
  };

  // Half-dimensions for the orthographic camera (matches pixel space)
  const halfW = videoDimensions.width / 2;
  const halfH = videoDimensions.height / 2;

  return (
    <section className={styles.experience} aria-label="Probador virtual 3D">
      <div className={styles.viewerPanel}>
        <div
          className={styles.viewer}
          data-status={cameraStatus}
          style={cameraAspectRatio
            ? { "--camera-aspect-ratio": String(cameraAspectRatio) }
            : undefined}
        >
          {/* Live video background (mirrored via CSS) */}
          <video
            className={styles.videoElement}
            ref={videoRef}
            autoPlay
            muted
            playsInline
            data-hidden={cameraStatus !== "ready"}
          />

          {/* Three.js overlay – transparent background */}
          {cameraStatus === "ready" && (
            <Canvas
              className={styles.threeCanvas}
              gl={{ alpha: true, antialias: true }}
              orthographic
              camera={{
                left: -halfW,
                right: halfW,
                top: halfH,
                bottom: -halfH,
                near: -1000,
                far: 1000,
                position: [0, 0, 500],
              }}
              style={{ pointerEvents: "none" }}
            >
              <ambientLight intensity={0.8} />
              <directionalLight position={[0, 200, 400]} intensity={1.2} />
              <directionalLight position={[-200, -100, 300]} intensity={0.4} />
              <Suspense fallback={null}>
                <GlassesModel
                  modelUrl={DEMO_3D_GLASSES.modelUrl}
                  poseRef={poseRef}
                />
              </Suspense>
            </Canvas>
          )}

          {cameraStatus !== "ready" && (
            <div className={styles.viewerPlaceholder}>
              <span className={styles.placeholderIcon} aria-hidden="true">◎</span>
              <strong>
                {cameraStatus === "loading" ? "Autoriza tu cámara" : "Necesitamos tu cámara"}
              </strong>
              <span>
                {cameraStatus === "loading"
                  ? "Acepta el permiso que muestra tu navegador."
                  : "Tu video se procesa solamente en este dispositivo."}
              </span>
            </div>
          )}
          {cameraStatus === "ready" && !faceDetected && (
            <div className={styles.faceHint}>Centra tu rostro y mira hacia la cámara</div>
          )}
          <div className={styles.liveBadge} data-active={cameraStatus === "ready"}>
            <span aria-hidden="true" />
            {cameraStatus === "ready" ? "Cámara activa" : "Cámara apagada"}
          </div>
          {cameraStatus === "ready" && (
            <div className={styles.badge3d}>3D</div>
          )}
        </div>

        <div className={styles.actionBar}>
          {cameraStatus === "ready" ? (
            <button className={styles.secondaryButton} type="button" onClick={stopCamera}>
              Apagar cámara
            </button>
          ) : (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={startCamera}
              disabled={cameraStatus === "loading"}
            >
              {cameraStatus === "loading" ? "Esperando permiso…" : "Reintentar permiso"}
            </button>
          )}
        </div>
        <p className={styles.status} aria-live="polite">{statusMessage}</p>
      </div>

      <aside className={styles.controlsPanel}>
        <div>
          <p className={styles.stepLabel}>Modelo 3D</p>
          <h2>{DEMO_3D_GLASSES.name}</h2>
          <p className={styles.modelLabel}>{DEMO_3D_GLASSES.sku}</p>
        </div>

        <div className={styles.controlGroup}>
          <p className={styles.stepLabel}>Calibración 3D</p>

          <label className={styles.sliderLabel}>
            <span>Escala <output>{Math.round(calibration.scaleMultiplier * 100)}%</output></span>
            <input
              type="range"
              min="0.3"
              max="3"
              step="0.05"
              value={calibration.scaleMultiplier}
              onChange={(e) => updateCalibration("scaleMultiplier", e.target.value)}
            />
          </label>
          <label className={styles.sliderLabel}>
            <span>Posición vertical <output>{calibration.positionOffsetY.toFixed(2)}</output></span>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={calibration.positionOffsetY}
              onChange={(e) => updateCalibration("positionOffsetY", e.target.value)}
            />
          </label>
          <label className={styles.sliderLabel}>
            <span>Posición horizontal <output>{calibration.positionOffsetX.toFixed(2)}</output></span>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={calibration.positionOffsetX}
              onChange={(e) => updateCalibration("positionOffsetX", e.target.value)}
            />
          </label>
          <label className={styles.sliderLabel}>
            <span>Profundidad <output>{calibration.positionOffsetZ.toFixed(0)}</output></span>
            <input
              type="range"
              min="-200"
              max="200"
              step="5"
              value={calibration.positionOffsetZ}
              onChange={(e) => updateCalibration("positionOffsetZ", e.target.value)}
            />
          </label>
          <label className={styles.sliderLabel}>
            <span>Rotación X <output>{calibration.rotationOffsetX.toFixed(0)}°</output></span>
            <input
              type="range"
              min="-45"
              max="45"
              step="1"
              value={calibration.rotationOffsetX}
              onChange={(e) => updateCalibration("rotationOffsetX", e.target.value)}
            />
          </label>
          <label className={styles.sliderLabel}>
            <span>Rotación Y <output>{calibration.rotationOffsetY.toFixed(0)}°</output></span>
            <input
              type="range"
              min="-45"
              max="45"
              step="1"
              value={calibration.rotationOffsetY}
              onChange={(e) => updateCalibration("rotationOffsetY", e.target.value)}
            />
          </label>
          <label className={styles.sliderLabel}>
            <span>Rotación Z <output>{calibration.rotationOffsetZ.toFixed(0)}°</output></span>
            <input
              type="range"
              min="-45"
              max="45"
              step="1"
              value={calibration.rotationOffsetZ}
              onChange={(e) => updateCalibration("rotationOffsetZ", e.target.value)}
            />
          </label>
          <button
            className={styles.textButton}
            type="button"
            onClick={() => setCalibration(DEFAULT_3D_CALIBRATION)}
          >
            Restablecer calibración
          </button>
        </div>

        <a href="/virtual-try-on" className={styles.linkCard}>
          <span aria-hidden="true">←</span>
          <span>Volver al probador 2D</span>
        </a>

        <div className={styles.privacyCard}>
          <span aria-hidden="true">⌾</span>
          <div>
            <strong>Privacidad por diseño</strong>
            <p>
              El video y los puntos faciales se procesan en este navegador. No se
              guardan ni se envían a Óptica Stylo.
            </p>
          </div>
        </div>
      </aside>
    </section>
  );
}
