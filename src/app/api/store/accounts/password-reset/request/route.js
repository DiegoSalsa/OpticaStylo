import { after } from "next/server";
import { requestPasswordReset } from "./request-password-reset";

export function POST(request) {
  return requestPasswordReset(request, after);
}
