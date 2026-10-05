import { checkDatabaseConnection } from "../repositories/health-repository.js";

export async function getHealthStatus(dependencies = {}) {
  await (dependencies.checkDatabaseConnection ?? checkDatabaseConnection)();

  return {
    database: "ok",
    service: "optica-stylo",
    status: "ok",
  };
}
