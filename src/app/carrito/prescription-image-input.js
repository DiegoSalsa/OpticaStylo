"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Icon from "@/components/ui/icon";
import {
  getCameraConstraints,
  getCameraErrorMessage,
  MAX_CAMERA_IMAGE_EDGE,
  nextCameraFacingMode,
  PRESCRIPTION_IMAGE_ACCEPT,
} from "@/utils/prescription-camera";

function createCameraFile(video) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) throw new Error("La cámara todavía no entrega una imagen. Espera un momento e inténtalo nuevamente.");

  const scale = Math.min(1, MAX_CAMERA_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.height = Math.round(sourceHeight * scale);
  canvas.width = Math.round(sourceWidth * scale);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No pudimos preparar la foto de la receta.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((image) => {
      if (!image) {
        reject(new Error("No pudimos guardar la foto de la receta."));
        return;
      }
      resolve(new File([image], `receta-${Date.now()}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  });
}

export default function PrescriptionImageInput({ disabled, hasStoredImage, image, onImageChange }) {
  const [source, setSource] = useState("FILE");
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [cameraMessage, setCameraMessage] = useState("");
  const [facingMode, setFacingMode] = useState("environment");
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const previewUrl = useMemo(() => image ? URL.createObjectURL(image) : null, [image]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraStatus("idle");
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  async function startCamera(requestedFacingMode = facingMode) {
    setCameraMessage("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage("Tu navegador no permite tomar una foto desde aquí. Sube la imagen de la receta desde tu dispositivo.");
      return;
    }

    stopCamera();
    setCameraStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints(requestedFacingMode));
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("La vista de cámara no está disponible.");
      }
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      setCameraStatus("ready");
    } catch (error) {
      stopCamera();
      setCameraMessage(error.message === "La vista de cámara no está disponible." ? error.message : getCameraErrorMessage(error));
    }
  }

  async function captureImage() {
    setCameraMessage("");
    try {
      const capturedImage = await createCameraFile(videoRef.current);
      stopCamera();
      await onImageChange(capturedImage);
    } catch (error) {
      setCameraMessage(error.message);
    }
  }

  async function switchCamera() {
    const nextMode = nextCameraFacingMode(facingMode);
    setFacingMode(nextMode);
    await startCamera(nextMode);
  }

  function selectImage(event) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (file) void onImageChange(file);
  }

  function selectSource(nextSource) {
    setCameraMessage("");
    setSource(nextSource);
    if (nextSource === "FILE") stopCamera();
  }

  return <div className="prescription-image-input field-full">
    <div className="prescription-image-heading">
      <div>
        <strong>{hasStoredImage ? "Reemplazar imagen de la receta" : "Imagen de la receta"}</strong>
        <span>Máximo 4 MiB. La imagen se conserva como respaldo privado.</span>
      </div>
      {image && <span className="status-chip">Imagen lista</span>}
    </div>

    <div aria-label="Forma de adjuntar la receta" className="prescription-image-source" role="group">
      <button aria-pressed={source === "CAMERA"} className={source === "CAMERA" ? "active" : ""} disabled={disabled} onClick={() => selectSource("CAMERA")} type="button"><Icon name="eye" size={16} />Tomar foto</button>
      <button aria-pressed={source === "FILE"} className={source === "FILE" ? "active" : ""} disabled={disabled} onClick={() => selectSource("FILE")} type="button"><Icon name="file" size={16} />Galería o archivo</button>
    </div>

    {source === "CAMERA" && <div className="prescription-camera-panel">
      <video autoPlay className={cameraStatus === "ready" ? "is-visible" : ""} muted playsInline ref={videoRef} />
      {cameraStatus === "starting" && <p className="prescription-camera-state">Conectando con la cámara…</p>}
      {cameraStatus === "idle" && <div className="prescription-camera-state"><Icon name="receipt" size={24} /><strong>{image ? "¿Necesitas una foto nueva?" : "Fotografía la receta directamente"}</strong><span>Activa la cámara, encuadra el documento completo y usa la foto cuando se vea nítida.</span><button className="button button--secondary" disabled={disabled} onClick={() => startCamera()} type="button">{image ? "Tomar otra foto" : "Activar cámara"}</button></div>}
      {cameraStatus === "ready" && <div className="prescription-camera-actions"><button className="button button--secondary" disabled={disabled} onClick={switchCamera} type="button">Cambiar cámara</button><button className="button button--primary" disabled={disabled} onClick={captureImage} type="button">Usar esta foto</button></div>}
      {cameraMessage && <p className="prescription-camera-message" role="alert">{cameraMessage}</p>}
    </div>}

    {source === "FILE" && <label className="prescription-file-picker"><span><Icon name="file" size={18} />Seleccionar imagen</span><input accept={PRESCRIPTION_IMAGE_ACCEPT} disabled={disabled} onChange={selectImage} type="file" /></label>}

    {previewUrl && <div className="prescription-image-preview"><Image alt="Vista previa de la receta seleccionada" height={52} src={previewUrl} unoptimized width={52} /><div><strong>{image.name}</strong><span>{Math.ceil(image.size / 1024)} KiB · lista para leer</span></div><button disabled={disabled} onClick={() => onImageChange(null)} type="button">Quitar</button></div>}
    {!image && hasStoredImage && <p className="prescription-current-image">Ya hay una imagen de receta guardada. Puedes conservarla o reemplazarla.</p>}
    <small className="prescription-image-help">La lectura automática usa JPEG, PNG o WEBP. HEIC y HEIF se guardan como respaldo y puedes completar sus datos manualmente.</small>
  </div>;
}
