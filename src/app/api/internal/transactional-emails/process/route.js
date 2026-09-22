// Capa HTTP para internal/transactional-emails/process/route.js, delegando autenticación y reglas de negocio a las capas internas.
import { processRequest } from "./process-request.js";

export const maxDuration = 30;

// GET /api/internal/transactional-emails/process/route.js - consultar el recurso aplicando autenticación, validaciones y reglas de negocio
export async function GET(request) {
  return processRequest(request);
}

// POST /api/internal/transactional-emails/process/route.js - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request) {
  return processRequest(request);
}

