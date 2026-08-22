"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEMO_3D_GLASSES,
  FACE_LANDMARKER_MODEL_URL,
  MEDIAPIPE_WASM_URL,
} from "@/constants/virtual-try-on";
import {
  landmarksToGlassesPose,
  smoothGlassesPose3D,
} from "@/utils/virtual-try-on-3d-geometry";
import { withMediaPipeConsoleFilter } from "@/utils/mediapipe-console";
import { ensureStoreCart, formatClp, readStoreResponse } from "@/utils/store-client";
import { validateTryOnModelMetadata } from "@/virtual-try-on-3d/model-contract";

import styles from "./virtual-try-on-3d.module.css";

const GlassesModel = dynamic(() => import("./glasses-model"), { ssr: false });
const FACE_LOST_GRACE_MS = 280;
const TRACKING_INTERVAL_MS = 40;
const DEFAULT_FIT_ADJUSTMENT = Object.freeze({
  scaleFactor: 0.97,
  verticalOffsetMm: 2,
});

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

async function createFaceTrackingInternal() {
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
        outputFacialTransformationMatrixes: true,
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

async function createFaceTracking() {
  return withMediaPipeConsoleFilter(createFaceTrackingInternal);
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
  const rendererCanvasRef = useRef(null);
  const fitAdjustmentRef = useRef(DEFAULT_FIT_ADJUSTMENT);

  const [cameraStatus, setCameraStatus] = useState("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Te pediremos permiso para usar la cámara de este dispositivo.",
  );
  const [cameraAspectRatio, setCameraAspectRatio] = useState(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [trackingReady, setTrackingReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [modelMetadata, setModelMetadata] = useState(null);
  const [modelError, setModelError] = useState(false);
  const [faceMeshTriangleIndices, setFaceMeshTriangleIndices] = useState(null);
  const [videoDimensions, setVideoDimensions] = useState({ width: 1280, height: 720 });
  const [models, setModels] = useState([{ ...DEMO_3D_GLASSES, assetId: "demo", isDemo: true }]);
  const [selectedModel, setSelectedModel] = useState({ ...DEMO_3D_GLASSES, assetId: "demo", isDemo: true });
  const [fitAdjustment, setFitAdjustment] = useState(DEFAULT_FIT_ADJUSTMENT);
  const [captureMessage, setCaptureMessage] = useState("");
  const [cameraVisual, setCameraVisual] = useState({ brightness: 100, contrast: 100 });
  const [catalogSearch, setCatalogSearch] = useState("");
  const [facingMode, setFacingMode] = useState("user");
  const [showOverlay, setShowOverlay] = useState(true);
  const [cartMessage, setCartMessage] = useState("");
  const [isAddingToCart, setIsAddingToCart] = useState(false);

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
    rendererCanvasRef.current = null;
    smoothedPoseRef.current = null;
    poseRef.current = null;
    lastDetectionAtRef.current = 0;
    lastFaceSeenAtRef.current = 0;
  }, []);

  useEffect(() => releaseResources, [releaseResources]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadCatalog() {
      try {
        const response = await fetch("/api/store/virtual-try-on/models", { signal: controller.signal });
        const payload = await response.json();
        if (response.ok && payload.success && payload.data.length > 0) {
          setModels(payload.data);
          setSelectedModel(payload.data[0]);
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          // El GLB de demostración mantiene utilizable el prototipo sin fingir catálogo.
        }
      }
    }
    void loadCatalog();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadModelMetadata() {
      setModelError(false);
      setModelReady(false);
      setModelMetadata(null);
      try {
        const response = await fetch(selectedModel.metadataUrl, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const metadata = validateTryOnModelMetadata(payload.success ? payload.data.metadata : payload);
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
  }, [selectedModel]);

  const stopCamera = useCallback(() => {
    releaseResources();
    setCameraAspectRatio(null);
    setCameraStatus("idle");
    setFaceDetected(false);
    setTrackingReady(false);
    setCaptureMessage("");
    setStatusMessage("Cámara apagada. No guardamos ningún fotograma.");
  }, [releaseResources]);

  const startCamera = useCallback(async (requestedFacingMode = facingMode) => {
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
    setTrackingReady(false);
    setModelReady(false);
    setCaptureMessage("");
    setStatusMessage("Esperando que autorices el uso de la cámara…");

    const isMobilePortrait = window.matchMedia(
      "(max-width: 768px) and (orientation: portrait)",
    ).matches;
    const trackingPromise = createFaceTracking().catch(() => null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: requestedFacingMode },
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
                fitAdjustmentRef.current,
              );
            } catch {
              nextPose = null;
            }
            if (nextPose) {
              lastFaceSeenAtRef.current = timestamp;
              smoothedPoseRef.current = smoothGlassesPose3D(
                smoothedPoseRef.current,
                nextPose,
                { timestamp },
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
        setTrackingReady(true);
        setStatusMessage("Cámara activa. Centra tu rostro para probarte el marco.");
      } else {
        setStatusMessage("La cámara funciona, pero el seguimiento facial no pudo cargarse. Recarga la página.");
      }
    } catch (error) {
      void trackingPromise.then((unusedTracking) => unusedTracking?.landmarker.close?.());
      releaseResources();
      setCameraStatus("error");
      setFaceDetected(false);
      setTrackingReady(false);
      setStatusMessage(cameraErrorMessage(error));
    }
  }, [facingMode, releaseResources]);

  const updateFitAdjustment = useCallback((property, delta) => {
    setFitAdjustment((current) => {
      const next = {
        ...current,
        [property]: property === "scaleFactor"
          ? Math.min(1.12, Math.max(0.88, current[property] + delta))
          : Math.min(6, Math.max(-6, current[property] + delta)),
      };
      fitAdjustmentRef.current = next;
      return next;
    });
  }, []);

  const resetFitAdjustment = useCallback(() => {
    fitAdjustmentRef.current = DEFAULT_FIT_ADJUSTMENT;
    setFitAdjustment(DEFAULT_FIT_ADJUSTMENT);
  }, []);

  const captureTryOn = useCallback(() => {
    const video = videoRef.current;
    const overlay = rendererCanvasRef.current;
    if (!video || !overlay || !faceDetected || !modelReady) return;

    const output = document.createElement("canvas");
    output.width = video.videoWidth;
    output.height = video.videoHeight;
    const context = output.getContext("2d");
    context.save();
    context.translate(output.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, output.width, output.height);
    context.restore();
    context.drawImage(overlay, 0, 0, output.width, output.height);
    output.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `optica-stylo-${selectedModel.sku}.png`;
      link.click();
      URL.revokeObjectURL(url);
      setCaptureMessage("Captura guardada en tu dispositivo.");
      window.setTimeout(() => setCaptureMessage(""), 3200);
    }, "image/png");
  }, [faceDetected, modelReady, selectedModel.sku]);

  const changeCamera = useCallback(() => {
    const nextFacingMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextFacingMode);
    void startCamera(nextFacingMode);
  }, [facingMode, startCamera]);

  const addSelectedModelToCart = useCallback(async () => {
    if (!selectedModel.productId) {
      setCartMessage("Este modelo es una muestra técnica y todavía no se puede comprar.");
      return;
    }
    setIsAddingToCart(true);
    setCartMessage("");
    try {
      const cart = await ensureStoreCart();
      const currentItem = cart.items.find((item) => item.productId === selectedModel.productId);
      await readStoreResponse(await fetch("/api/store/cart/items", {
        body: JSON.stringify({
          items: [{
            productId: selectedModel.productId,
            quantity: (currentItem?.quantity ?? 0) + 1,
          }],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }));
      setCartMessage("Marco agregado al carrito.");
    } catch (error) {
      setCartMessage(error.message);
    } finally {
      setIsAddingToCart(false);
    }
  }, [selectedModel.productId]);

  const handleModelReady = useCallback(() => setModelReady(true), []);
  const displayedStatusMessage = captureMessage || (
    cameraStatus === "ready" && trackingReady
      ? (faceDetected
          ? "Calce activo. Gira suavemente para revisar el marco y sus patillas."
          : "Cámara activa. Centra tu rostro y mira de frente.")
      : statusMessage
  );
  const halfWidth = videoDimensions.width / 2;
  const halfHeight = videoDimensions.height / 2;
  const viewerState = cameraStatus === "ready"
    ? (faceDetected ? "tracking" : "searching")
    : cameraStatus;
  const filteredModels = useMemo(() => {
    const normalizedSearch = catalogSearch.trim().toLocaleLowerCase("es-CL");
    if (!normalizedSearch) return models;
    return models.filter((model) => (
      `${model.name} ${model.sku}`.toLocaleLowerCase("es-CL").includes(normalizedSearch)
    ));
  }, [catalogSearch, models]);

  return (
    <section className={styles.experience} aria-label="Probador virtual 3D">
      <aside className={styles.guidePanel}>
        <div className={styles.cameraState} data-active={cameraStatus === "ready"}>
          <span aria-hidden="true" />
          <div><strong>{cameraStatus === "ready" ? "Cámara activa" : "Cámara inactiva"}</strong><small>Conexión segura y local</small></div>
        </div>
        <section className={styles.guideCard} aria-labelledby="quick-guide-title">
          <p className={styles.panelTitle} id="quick-guide-title">Guía rápida</p>
          <ol>
            <li><span>1.</span><p>Mantén tu rostro centrado en la guía.</p></li>
            <li><span>2.</span><p>Asegura buena iluminación frontal.</p></li>
            <li><span>3.</span><p>Usa los controles para ajustar visualmente.</p></li>
          </ol>
        </section>
        <section className={styles.adjustmentCard} aria-labelledby="visual-adjustments-title">
          <p className={styles.panelTitle} id="visual-adjustments-title">Ajustes visuales</p>
          <label><span>Brillo</span><output>{cameraVisual.brightness}%</output><input aria-label="Brillo de la cámara" max="125" min="75" onChange={(event) => setCameraVisual((current) => ({ ...current, brightness: Number(event.target.value) }))} type="range" value={cameraVisual.brightness} /></label>
          <label><span>Contraste</span><output>{cameraVisual.contrast}%</output><input aria-label="Contraste de la cámara" max="125" min="75" onChange={(event) => setCameraVisual((current) => ({ ...current, contrast: Number(event.target.value) }))} type="range" value={cameraVisual.contrast} /></label>
        </section>
        <p className={styles.guidePrivacy}><span aria-hidden="true">●</span> El video no se guarda ni sale de tu dispositivo.</p>
      </aside>
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
            style={{ filter: `brightness(${cameraVisual.brightness}%) contrast(${cameraVisual.contrast}%)` }}
          />

          {cameraStatus === "ready" && (
            <Canvas
              key={`${videoDimensions.width}x${videoDimensions.height}`}
              className={styles.threeCanvas}
              data-cropped={Boolean(cameraAspectRatio)}
              data-visible={showOverlay}
              dpr={[1, 1.5]}
              gl={{
                alpha: true,
                antialias: true,
                powerPreference: "high-performance",
                preserveDrawingBuffer: true,
              }}
              onCreated={({ gl }) => {
                rendererCanvasRef.current = gl.domElement;
                gl.toneMappingExposure = 1.1;
              }}
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
              style={{
                "--overlay-aspect-ratio": cameraAspectRatio ?? undefined,
                pointerEvents: "none",
              }}
            >
              <hemisphereLight args={["#ffffff", "#52635e", 1.05]} />
              <directionalLight position={[250, 320, 480]} intensity={1.7} />
              <directionalLight position={[-280, 40, 260]} intensity={0.65} />
              <Environment resolution={128}>
                <Lightformer
                  color="#ffffff"
                  form="rect"
                  intensity={3.4}
                  position={[0, 4, 6]}
                  scale={[8, 3, 1]}
                />
                <Lightformer
                  color="#d9eee7"
                  form="rect"
                  intensity={2.1}
                  position={[-5, 1, 2]}
                  rotation={[0, Math.PI / 2, 0]}
                  scale={[4, 5, 1]}
                />
                <Lightformer
                  color="#f1d8b8"
                  form="rect"
                  intensity={1.5}
                  position={[5, -1, 1]}
                  rotation={[0, -Math.PI / 2, 0]}
                  scale={[3, 4, 1]}
                />
              </Environment>
              <Suspense fallback={null}>
                {modelMetadata && (
                  <GlassesModel
                    key={selectedModel.assetId}
                    faceMeshTriangleIndices={faceMeshTriangleIndices}
                    modelMetadata={modelMetadata}
                    modelUrl={selectedModel.modelUrl}
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
          <div className={styles.faceOval} aria-hidden="true" />

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
              {cameraStatus !== "loading" && (
                <button
                  className={styles.viewerCta}
                  type="button"
                  onClick={() => startCamera()}
                >
                  Probarme este marco
                </button>
              )}
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
            {cameraStatus === "ready" ? "Cámara activa" : "Cámara apagada"}
          </div>
          <div className={styles.trackingBadge} data-active={faceDetected}>
            <span aria-hidden="true">{faceDetected ? "✓" : "⌁"}</span>
            {faceDetected ? "Rostro detectado" : "Buscando rostro"}
          </div>
        </div>

        <div className={styles.cameraControls}>
          <p>Controles de cámara</p>
          <div className={styles.viewerDock}>
            <button className={styles.dockButton} disabled={cameraStatus === "loading"} onClick={() => (cameraStatus === "ready" ? changeCamera() : startCamera())} type="button"><span aria-hidden="true">↻</span>{cameraStatus === "ready" ? "Cambiar cámara" : "Activar cámara"}</button>
            <button className={styles.captureButton} disabled={!faceDetected || !modelReady} onClick={captureTryOn} type="button"><span aria-hidden="true">▣</span>Guardar foto</button>
            <button aria-pressed={!showOverlay} className={styles.dockButton} disabled={cameraStatus !== "ready"} onClick={() => setShowOverlay((current) => !current)} type="button"><span aria-hidden="true">◐</span>{showOverlay ? "Ver sin marco" : "Ver con marco"}</button>
          </div>
        </div>
        <p className={styles.status} aria-live="polite">{displayedStatusMessage}</p>
        <article className={styles.selectedFrame}>
          <div className={styles.frameThumb} aria-hidden="true"><span /><span /><i /></div>
          <div className={styles.selectedFrameCopy}><h2>{selectedModel.name}</h2><p>Modelo {selectedModel.sku}</p><strong>{selectedModel.unitPriceCents ? formatClp(selectedModel.unitPriceCents) : "Muestra 3D"}</strong></div>
          <button className={styles.addButton} disabled={isAddingToCart} onClick={addSelectedModelToCart} type="button">{isAddingToCart ? "Agregando…" : "Agregar al carrito"}</button>
          {cartMessage && <p className={styles.cartMessage} role="status">{cartMessage}</p>}
        </article>
      </div>

      <aside className={styles.controlsPanel}>
        <div className={styles.catalogHeader}><p className={styles.panelTitle}>Catálogo virtual</p><p>Selecciona un modelo para probártelo en vivo.</p></div>
        <label className={styles.catalogSearch}><span aria-hidden="true">⌕</span><input onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Buscar marcos…" type="search" value={catalogSearch} /></label>
        <div className={styles.modelPicker} aria-live="polite">
          {filteredModels.map((model) => <article className={styles.catalogItem} data-selected={selectedModel.assetId === model.assetId} key={model.assetId}><div className={styles.catalogArt} aria-hidden="true"><span /><span /><i /></div><div><strong>{model.name}</strong><small>{model.sku}</small><b>{model.unitPriceCents ? formatClp(model.unitPriceCents) : "Muestra técnica"}</b></div><button aria-pressed={selectedModel.assetId === model.assetId} onClick={() => setSelectedModel(model)} type="button">{selectedModel.assetId === model.assetId ? "Probando" : "Probar"}</button></article>)}
          {filteredModels.length === 0 && <p className={styles.emptyCatalog}>No encontramos marcos con esa búsqueda.</p>}
        </div>
        <div className={styles.fitCard}>
          <div><p className={styles.panelTitle}>Ajuste fino</p><p>El calce automático se adapta al rostro; puedes corregirlo visualmente.</p></div>
          <div className={styles.fitControls}><button aria-label="Reducir tamaño del marco" disabled={fitAdjustment.scaleFactor <= 0.88} onClick={() => updateFitAdjustment("scaleFactor", -0.02)} type="button">−</button><output aria-label="Tamaño del marco">{Math.round(fitAdjustment.scaleFactor * 100)}%</output><button aria-label="Aumentar tamaño del marco" disabled={fitAdjustment.scaleFactor >= 1.12} onClick={() => updateFitAdjustment("scaleFactor", 0.02)} type="button">+</button><button aria-label="Subir el marco" disabled={fitAdjustment.verticalOffsetMm <= -6} onClick={() => updateFitAdjustment("verticalOffsetMm", -1)} type="button">↑</button><output aria-label="Altura del marco">{fitAdjustment.verticalOffsetMm === 0 ? "Centro" : `${fitAdjustment.verticalOffsetMm > 0 ? "+" : ""}${fitAdjustment.verticalOffsetMm} mm`}</output><button aria-label="Bajar el marco" disabled={fitAdjustment.verticalOffsetMm >= 6} onClick={() => updateFitAdjustment("verticalOffsetMm", 1)} type="button">↓</button></div>
          <button className={styles.resetButton} onClick={resetFitAdjustment} type="button">Restablecer ajuste</button>
        </div>
        {!selectedModel.isDemo && <p className={styles.licenseNote}>Activo con licencia {selectedModel.licenseCode}{selectedModel.attribution ? ` · ${selectedModel.attribution}` : ""}</p>}
        <Link href="/tienda" className={styles.linkCard}><span aria-hidden="true">←</span> Ver catálogo completo</Link>
      </aside>
    </section>
  );
}
