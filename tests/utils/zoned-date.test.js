import assert from "node:assert/strict";
import test from "node:test";

import { getZonedDayRange } from "../../src/utils/zoned-date.js";

test("calcula el día local completo incluso al comenzar el horario de verano", () => {
  const range = getZonedDayRange("2026-03-08", "America/New_York");

  assert.equal(range.startAt.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(range.endAt.toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(range.endAt - range.startAt, 23 * 60 * 60 * 1000);
});
