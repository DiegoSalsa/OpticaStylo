"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEMO_3D_GLASSES } from "@/constants/virtual-try-on";
import {
  landmarksToGlassesPose,
  smoothGlassesPose3D,
} from "@/utils/virtual-try-on-3d-geometry";
import { ensureStoreCart, readStoreResponse } from "@/utils/store-client";
import { validateTryOnModelMetadata } from "@/virtual-try-on-3d/model-contract";

import Glasses3DInterface from "./glasses-3d-interface";
import { createFaceTracking } from "./face-tracking";

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

export default function Glasses3DOverlay() {
  const videoRef = useRef(null);
  const photoImageRef = useRef(null);
  const photoInputRef = useRef(null);
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
  const [models, setModels] = useState([
    { ...DEMO_3D_GLASSES, assetId: "demo", isDemo: true },
  ]);
  const [selectedModel, setSelectedModel] = useState({
    ...DEMO_3D_GLASSES,
    assetId: "demo",
    isDemo: true,
  });
  const [fitAdjustment, setFitAdjustment] = useState(DEFAULT_FIT_ADJUSTMENT);
  const [captureMessage, setCaptureMessage] = useState("");
  const [cameraVisual, setCameraVisual] = useState({
    brightness: 100,
    contrast: 100,
  });
  const [catalogSearch, setCatalogSearch] = useState("");
  const [facingMode, setFacingMode] = useState("user");
  const [showOverlay, setShowOverlay] = useState(true);
  const [cartMessage, setCartMessage] = useState("");
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  const releaseResources = useCallback(() => {
    cameraRequestRef.current += 1;
    runningRef.current = false;
    if (animationFrameRef.current)
      cancelAnimationFrame(animationFrameRef.current);
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
          fitAdjustmentRef.current,
        );
      } catch {
        nextPose = null;
      }
    }
    poseRef.current = nextPose;
    smoothedPoseRef.current = nextPose;
    setFaceDetected(Boolean(nextPose));
    setStatusMessage(
      nextPose
        ? "Foto lista. Puedes ajustar el marco y guardar la simulación."
        : "No encontramos un rostro de frente. Prueba con otra foto.",
    );
  }, [cameraStatus, modelMetadata, photoLoaded, photoUrl, trackingReady]);

  const startCamera = useCallback(
    async (requestedFacingMode = facingMode) => {
      if (!window.isSecureContext) {
        setCameraStatus("error");
        setStatusMessage(
          "Abre el probador mediante HTTPS para poder usar la cámara.",
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
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
            setVideoDimensions({
              width: video.videoWidth,
              height: video.videoHeight,
            });
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
            faceLandmarkerRef.current &&
            timestamp - lastDetectionAtRef.current >= TRACKING_INTERVAL_MS &&
            video.readyState >= 2
          ) {
            lastDetectionAtRef.current = timestamp;
            let landmarks = null;
            let faceTransform = null;
            try {
              const result = faceLandmarkerRef.current.detectForVideo(
                video,
                timestamp,
              );
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
              } else if (
                timestamp - lastFaceSeenAtRef.current >
                FACE_LOST_GRACE_MS
              ) {
                poseRef.current = null;
                smoothedPoseRef.current = null;
              }
            } else if (
              timestamp - lastFaceSeenAtRef.current >
              FACE_LOST_GRACE_MS
            ) {
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
        releaseResources();
        setCameraStatus("error");
        setFaceDetected(false);
        setTrackingReady(false);
        setStatusMessage(cameraErrorMessage(error));
      }
    },
    [facingMode, releaseResources],
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
    if (cameraStatus === "photo") {
      context.drawImage(photo, 0, 0, output.width, output.height);
    } else {
      context.save();
      context.translate(output.width, 0);
      context.scale(-1, 1);
      context.drawImage(video, 0, 0, output.width, output.height);
      context.restore();
    }
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
      const cart = await ensureStoreCart();
      const currentItem = cart.items.find(
        (item) => item.productId === selectedModel.productId,
      );
      await readStoreResponse(
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
      setCartMessage("Marco agregado al carrito.");
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
  const halfWidth = videoDimensions.width / 2;
  const halfHeight = videoDimensions.height / 2;
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
        cameraStatus,
        cameraVisual,
        captureTryOn,
        cartMessage,
        catalogSearch,
        changeCamera,
        displayedStatusMessage,
        faceDetected,
        faceMeshTriangleIndices,
        filteredModels,
        fitAdjustment,
        halfHeight,
        halfWidth,
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
        setCameraVisual,
        setCatalogSearch,
        setPhotoLoaded,
        setSelectedModel,
        setShowOverlay,
        showOverlay,
        startCamera,
        updateFitAdjustment,
        videoDimensions,
        videoRef,
        viewerState,
      }}
    />
  );
}
