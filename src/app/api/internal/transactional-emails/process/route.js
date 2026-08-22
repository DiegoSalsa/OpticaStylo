import { processRequest } from "./process-request.js";

export const maxDuration = 30;

export async function GET(request) {
  return processRequest(request);
}

export async function POST(request) {
  return processRequest(request);
}

