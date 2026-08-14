import { AppError } from "../../utils/app-error.js";

export async function readPrescriptionImage() {
  throw new AppError({
    code: "PRESCRIPTION_READER_NOT_CONFIGURED",
    message: "La lectura automática está preparada, pero falta definir un proveedor autorizado.",
    status: 503,
  });
}
