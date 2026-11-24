import assert from "node:assert/strict";
import test from "node:test";

import { agendaContracts, readAgendaResponse } from "../../src/app/app/agenda/agenda-api.js";

test("Agenda conserva AbortError aunque el servidor ya envió HTTP 200", async () => {
  const cancellation = new DOMException("Solicitud cancelada", "AbortError");
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.error(cancellation);
    },
  }));
  assert.equal(response.status, 200);
  await assert.rejects(readAgendaResponse(response, agendaContracts.professionals), (error) => error === cancellation);
});

test("Agenda acepta listas vacías y rechaza cuerpos y registros inválidos", async () => {
  const { professionals, schedule } = agendaContracts;
  const success = (data) => Response.json({ success: true, data });
  assert.deepEqual(await readAgendaResponse(success([]), professionals), []);
  for (const response of [success({}), success([null]), Response.json({ success: true }), new Response("<html>")]) {
    await assert.rejects(readAgendaResponse(response, professionals), /datos inválidos para los profesionales/);
  }
  const day = { breakEnd: null, breakStart: null, dayOfWeek: 1, endTime: "18:00", isWorking: true, startTime: "09:00" };
  assert.deepEqual(await readAgendaResponse(success([day]), schedule), [day]);
  await assert.rejects(readAgendaResponse(success([{ ...day, dayOfWeek: 9 }]), schedule), /horario semanal/);
});

test("Agenda distingue un error HTTP declarado de una respuesta sin JSON", async () => {
  const { appointments } = agendaContracts;
  await assert.rejects(
    readAgendaResponse(Response.json({ success: false, error: { message: "Temporalmente no disponible" } }, { status: 503 }), appointments),
    /Temporalmente no disponible/,
  );
  await assert.rejects(
    readAgendaResponse(new Response("Bad gateway", { status: 502 }), appointments),
    /HTTP 502/,
  );
});
