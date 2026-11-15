import { test, expect } from "@playwright/test";

const professionalId = "00000000-0000-4000-8000-000000000003";
const date = "2030-10-16";
const startAt = `${date}T17:00:00Z`;
const endAt = `${date}T17:30:00Z`;
const laterSlot = { startAt: `${date}T18:00:00Z`, endAt: `${date}T18:30:00Z` };
const account = {
  rut: "12345678-5", firstNames: "Cliente", lastNames: "Sintético",
  email: "cuenta@example.invalid", address: "Dirección sintética", phone: "+56912345678",
};
const draftKey = "opticastylo:booking-recovery";

const ok = (route, data, status = 200) => route.fulfill({ status, json: { success: true, data } });

async function mockBooking(page) {
  await page.clock.setFixedTime(new Date("2030-10-09T16:00:00Z"));
  let signedIn = false;
  let occupied = false;
  await page.route("**/api/store/accounts/me", (route) => signedIn
    ? ok(route, account)
    : route.fulfill({ status: 401, json: { success: false, error: { message: "Invitado" } } }));
  await page.route("**/api/store/accounts/login", (route) => {
    signedIn = true;
    return ok(route, { account });
  });
  await page.route("**/api/store/booking/professionals", (route) => ok(route, [
    { id: professionalId, firstName: "Profesional", lastName: "Sintético" },
  ]));
  await page.route("**/api/store/booking/professionals/*/availability?*", (route) => ok(route, {
    slots: occupied ? [laterSlot] : [{ startAt, endAt }, laterSlot],
  }));
  await page.route("**/api/store/booking", (route) => ok(route, { appointment: {
    id: professionalId, startAt, professional: { firstName: "Profesional", lastName: "Sintético" },
  } }, 201));
  return () => { occupied = true; };
}

async function selectSlot(page) {
  await page.goto("/reservar");
  await page.getByLabel("Profesional", { exact: true }).selectOption(professionalId);
  await page.getByLabel("Fecha", { exact: true }).fill(date);
  // Elegir el primer horario disponible sin depender del idioma del navegador.
  await page.getByRole("button", { name: /\d{1,2}:\d{2}/ }).first().click();
  await expect(page.getByRole("button", { name: "Confirmar reserva" })).toBeEnabled();
}

async function submitBooking(page, profile) {
  await page.getByLabel("Nombres", { exact: true }).fill(profile.firstNames);
  await page.getByLabel("Apellidos", { exact: true }).fill(profile.lastNames);
  await page.getByLabel("Fecha de nacimiento", { exact: true }).fill("1993-01-01");
  await page.getByLabel("Correo", { exact: true }).fill(profile.email);
  await page.getByLabel("Teléfono", { exact: true }).fill(profile.phone);
  await page.getByLabel("Dirección", { exact: true }).fill(profile.address);
  await page.getByRole("checkbox", { name: /Acepto que Óptica Stylo/ }).check();
  const sent = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/store/booking");
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(page.getByRole("heading", { name: "Tu hora quedó agendada" })).toBeVisible();
  return (await sent).postDataJSON();
}

for (const occupied of [false, true]) {
  test(`volver de recuperación con horario ${occupied ? "ocupado" : "disponible"}`, async ({ page }) => {
    const occupy = await mockBooking(page);
    const challengeId = "00000000-0000-4000-8000-000000000033";
    await page.route("**/api/store/accounts/password-reset/request", (route) => ok(route, { challengeId, retryAfterSeconds: 60 }, 202));
    await page.route("**/api/store/accounts/password-reset/confirm", (route) => {
      expect(route.request().postDataJSON().challengeId).toBe(challengeId);
      return ok(route, { updated: true });
    });
    await selectSlot(page);
    await page.locator("#rut").fill("123456785");
    await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
    await page.getByLabel("Correo de tu cuenta").fill(account.email);
    await page.getByLabel("Contraseña", { exact: true }).fill("Clave-anterior-ficticia");
    await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
    await expect(page.getByRole("heading", { name: "Recupera tu contraseña" })).toBeVisible();
    const draft = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), draftKey);
    expect(draft).toEqual({ professionalId, date, startAt, expiresAt: Date.parse("2030-10-09T16:30:00Z") });
    await page.getByLabel("Correo electrónico", { exact: true }).fill(account.email);
    await page.getByRole("button", { name: "Enviar código", exact: true }).click();
    await expect(page.getByRole("button", { name: "Solicitar otro código" })).toBeDisabled();
    await expect(page.getByText(/Solicitar otro código invalida/)).toBeVisible();
    await page.getByLabel("Código de recuperación").fill("123456");
    await page.getByLabel(/^Nueva contraseña/).fill("Nueva-clave-ficticia-2026");
    await page.getByLabel(/^Repite la nueva contraseña/).fill("Nueva-clave-ficticia-2026");
    await page.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(page.getByRole("heading", { name: "Contraseña actualizada" })).toBeVisible();
    if (occupied) occupy();
    const availability = page.waitForResponse((response) => response.url().includes(`/availability?date=${date}`));
    await page.getByRole("link", { name: "Volver a la reserva" }).click();
    await availability;
    await expect(page.getByLabel("Profesional", { exact: true })).toHaveValue(professionalId);
    await expect(page.getByLabel("Fecha", { exact: true })).toHaveValue(date);
    await expect(page.locator("#rut")).toHaveValue("");
    expect(await page.evaluate((key) => sessionStorage.getItem(key), draftKey)).toBeNull();
    const confirm = page.getByRole("button", { name: "Confirmar reserva" });
    if (occupied) {
      await expect(page.getByRole("status").filter({ hasText: "ya no está disponible" })).toBeVisible();
      await expect(confirm).toBeDisabled();
      await page.getByRole("button", { name: /\d{1,2}:\d{2}/ }).click();
    }
    await expect(confirm).toBeEnabled();
  });
}

test("la agenda permite reservar como invitado y para un tercero sin rellenar datos de la cuenta en otro RUT", async ({ page }) => {
  await mockBooking(page);
  await selectSlot(page);
  const rut = page.locator("#rut");
  await rut.fill("123456785");
  await rut.blur();
  await expect(rut).toHaveValue("12.345.678-5");
  await expect(page.getByRole("button", { name: "Iniciar sesión", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Usar datos de mi cuenta" })).toHaveCount(0);
  expect((await submitBooking(page, account)).patient.rut).toBe("12.345.678-5");

  await selectSlot(page);
  await rut.fill("123456785");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await page.getByLabel("Correo de tu cuenta").fill(account.email);
  await page.getByLabel("Contraseña", { exact: true }).fill("Clave-sintetica-2026!");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await page.getByRole("button", { name: "Usar datos de mi cuenta" }).click();
  await expect(page.getByLabel("Correo", { exact: true })).toHaveValue(account.email);
  await expect(page.getByRole("button", { name: "Confirmar reserva" })).toBeEnabled();
  await rut.fill("12345684k");
  await rut.blur();
  await expect(rut).toHaveValue("12.345.684-K");
  await expect(page.getByLabel("Correo", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Usar datos de mi cuenta" })).toHaveCount(0);
  const submitted = await submitBooking(page, { ...account, firstNames: "Otra persona", email: "otro@example.invalid" });
  expect(submitted.patient).toMatchObject({ rut: "12.345.684-K", firstNames: "Otra persona", email: "otro@example.invalid" });
});

test("el RUT conserva entradas inválidas y entrega el valor visible tanto controlado como no controlado", async ({ page }) => {
  await mockBooking(page);
  await page.goto("/reservar");
  const controlled = page.locator("#rut");
  await controlled.fill("12345684K");
  await controlled.blur();
  await expect(controlled).toHaveValue("12.345.684-K");
  await controlled.fill("123456780");
  await controlled.blur();
  await expect(controlled).toHaveValue("123456780");
  await page.goto("/cuenta");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  const uncontrolled = page.getByLabel("RUT", { exact: true });
  for (const [input, displayed] of [["12.345.678-5", "12.345.678-5"], ["12345678-5", "12.345.678-5"], ["12345684k", "12.345.684-K"], ["ABC123", "ABC123"]]) {
    await uncontrolled.fill(input);
    await uncontrolled.blur();
    await expect(uncontrolled).toHaveValue(displayed);
    const data = await uncontrolled.evaluate((field) => new FormData(field.form).get("rut"));
    expect(data).toBe(displayed);
  }
});

test("reenviar respeta el tiempo indicado por el servidor y no duplica solicitudes", async ({ page }) => {
  await page.clock.install({ time: new Date("2030-10-09T16:00:00Z") });
  let requests = 0;
  await page.route("**/api/store/accounts/password-reset/request", (route) => {
    requests += 1;
    if (requests === 2) return route.fulfill({
      status: 429, headers: { "Retry-After": "90" },
      json: { success: false, error: { message: "Demasiadas solicitudes." } },
    });
    return ok(route, { challengeId: `solicitud-${requests}`, retryAfterSeconds: 60 }, 202);
  });
  await page.goto("/cuenta/recuperar");
  await page.getByLabel("Correo electrónico", { exact: true }).fill(account.email);
  await page.getByRole("button", { name: "Enviar código", exact: true }).click();
  const resend = page.getByRole("button", { name: "Solicitar otro código" });
  await expect(resend).toBeDisabled();
  await page.clock.fastForward(61_000);
  await resend.click();
  await expect(page.getByRole("alert").filter({ hasText: "Demasiadas solicitudes" })).toBeVisible();
  await expect(resend).toBeDisabled();
  expect(requests).toBe(2);
  await page.clock.fastForward(91_000);
  await resend.click();
  await expect(resend).toBeDisabled();
  expect(requests).toBe(3);
});
