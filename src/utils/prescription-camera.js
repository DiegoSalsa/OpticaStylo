export const PRESCRIPTION_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";
// Utilidades compartidas para prescription-camera.
export const MAX_CAMERA_IMAGE_EDGE = 2200;

// Consultar get cámara constraints y devolver los datos en el formato esperado por la capa llamadora
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

// Consultar get cámara error message y devolver los datos en el formato esperado por la capa llamadora
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

// Centralizar la lógica de next cámara facing mode para mantener consistente el comportamiento de la aplicación
export function nextCameraFacingMode(facingMode) {
  return facingMode === "environment" ? "user" : "environment";
}
