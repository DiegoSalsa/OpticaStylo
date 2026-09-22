// Servicio de negocio que coordina reglas, permisos y persistencia de health-service.
import { checkDatabaseConnection } from "../repositories/health-repository.js";

// Consultar get salud estado y devolver los datos en el formato esperado por la capa llamadora
export async function getHealthStatus(dependencies = {}) {
  await (dependencies.checkDatabaseConnection ?? checkDatabaseConnection)();

  return {
    database: "ok",
    service: "optica-stylo",
    status: "ok",
  };
}
