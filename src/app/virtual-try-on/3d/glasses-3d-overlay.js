"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { BUILT_IN_3D_GLASSES } from "@/constants/virtual-try-on";
import { landmarksToGlassesPose } from "@/utils/virtual-try-on-3d-geometry";
import { PoseFilter } from "@/virtual-try-on-3d/pose-filter";
import { PhysicalScaleEstimator } from "@/virtual-try-on-3d/physical-scale";
import { TrackingTimeline, startVideoFrameLoop } from "@/virtual-try-on-3d/tracking-timeline";
import { announceStoreCartChange, ensureStoreCart, readStoreResponse } from "@/utils/store-client";
import { validateTryOnModelMetadata } from "@/virtual-try-on-3d/model-contract";
import { acquireCamera, cameraTrackSnapshot, mobileCameraEnvironment } from "@/virtual-try-on-3d/camera-acquisition";
import { createDetectionDiagnostics, recordDetectionResult } from "@/virtual-try-on-3d/detection-diagnostics";
import { drawTryOnCapture } from "@/virtual-try-on-3d/frame-presentation";
import { VTO_BUILD_IDENTITY } from "@/virtual-try-on-3d/build-identity";

import Glasses3DInterface from "./glasses-3d-interface";
import { createFaceTracking } from "./face-tracking";

const DEFAULT_FIT_ADJUSTMENT = Object.freeze({
  scaleFactor: 1,
  verticalOffsetMm: 0,
});

function subscribeDebug(listener) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

function subscribeCameraEnvironment(listener) {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

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

export default function Glasses3DOverlay({ cameraDevices = null } = {}) {
  const videoRef = useRef(null);
  const photoImageRef = useRef(null);
  const photoInputRef = useRef(null);
  const streamRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const runningRef = useRef(false);
  const cancelVideoLoopRef = useRef(null);
  const poseFilterRef = useRef(null);
  const debugMetricsRef = useRef({});
  const scaleEstimatorRef = useRef(null);
  const scaleSamplesRef = useRef([]);
  const scaleModeRef = useRef("physical");
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
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [trackingReady, setTrackingReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [modelMetadata, setModelMetadata] = useState(null);
  const [modelError, setModelError] = useState(false);
  const [faceMeshTriangleIndices, setFaceMeshTriangleIndices] = useState(null);
  const [videoDimensions, setVideoDimensions] = useState({
    width: 1280,
    height: 720,
  });
  const [models, setModels] = useState(BUILT_IN_3D_GLASSES);
  const [selectedModel, setSelectedModel] = useState(BUILT_IN_3D_GLASSES[0]);
  const [fitAdjustment, setFitAdjustment] = useState(DEFAULT_FIT_ADJUSTMENT);
  const [captureMessage, setCaptureMessage] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [facingMode, setFacingMode] = useState("user");
  const [cartMessage, setCartMessage] = useState("");
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  // The injected provider belongs only to the development validation route.
  const testDevices = process.env.NODE_ENV === "development" ? cameraDevices : null;
  const mobileCamera = useSyncExternalStore(subscribeCameraEnvironment, () => testDevices?.mobile ?? mobileCameraEnvironment({
    userAgent: navigator.userAgent, mobile: navigator.userAgentData?.mobile,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches, width: window.innerWidth, height: window.innerHeight,
  }), () => false);
  const debugMode = useSyncExternalStore(subscribeDebug,
    () => new URLSearchParams(window.location.search).get("vtoDebug") === "1", () => false);
  const requestedScaleMode = useSyncExternalStore(subscribeDebug, () => {
    const query = new URLSearchParams(window.location.search), mode = query.get("vtoScale");
    return query.get("vtoDebug") === "1" && ["historical", "v2"].includes(mode) ? mode : "physical";
  }, () => "physical");
  const [selectedScaleMode, setSelectedScaleMode] = useState(null);
  const scaleMode = debugMode ? selectedScaleMode ?? requestedScaleMode : "physical";
  useEffect(() => { scaleModeRef.current = scaleMode; scaleEstimatorRef.current?.reset(); }, [scaleMode]);
  const changeScaleMode = useCallback((mode) => { setSelectedScaleMode(mode); }, []);
  const recordScaleDiagnostics = useCallback((pose, timestamp) => {
    if (!pose) return;
    Object.assign(debugMetricsRef.current, pose.scaleDiagnostics, { scaleSampleTimestamp: timestamp });
    if (debugMode) {
      scaleSamplesRef.current.push({ ...pose.scaleDiagnostics, timestamp });
      if (scaleSamplesRef.current.length > 300) scaleSamplesRef.current.shift();
    }
  }, [debugMode]);

  useEffect(() => {
    if (!debugMode) return;
    const debug = { snapshot: () => ({ ...debugMetricsRef.current, build: VTO_BUILD_IDENTITY }),
      pose: () => poseRef.current,
      scaleSamples: () => structuredClone(scaleSamplesRef.current) };
    window.__OPTICA_STYLO_VTO__ = debug;
    return () => { if (window.__OPTICA_STYLO_VTO__ === debug) delete window.__OPTICA_STYLO_VTO__; };
  }, [debugMode]);

  const releaseResources = useCallback(() => {
    cameraRequestRef.current += 1;
    runningRef.current = false;
    if (animationFrameRef.current)
      cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    cancelVideoLoopRef.current?.();
    cancelVideoLoopRef.current = null;
    for (const track of streamRef.current?.getTracks?.() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.onresize = null;
      videoRef.current.onloadedmetadata = null;
      videoRef.current.srcObject = null;
    }
    faceLandmarkerRef.current?.close?.();
    faceLandmarkerRef.current = null;
    rendererCanvasRef.current = null;
    poseFilterRef.current = null;
    poseRef.current = null;
    debugMetricsRef.current = {};
    scaleEstimatorRef.current = null;
    scaleSamplesRef.current = [];
  }, []);

  useEffect(() => releaseResources, [releaseResources]);

  const stopCamera = useCallback(() => {
    releaseResources();
    setCameraStatus("idle");
    setCameraAspectRatio(null);
    setFaceDetected(false);
    setTrackingReady(false);
    setModelReady(false);
    setFaceMeshTriangleIndices(null);
    setCaptureMessage("");
    setStatusMessage("Cámara apagada. Enciéndela cuando quieras continuar.");
  }, [releaseResources]);

  useEffect(
    () => () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [photoUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    async function loadCatalog() {
      try {
        const response = await fetch("/api/store/virtual-try-on/models", {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (response.ok && payload.success && payload.data.length > 0) {
          setModels([...BUILT_IN_3D_GLASSES.filter((model) => !payload.data.some((published) => published.sku === model.sku)), ...payload.data]);
          const productId = new URLSearchParams(window.location.search).get("productId");
          const requestedModel = payload.data.find((model) => model.productId === productId);
          if (requestedModel) setSelectedModel(requestedModel);
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          // Las muestras locales siguen disponibles cuando el catálogo no responde.
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
      modelMetadataRef.current = null;
      poseFilterRef.current?.reset();
      poseRef.current = null;
      try {
        const response = await fetch(selectedModel.metadataUrl, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const metadata = validateTryOnModelMetadata(
          payload.success ? payload.data.metadata : payload,
        );
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

  const openPhotoCapture = useCallback(() => {
    releaseResources();
    setCameraStatus("idle");
    setCameraAspectRatio(null);
    setFaceDetected(false);
    setTrackingReady(false);
    setModelReady(false);
    setPhotoLoaded(false);
    setStatusMessage(
      "Selecciona una foto o toma una con la cámara de tu dispositivo.",
    );
    photoInputRef.current?.click();
  }, [releaseResources]);

  const handlePhotoSelected = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setCameraStatus("error");
        setStatusMessage(
          "Selecciona una imagen válida para probarte el marco.",
        );
        return;
      }
      releaseResources();
      const requestId = cameraRequestRef.current;
      setPhotoLoaded(false);
      setPhotoUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(file);
      });
      setCameraAspectRatio(null);
      setCameraStatus("photo");
      setFaceDetected(false);
      setTrackingReady(false);
      setModelReady(false);
      setCaptureMessage("");
      setStatusMessage("Analizando la foto para ajustar el marco 3D…");
      const tracking = await createFaceTracking("IMAGE").catch(() => null);
      if (cameraRequestRef.current !== requestId) { tracking?.landmarker.close?.(); return; }
      if (!tracking || !photoImageRef.current) {
        setCameraStatus("error");
        setStatusMessage(
          "No pudimos preparar el seguimiento facial para esta foto.",
        );
        tracking?.landmarker.close?.();
        return;
      }
      faceLandmarkerRef.current = tracking.landmarker;
      setFaceMeshTriangleIndices(tracking.faceMeshTriangleIndices);
      setTrackingReady(true);
    },
    [releaseResources],
  );

  useEffect(() => {
    if (
      cameraStatus !== "photo" ||
      !photoUrl ||
      !photoLoaded ||
      !trackingReady ||
      !modelMetadata ||
      !faceLandmarkerRef.current ||
      !photoImageRef.current
    )
      return;
    const image = photoImageRef.current;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) return;
    setCameraAspectRatio(width / height);
    setVideoDimensions({ width, height });
    let landmarks = null;
    let faceTransform = null;
    try {
      const result = faceLandmarkerRef.current.detect(image);
      landmarks = result.faceLandmarks?.[0] ?? null;
      faceTransform = result.facialTransformationMatrixes?.[0] ?? null;
    } catch {
      landmarks = null;
    }
    let nextPose = null;
    if (landmarks) {
      try {
        nextPose = landmarksToGlassesPose(
          landmarks,
          width,
          height,
          modelMetadataRef.current,
          faceTransform,
          { ...fitAdjustmentRef.current, mirrored: false, scaleMode },
        );
      } catch {
        nextPose = null;
      }
    }
    poseRef.current = nextPose;
    recordScaleDiagnostics(nextPose, performance.now());
    setFaceDetected(Boolean(nextPose));
    setStatusMessage(
      nextPose
        ? "Foto lista. Puedes guardar la simulación."
        : "No encontramos un rostro de frente. Prueba con otra foto.",
    );
  }, [cameraStatus, fitAdjustment, modelMetadata, photoLoaded, photoUrl, trackingReady, scaleMode, recordScaleDiagnostics]);

  const startCamera = useCallback(
    async (requestedFacingMode = facingMode) => {
      if (!window.isSecureContext) {
        setCameraStatus("error");
        setStatusMessage(
          "Abre el probador mediante HTTPS para poder usar la cámara.",
        );
        return;
      }
      const mediaDevices = testDevices ?? navigator.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        setCameraStatus("error");
        setStatusMessage(
          "Este navegador no permite usar la cámara desde esta página.",
        );
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

      const detection = createDetectionDiagnostics();
      debugMetricsRef.current.detection = detection;
      let cameraDiagnostics = null;
      const trackingPromise = createFaceTracking().catch((error) => {
        detection.trackingInitializationErrors++; detection.lastTrackingInitializationError = error.message; return null;
      });

      try {
        const { stream } = await acquireCamera(mediaDevices, {
          facingMode: requestedFacingMode, mobile: mobileCamera,
          isCurrent: () => cameraRequestRef.current === requestId,
          onDiagnostics: (diagnostics) => {
            cameraDiagnostics = diagnostics;
            if (cameraRequestRef.current === requestId) debugMetricsRef.current.camera = diagnostics;
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
        let sourceDimensions = null;
        const syncDimensions = () => {
          if (cameraRequestRef.current === requestId && video.videoWidth > 0 && video.videoHeight > 0) {
            if (sourceDimensions && (sourceDimensions.width !== video.videoWidth || sourceDimensions.height !== video.videoHeight)) {
              // Previous poses are expressed in previous source pixels. Start
              // a fresh filter state without changing its approved algorithm.
              poseFilterRef.current?.reset(); poseRef.current = null; setFaceDetected(false);
              debugMetricsRef.current.sourceResolutionChanges = (debugMetricsRef.current.sourceResolutionChanges ?? 0) + 1;
            }
            sourceDimensions = { width: video.videoWidth, height: video.videoHeight };
            setCameraAspectRatio(video.videoWidth / video.videoHeight);
            setVideoDimensions({
              width: video.videoWidth,
              height: video.videoHeight,
            });
            Object.assign(debugMetricsRef.current.camera, cameraTrackSnapshot(stream, cameraDiagnostics.supportedConstraints), {
              videoWidth: video.videoWidth, videoHeight: video.videoHeight,
            });
          }
        };
        video.onresize = syncDimensions;
        video.onloadedmetadata = syncDimensions;
        await video.play();
        if (cameraRequestRef.current !== requestId) {
          for (const track of stream.getTracks()) track.stop();
          const stale = await trackingPromise; stale?.landmarker.close?.(); return;
        }
        syncDimensions();
        runningRef.current = true;
        setCameraStatus("ready");
        setStatusMessage("Cámara activa. Preparando el seguimiento facial…");

        const timeline = new TrackingTimeline(), filter = new PoseFilter();
        poseFilterRef.current = filter;
        scaleEstimatorRef.current = new PhysicalScaleEstimator();
        let previousFaceState = false, renderFrames = 0;
        const metricsStarted = performance.now();
        const renderFrame = (timestamp) => {
          if (!runningRef.current || cameraRequestRef.current !== requestId) return;
          poseRef.current = filter.sample(timestamp);
          const detected = Boolean(poseRef.current);
          if (detected !== previousFaceState) { previousFaceState = detected; setFaceDetected(detected); }
          renderFrames++;
          const seconds = Math.max(0.001, (timestamp - metricsStarted) / 1000);
          Object.assign(debugMetricsRef.current, {
            cameraFps: timeline.cameraFrames / seconds, schedulingFps: renderFrames / seconds,
            inferenceFps: timeline.inferences / seconds, processingMs: timeline.durationMs,
            droppedFrames: timeline.dropped, ...filter.metrics(timestamp),
          });
          animationFrameRef.current = requestAnimationFrame(renderFrame);
        };
        animationFrameRef.current = requestAnimationFrame(renderFrame);
        cancelVideoLoopRef.current = startVideoFrameLoop(video, (now, mediaTime, captureTime) => {
          if (!timeline.observe(mediaTime) || !faceLandmarkerRef.current || !modelMetadataRef.current || !timeline.begin(now)) return;
          const metadata = modelMetadataRef.current;
          const sourceWidth = video.videoWidth, sourceHeight = video.videoHeight;
          const started = performance.now();
          // RVFC's display time is an estimate; never allow a future sample timestamp.
          const sampledAt = Math.min(now, captureTime);
          const infer = async () => {
            let result, inferenceError = null;
            detection.inferenceAttempts++;
            try { result = await faceLandmarkerRef.current.detectForVideo(video, now); }
            catch (error) { inferenceError = error; if (cameraRequestRef.current === requestId && runningRef.current) debugMetricsRef.current.lastError = error.message; }
            const duration = performance.now() - started;
            if (cameraRequestRef.current !== requestId || !runningRef.current) return;
            if (!timeline.finish(now, duration) || metadata !== modelMetadataRef.current) return;
            if (sourceWidth !== video.videoWidth || sourceHeight !== video.videoHeight) {
              detection.discardedResolutionChanges = (detection.discardedResolutionChanges ?? 0) + 1;
              return;
            }
            debugMetricsRef.current.inferenceMs = result?.inferenceDurationMs ?? duration;
            debugMetricsRef.current.approximateLatencyMs = performance.now() - sampledAt;
            let pose = null, poseError = null;
            try {
              pose = landmarksToGlassesPose(result?.faceLandmarks?.[0], sourceWidth,
                sourceHeight, metadata, result?.facialTransformationMatrixes?.[0],
                { ...fitAdjustmentRef.current, mirrored: true, scaleMode: scaleModeRef.current },
                scaleEstimatorRef.current, sampledAt);
            } catch (error) { poseError = error; }
            recordDetectionResult(detection, { result, inferenceError, pose, poseError });
            if (!pose) scaleEstimatorRef.current?.reset();
            recordScaleDiagnostics(pose, sampledAt);
            filter.update(pose, sampledAt);
          };
          void infer();
        });

        const tracking = await trackingPromise;
        if (cameraRequestRef.current !== requestId) {
          tracking?.landmarker.close?.();
          return;
        }
        if (tracking) {
          debugMetricsRef.current.backend = tracking.backend;
          faceLandmarkerRef.current = tracking.landmarker;
          setFaceMeshTriangleIndices(tracking.faceMeshTriangleIndices);
          setTrackingReady(true);
          setStatusMessage(
            "Cámara activa. Centra tu rostro para probarte el marco.",
          );
        } else {
          setStatusMessage(
            "La cámara funciona, pero el seguimiento facial no pudo cargarse. Recarga la página.",
          );
        }
      } catch (error) {
        void trackingPromise.then((unusedTracking) =>
          unusedTracking?.landmarker.close?.(),
        );
        if (cameraRequestRef.current !== requestId) return;
        releaseResources();
        debugMetricsRef.current.camera = cameraDiagnostics;
        debugMetricsRef.current.detection = detection;
        setCameraStatus("error");
        setFaceDetected(false);
        setTrackingReady(false);
        setStatusMessage(cameraErrorMessage(error));
      }
    },
    [facingMode, releaseResources, recordScaleDiagnostics, testDevices, mobileCamera],
  );

  const updateFitAdjustment = useCallback((property, delta) => {
    setFitAdjustment((current) => {
      const next = {
        ...current,
        [property]:
          property === "scaleFactor"
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
    const photo = photoImageRef.current;
    const overlay = rendererCanvasRef.current;
    const media = cameraStatus === "photo" ? photo : video;
    if (!media || !overlay || !faceDetected || !modelReady) return;

    const output = document.createElement("canvas");
    output.width =
      cameraStatus === "photo" ? photo.naturalWidth : video.videoWidth;
    output.height =
      cameraStatus === "photo" ? photo.naturalHeight : video.videoHeight;
    const context = output.getContext("2d");
    drawTryOnCapture(context, media, overlay, output.width, output.height, cameraStatus !== "photo");
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
  }, [cameraStatus, faceDetected, modelReady, selectedModel.sku]);

  const changeCamera = useCallback(() => {
    const nextFacingMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextFacingMode);
    void startCamera(nextFacingMode);
  }, [facingMode, startCamera]);

  const addSelectedModelToCart = useCallback(async () => {
    if (!selectedModel.productId) {
      setCartMessage(
        "Este modelo es una muestra técnica y todavía no se puede comprar.",
      );
      return;
    }
    setIsAddingToCart(true);
    setCartMessage("");
    try {
      const cart = await ensureStoreCart({ forShopping: true });
      const currentItem = cart.items.find(
        (item) => item.productId === selectedModel.productId,
      );
      const savedCart = await readStoreResponse(
        await fetch("/api/store/cart/items", {
          body: JSON.stringify({
            items: [
              {
                productId: selectedModel.productId,
                quantity: (currentItem?.quantity ?? 0) + 1,
              },
            ],
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      announceStoreCartChange(savedCart);
      setCartMessage("Marco agregado al carrito. Allí puedes elegir cristales y adjuntar tu receta si corresponde.");
    } catch (error) {
      setCartMessage(error.message);
    } finally {
      setIsAddingToCart(false);
    }
  }, [selectedModel.productId]);

  const handleModelReady = useCallback(() => setModelReady(true), []);
  const displayedStatusMessage =
    captureMessage ||
    (cameraStatus === "ready" && trackingReady
      ? faceDetected
        ? "Calce activo. Gira suavemente para revisar el marco y sus patillas."
        : "Cámara activa. Centra tu rostro y mira de frente."
      : statusMessage);
  const cameraActive = cameraStatus === "ready" || cameraStatus === "photo";
  const viewerState = cameraActive
    ? faceDetected
      ? "tracking"
      : "searching"
    : cameraStatus;
  const filteredModels = useMemo(() => {
    const normalizedSearch = catalogSearch.trim().toLocaleLowerCase("es-CL");
    if (!normalizedSearch) return models;
    return models.filter((model) =>
      `${model.name} ${model.sku}`
        .toLocaleLowerCase("es-CL")
        .includes(normalizedSearch),
    );
  }, [catalogSearch, models]);

  return (
    <Glasses3DInterface
      model={{
        addSelectedModelToCart,
        cameraActive,
        cameraAspectRatio,
        mobileCamera,
        cameraStatus,
        captureTryOn,
        cartMessage,
        catalogSearch,
        changeCamera,
        displayedStatusMessage,
        faceDetected,
        faceMeshTriangleIndices,
        filteredModels,
        fitAdjustment,
        debugMode,
        debugMetricsRef,
        scaleMode,
        changeScaleMode,
        poseFilterRef,
        handleModelReady,
        handlePhotoSelected,
        isAddingToCart,
        modelError,
        modelMetadata,
        modelReady,
        openPhotoCapture,
        photoImageRef,
        photoInputRef,
        photoUrl,
        poseRef,
        rendererCanvasRef,
        resetFitAdjustment,
        selectedModel,
        setCatalogSearch,
        setPhotoLoaded,
        setSelectedModel,
        startCamera,
        stopCamera,
        updateFitAdjustment,
        videoDimensions,
        videoRef,
        viewerState,
      }}
    />
  );
}
