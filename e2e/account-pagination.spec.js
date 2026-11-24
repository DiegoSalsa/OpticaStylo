import { test, expect } from "@playwright/test";
import { prisma } from "../src/db/prisma.js";
import { requireAcademicIsolation, seedAcademicData } from "../tests/fixtures/academic-data.js";
import { seedAccountHistory } from "../tests/fixtures/account-history-data.js";
import { isolateBrowserNetwork } from "./isolated-network.js";

const clinical = "/api/store/accounts/me/clinical";
let sample;

test.beforeAll(async () => {
  requireAcademicIsolation();
  await seedAcademicData();
  sample = await seedAccountHistory();
});
test.afterAll(async () => prisma.$disconnect());
test.beforeEach(async ({ context }) => {
  requireAcademicIsolation();
  await prisma.public_request_rate_limits.deleteMany();
  await isolateBrowserNetwork(context);
});

async function data(response, status = 200) {
  const body = await response.json();
  expect(response.status(), body.error?.message).toBe(status);
  expect(body.success).toBe(true);
  return body.data;
}

async function login(page, identity = sample.owner) {
  await data(await page.request.post("/api/store/accounts/login", {
    data: { email: identity.email, password: sample.password },
  }));
}

function records(type, options = {}) {
  return clinical + "/records?" + new URLSearchParams({ type, ...options });
}

const pagination = (page, label) => page.getByRole("navigation", { name: "Paginación de " + label, exact: true });

test("Paginación de Mi cuenta recupera los historiales completos sin exponer datos adicionales", async ({ page }) => {
  await login(page);
  const initial = await page.request.get(clinical);
  expect(initial.headers()["cache-control"]).toBe("private, no-store");
  const overview = await data(initial);
  expect(overview).toMatchObject({
    linked: true, upcomingPage: { total: 22, totalPages: 2 },
    prescriptions: { activePage: { total: 23, totalPages: 2 } },
  });
  expect(overview.upcomingAppointments).toHaveLength(20);
  expect(overview.prescriptions.active).toHaveLength(20);
  expect(overview.prescriptions.active.some((row) => row.id === sample.oldestActive.id)).toBe(false);
  expect(overview).not.toHaveProperty("appointmentHistory");
  expect(overview).not.toHaveProperty("encounters");
  expect(overview.prescriptions).not.toHaveProperty("history");

  for (const [type, filter, expected] of [
    ["appointment-history", {}, sample.appointmentIds],
    ["prescription-history", {}, sample.prescriptionIds],
    ["encounters", { dependantId: sample.owner.dependant.id }, sample.encounterIds],
  ]) {
    const ids = [];
    for (let pageIndex = 1; pageIndex <= 3; pageIndex += 1) {
      const result = await data(await page.request.get(records(type, { ...filter, page: pageIndex, pageSize: 50 })));
      expect(result).toMatchObject({ page: pageIndex, pageSize: 50, total: 123, totalPages: 3 });
      expect(result.items).toHaveLength(pageIndex === 3 ? 23 : 50);
      ids.push(...result.items.map((row) => row.id));
      const fields = Object.keys(result.items[0]).sort();
      const projections = {
        "appointment-history": ["endAt", "id", "professional", "startAt", "status"],
        "prescription-history": ["id", "issuedAt", "professional", "status"],
        encounters: ["date", "id", "reason", "type"],
      };
      expect(fields).toEqual(projections[type]);
    }
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(123);
    const exact = await data(await page.request.get(records(type, { ...filter, page: 999, pageSize: 41 })));
    expect(exact).toMatchObject({ page: 3, totalPages: 3, total: 123 });
    expect(exact.items).toHaveLength(41);
  }

  const cancelled = await data(await page.request.get(records("appointment-history", { status: "CANCELLED" })));
  expect(cancelled.items.map((item) => item.id)).toEqual([sample.cancelled.id]);
  expect((await page.request.get(records("appointment-history", { status: "DESCONOCIDA" }))).status()).toBe(400);
  expect((await page.request.get(records("encounters"))).status()).toBe(400);
  expect((await page.request.get(records("appointment-history", { pageSize: 51 }))).status()).toBe(400);
  const stillActive = await data(await page.request.get(records("active-prescriptions", { page: 2 })));
  expect(stillActive.items.map((item) => item.id)).toContain(sample.oldestActive.id);
  expect((await page.request.get(clinical + "/prescriptions/" + sample.oldestActive.id + "/pdf")).status()).toBe(200);
  expect((await page.request.get(clinical + "/prescriptions/" + sample.prescriptionIds[0] + "/pdf")).status()).toBe(404);
});

test("Paginación de Mi cuenta bloquea el historial cruzado y de menores sin verificar", async ({ page }) => {
  expect((await page.request.get(records("appointment-history"))).status()).toBe(401);
  await login(page, sample.other);
  const own = await data(await page.request.get(records("appointment-history")));
  expect(own.total).toBe(1);
  expect(sample.appointmentIds).not.toContain(own.items[0].id);
  const child = await data(await page.request.get(records("encounters", { dependantId: sample.other.dependant.id })));
  expect(child.items[0].reason).toBe("Atención exclusiva menor B");
  expect((await page.request.get(clinical + "/prescriptions/" + sample.childPrescription.id)).status()).toBe(404);
  for (const type of ["encounters", "prescription-history", "active-prescriptions", "appointment-history"]) {
    const foreign = await data(await page.request.get(records(type, { dependantId: sample.owner.dependant.id })));
    expect(foreign).toMatchObject({ items: [], total: 0, totalPages: 0 });
  }

  await page.context().clearCookies();
  await login(page, sample.owner);
  const unverified = sample.unverifiedProfile.id;
  expect((await data(await page.request.get(clinical + "?dependantId=" + unverified))).linked).toBe(false);
  expect((await data(await page.request.get(records("encounters", { dependantId: unverified })))).items).toEqual([]);
  const ownChild = await data(await page.request.get(records("active-prescriptions", { dependantId: sample.owner.dependant.id })));
  expect(ownChild.items[0].id).toBe(sample.childPrescription.id);
  const metadata = await data(await page.request.get(clinical + "/prescriptions/" + sample.childPrescription.id));
  expect(Object.keys(metadata).sort()).toEqual(["id", "issuedAt", "professional"]);

  await prisma.patient_guardians.update({ where: { patient_id: sample.owner.minor.id }, data: { account_id: null } });
  try {
    const revoked = await data(await page.request.get(records("encounters", { dependantId: sample.owner.dependant.id, page: 2 })));
    expect(revoked.items).toEqual([]);
    expect((await page.request.get(clinical + "/prescriptions/" + sample.childPrescription.id)).status()).toBe(404);
  } finally {
    await prisma.patient_guardians.update({ where: { patient_id: sample.owner.minor.id }, data: { account_id: sample.owner.account.id } });
  }
});

for (const width of [390, 768, 1440]) {
  test("Paginación de Mi cuenta permite recorrer citas, recetas y menores a " + width + " px", async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    if (width === 390) {
      await page.route((url) => url.pathname === clinical + "/records" && url.searchParams.get("type") === "appointment-history", (route) =>
        route.fulfill({ status: 503, json: { success: false, error: { message: "Historial temporalmente no disponible" } } }), { times: 1 });
    }
    await page.goto("/cuenta?seccion=horas");
    if (width === 390) {
      await expect(page.getByRole("alert").filter({ hasText: "Historial temporalmente no disponible" })).toBeVisible();
      await page.getByRole("button", { name: "Reintentar citas anteriores" }).click();
    }
    const appointments = pagination(page, "citas anteriores");
    await expect(appointments.getByText("Página 1 de 7", { exact: false })).toBeVisible();
    await appointments.getByRole("button", { name: "Siguiente" }).click();
    await expect(appointments.getByText("Página 2 de 7", { exact: false })).toBeVisible();
    await page.getByRole("combobox", { name: "Estado de las citas anteriores" }).selectOption("CANCELLED");
    await expect(appointments.getByText("Página 1 de 1 · 1–1 de 1")).toBeVisible();
    await page.getByRole("combobox", { name: "Estado de las citas anteriores" }).selectOption("CHECKED_IN");
    await expect(page.getByText("No hay citas anteriores para esta consulta.")).toBeVisible();
    const upcoming = pagination(page, "próximas horas");
    await upcoming.getByRole("button", { name: "Siguiente" }).click();
    await expect(upcoming.getByText("Página 2 de 2", { exact: false })).toBeVisible();
    await page.locator('details.clinical-row').filter({ hasText: sample.upcoming.at(-1).id }).locator("summary").click();
    await expect(page.getByRole("button", { name: "Cancelar hora", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reagendar hora", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Mis recetas", exact: true }).click();
    const versions = pagination(page, "versiones anteriores");
    await versions.getByRole("button", { name: "Siguiente" }).click();
    await expect(versions.getByText("Página 2 de 7", { exact: false })).toBeVisible();
    await expect(page.getByText("Receta vigente", { exact: false }).first()).toBeVisible();

    await page.goto("/cuenta?seccion=menores&menor=" + sample.owner.dependant.id);
    const encounters = pagination(page, "atenciones del menor");
    await encounters.getByRole("button", { name: "Siguiente" }).click();
    await expect(encounters.getByText("Página 2 de 7", { exact: false })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
    test.info().annotations.push({ type: "ancho del documento", description: JSON.stringify(dimensions) });
  });
}

test("Paginación de Mi cuenta permite seleccionar una receta vigente fuera de la primera página", async ({ page }) => {
  await login(page);
  await data(await page.request.post("/api/store/cart"), 201);
  await data(await page.request.post("/api/store/cart/items", { data: { items: [
    { productId: sample.frame.id, quantity: 1 },
    { productId: sample.product.id, mountFrameProductId: sample.frame.id, quantity: 1 },
  ] } }));
  await page.goto("/cuenta?seccion=recetas");
  await pagination(page, "recetas vigentes").getByRole("button", { name: "Siguiente" }).click();
  const oldest = page.locator("#recetas details").filter({
    has: page.locator('a[href$="/' + sample.oldestActive.id + '/pdf"]'),
  });
  await oldest.locator("summary").click();
  await oldest.getByRole("button", { name: "Usar en mi carrito" }).click();
  await expect(page).toHaveURL(/seccion=carrito/);
  const picker = page.getByRole("combobox", { name: "Receta clínica vigente" });
  await expect(picker).toHaveValue(sample.oldestActive.id);
  await page.reload();
  await expect(picker).toHaveValue(sample.oldestActive.id);
  await page.getByRole("button", { name: "Usar esta receta" }).click();
  await expect(page.getByText("Estás usando una receta de tu cuenta.")).toBeVisible();
  expect((await data(await page.request.get("/api/store/cart"))).clinicalPrescriptionId).toBe(sample.oldestActive.id);
});
