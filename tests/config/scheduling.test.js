import assert from "node:assert/strict";
import test from "node:test";

import { getSchedulingTimeZone } from "../../src/config/scheduling.js";

test("usa America/Santiago como zona horaria predeterminada", () => {
  assert.equal(getSchedulingTimeZone({}), "America/Santiago");
});

test("acepta una zona horaria IANA configurada", () => {
  assert.equal(
    getSchedulingTimeZone({ APP_TIME_ZONE: "America/Punta_Arenas" }),
    "America/Punta_Arenas",
  );
});

test("rechaza zonas horarias desconocidas", () => {
  assert.throws(
    () => getSchedulingTimeZone({ APP_TIME_ZONE: "Chile/Desconocida" }),
    /zona horaria IANA válida/,
  );
});
