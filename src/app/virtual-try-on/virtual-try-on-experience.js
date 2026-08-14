"use client";

import NextImage from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEMO_VIRTUAL_FRAMES,
  FACE_LANDMARKER_MODEL_URL,
  MEDIAPIPE_WASM_URL,
} from "@/constants/virtual-try-on";
import {
  calculateAutomaticFramePose,
  calculateManualFramePose,
  smoothFramePose,
} from "@/utils/virtual-try-on-geometry";

import styles from "./virtual-try-on.module.css";

const INITIAL_ADJUSTMENTS = Object.freeze({
  rotationDegrees: 0,
  scale: 1,
  verticalOffset: 0,
});

function priceLabel(value) {
  if (!Number.isSafeInteger(value)) return "Marco de demostración";
  return new Intl.NumberFormat("es-CL", {
    currency: "CLP",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

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

export default function VirtualTryOnExperience() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const overlayImageRef = useRef(null);
  const animationFrameRef = useRef(null);
  const runningRef = useRef(false);
  const lastDetectionAtRef = useRef(0);
  const latestLandmarksRef = useRef(null);
  const smoothedPoseRef = useRef(null);
  const selectedFrameRef = useRef(DEMO_VIRTUAL_FRAMES[0]);
  const adjustmentsRef = useRef(INITIAL_ADJUSTMENTS);
  const trackingModeRef = useRef("automatic");
  const cameraRequestRef = useRef(0);

  const [frames, setFrames] = useState(DEMO_VIRTUAL_FRAMES);
  const [selectedAssetId, setSelectedAssetId] = useState(DEMO_VIRTUAL_FRAMES[0].assetId);
  const [adjustments, setAdjustments] = useState(INITIAL_ADJUSTMENTS);
  const [trackingMode, setTrackingMode] = useState("automatic");
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Solicitaremos permiso para usar la cámara en este dispositivo.",
  );
  const [cameraAspectRatio, setCameraAspectRatio] = useState(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [automaticTrackingAvailable, setAutomaticTrackingAvailable] = useState(true);

  const selectedFrame = useMemo(
    () => frames.find((frame) => frame.assetId === selectedAssetId) ?? frames[0],
    [frames, selectedAssetId],
  );

  useEffect(() => {
    let active = true;
    fetch("/api/store/virtual-try-on/frames", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        const items = payload?.success && Array.isArray(payload.data) ? payload.data : [];
        if (!active || items.length === 0) return;
        const catalogFrames = items.map((item) => ({ ...item, isDemo: false }));
        setFrames(catalogFrames);
        setSelectedAssetId(catalogFrames[0].assetId);
      })
      .catch(() => {
        // La demostración local permite continuar cuando la API aún no tiene marcos calibrados.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    selectedFrameRef.current = selectedFrame;
    smoothedPoseRef.current = null;
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => {
      overlayImageRef.current = image;
    };
    image.onerror = () => {
      overlayImageRef.current = null;
      setStatusMessage("No fue posible cargar la imagen de este marco.");
    };
    image.src = selectedFrame.imageUrl;
  }, [selectedFrame]);

  useEffect(() => {
    adjustmentsRef.current = adjustments;
    smoothedPoseRef.current = null;
  }, [adjustments]);

  useEffect(() => {
    trackingModeRef.current = trackingMode;
    latestLandmarksRef.current = null;
    smoothedPoseRef.current = null;
  }, [trackingMode]);

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
  }, []);

  useEffect(() => releaseResources, [releaseResources]);

  const stopCamera = useCallback(() => {
    releaseResources();
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setCameraAspectRatio(null);
    setCameraStatus("idle");
    setFaceDetected(false);
    setStatusMessage("La cámara está apagada y no se conserva ningún fotograma.");
  }, [releaseResources]);

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || video.readyState < 2) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const context = canvas.getContext("2d");
    const image = overlayImageRef.current;
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (image) {
      const calibration = selectedFrameRef.current;
      const pose = trackingModeRef.current === "automatic"
        ? calculateAutomaticFramePose({
            adjustments: adjustmentsRef.current,
            calibration,
            height: canvas.height,
            landmarks: latestLandmarksRef.current,
            width: canvas.width,
          })
        : calculateManualFramePose({
            adjustments: adjustmentsRef.current,
            calibration,
            height: canvas.height,
            width: canvas.width,
          });

      if (pose) {
        smoothedPoseRef.current = trackingModeRef.current === "automatic"
          ? smoothFramePose(smoothedPoseRef.current, pose)
          : pose;
        const framePose = smoothedPoseRef.current;
        const aspectRatio = image.naturalHeight / image.naturalWidth;
        const frameHeight = framePose.width * aspectRatio;
        context.translate(framePose.centerX, framePose.centerY);
        context.rotate(framePose.angle);
        context.drawImage(
          image,
          -framePose.width / 2,
          -frameHeight / 2,
          framePose.width,
          frameHeight,
        );
      }
    }
    context.restore();
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
    setAutomaticTrackingAvailable(true);

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
      const syncCameraAspectRatio = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          setCameraAspectRatio(video.videoWidth / video.videoHeight);
        }
      };
      video.onresize = syncCameraAspectRatio;
      await video.play();
      syncCameraAspectRatio();
      runningRef.current = true;
      setCameraStatus("ready");
      setStatusMessage("Cámara activa. Preparando la alineación automática…");

      let previousFaceState = false;
      const renderFrame = (timestamp) => {
        if (!runningRef.current) return;
        if (
          faceLandmarkerRef.current
          && trackingModeRef.current === "automatic"
          && timestamp - lastDetectionAtRef.current >= 66
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
        drawScene();
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
        setStatusMessage("Cámara activa. Mira de frente para alinear el marco.");
      } else {
        setAutomaticTrackingAvailable(false);
        trackingModeRef.current = "manual";
        setTrackingMode("manual");
        setStatusMessage("Cámara activa en modo manual. Usa los controles para ajustar el marco.");
      }
    } catch (error) {
      void landmarkerPromise.then((unusedLandmarker) => unusedLandmarker?.close?.());
      releaseResources();
      setCameraStatus("error");
      setFaceDetected(false);
      setStatusMessage(cameraErrorMessage(error));
    }
  }, [drawScene, releaseResources]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void startCamera();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [startCamera]);

  const captureImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || cameraStatus !== "ready") return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `prueba-virtual-${selectedFrameRef.current.sku.toLowerCase()}.png`;
      link.href = url;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatusMessage("La captura se descargó en tu dispositivo; no fue enviada al servidor.");
    }, "image/png");
  }, [cameraStatus]);

  const selectTrackingMode = (mode) => {
    if (mode === "automatic" && !automaticTrackingAvailable) return;
    trackingModeRef.current = mode;
    setFaceDetected(false);
    setTrackingMode(mode);
  };

  const updateAdjustment = (field, value) => {
    setAdjustments((current) => ({ ...current, [field]: Number(value) }));
  };

  return (
    <section className={styles.experience} aria-label="Probador virtual de marcos">
      <div className={styles.viewerPanel}>
        <div
          className={styles.viewer}
          data-status={cameraStatus}
          style={cameraAspectRatio
            ? { "--camera-aspect-ratio": String(cameraAspectRatio) }
            : undefined}
        >
          <video className={styles.videoSource} ref={videoRef} autoPlay muted playsInline />
          <canvas
            className={styles.canvas}
            ref={canvasRef}
            aria-label="Vista de la cámara con el marco seleccionado"
          />
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
          {cameraStatus === "ready" && trackingMode === "automatic" && !faceDetected && (
            <div className={styles.faceHint}>Centra tu rostro y mira hacia la cámara</div>
          )}
          <div className={styles.liveBadge} data-active={cameraStatus === "ready"}>
            <span aria-hidden="true" />
            {cameraStatus === "ready" ? "Cámara activa" : "Cámara apagada"}
          </div>
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
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={captureImage}
            disabled={cameraStatus !== "ready"}
          >
            Guardar captura
          </button>
        </div>
        <p className={styles.status} aria-live="polite">{statusMessage}</p>
      </div>

      <aside className={styles.controlsPanel}>
        <div>
          <p className={styles.stepLabel}>01 · Elige un marco</p>
          <h2>{selectedFrame.name}</h2>
          <p className={styles.price}>{priceLabel(selectedFrame.unitPriceCents)}</p>
        </div>

        <div className={styles.frameList} role="list" aria-label="Marcos disponibles">
          {frames.map((frame) => (
            <button
              className={styles.frameCard}
              data-selected={frame.assetId === selectedFrame.assetId}
              key={frame.assetId}
              type="button"
              onClick={() => setSelectedAssetId(frame.assetId)}
              aria-pressed={frame.assetId === selectedFrame.assetId}
            >
              <span className={styles.framePreview}>
                <NextImage
                  alt=""
                  height={70}
                  src={frame.imageUrl}
                  unoptimized
                  width={180}
                />
              </span>
              <span>
                <strong>{frame.name}</strong>
                <small>{frame.isDemo ? "Demostración" : frame.sku}</small>
              </span>
            </button>
          ))}
        </div>

        <div className={styles.controlGroup}>
          <p className={styles.stepLabel}>02 · Ajusta el calce</p>
          <div className={styles.segmentedControl} aria-label="Modo de alineación">
            <button
              type="button"
              data-selected={trackingMode === "automatic"}
              aria-pressed={trackingMode === "automatic"}
              disabled={!automaticTrackingAvailable}
              onClick={() => selectTrackingMode("automatic")}
            >
              Automático
            </button>
            <button
              type="button"
              data-selected={trackingMode === "manual"}
              aria-pressed={trackingMode === "manual"}
              onClick={() => selectTrackingMode("manual")}
            >
              Manual
            </button>
          </div>

          <label className={styles.sliderLabel}>
            <span>Escala <output>{Math.round(adjustments.scale * 100)}%</output></span>
            <input
              type="range"
              min="0.7"
              max="1.35"
              step="0.01"
              value={adjustments.scale}
              onChange={(event) => updateAdjustment("scale", event.target.value)}
            />
          </label>
          <label className={styles.sliderLabel}>
            <span>Altura <output>{Math.round(adjustments.verticalOffset * 100)}</output></span>
            <input
              type="range"
              min="-0.45"
              max="0.45"
              step="0.01"
              value={adjustments.verticalOffset}
              onChange={(event) => updateAdjustment("verticalOffset", event.target.value)}
            />
          </label>
          <label className={styles.sliderLabel}>
            <span>Rotación <output>{adjustments.rotationDegrees}°</output></span>
            <input
              type="range"
              min="-20"
              max="20"
              step="1"
              value={adjustments.rotationDegrees}
              onChange={(event) => updateAdjustment("rotationDegrees", event.target.value)}
            />
          </label>
          <button
            className={styles.textButton}
            type="button"
            onClick={() => setAdjustments(INITIAL_ADJUSTMENTS)}
          >
            Restablecer ajustes
          </button>
        </div>

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
