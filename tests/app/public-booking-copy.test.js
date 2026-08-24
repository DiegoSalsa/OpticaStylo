import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_BOOKING_CONFIRMATION_NOTE } from "../../src/app/reservar/booking-copy.js";

test("la confirmación pública entrega una referencia sin prometer notificaciones no configuradas", () => {
  assert.match(PUBLIC_BOOKING_CONFIRMATION_NOTE, /referencia/i);
  assert.doesNotMatch(PUBLIC_BOOKING_CONFIRMATION_NOTE, /correo|email|notificaci/i);
});
