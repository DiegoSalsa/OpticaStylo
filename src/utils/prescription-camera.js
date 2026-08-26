export const PRESCRIPTION_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";
export const MAX_CAMERA_IMAGE_EDGE = 2200;

export function getCameraConstraints(facingMode = "environment") {
  return {
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      height: { ideal: 1440 },
      width: { ideal: 1920 },
    },
  };
}

export function getCameraErrorMessage(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "No pudimos usar la cámara porque el permiso fue rechazado. Puedes habilitarlo en tu navegador o subir la imagen desde tu dispositivo.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No encontramos una cámara disponible. Puedes subir la imagen de la receta desde tu dispositivo.";
    case "NotReadableError":
      return "La cámara está siendo utilizada por otra aplicación. Ciérrala e inténtalo nuevamente.";
    default:
      return "No pudimos iniciar la cámara. Puedes intentar otra vez o subir la imagen desde tu dispositivo.";
  }
}

export function nextCameraFacingMode(facingMode) {
  return facingMode === "environment" ? "user" : "environment";
}
