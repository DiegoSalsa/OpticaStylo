import { test, expect } from "@playwright/test";

const snapshot = (page) => page.evaluate(() => window.__OPTICA_STYLO_VTO__?.snapshot());
const badge = (page) => page.locator('[class*="trackingBadge"][data-active="true"]');

test.afterEach(async ({ page }) => {
  const report = await snapshot(page).catch(() => null);
  if (report) await test.info().attach("metricas-agregadas", { body: JSON.stringify(report), contentType: "application/json" });
});

async function start(page, size = "720x1280", delay = 20) {
  page.on("pageerror", (error) => console.error(error.message));
  await page.route("**/api/store/**", (route) => route.fulfill({ json: { success: true, data: [] } }));
  await page.goto("/virtual-try-on/3d/validation/camera?vtoDebug=1");
  await page.getByRole("checkbox", { name: "Seguimiento determinista" }).check();
  await page.getByLabel("Dimensiones de fuente").selectOption(size);
  await page.getByLabel("Latencia sintética").fill(String(delay));
  await page.getByRole("button", { name: "Probarme este marco", exact: true }).click();
  try { await expect(badge(page)).toBeVisible({ timeout: 45000 }); }
  catch (error) { console.error(JSON.stringify(await snapshot(page))); throw error; }
  await expect.poll(async () => (await snapshot(page))?.modelVisible).toBe(true);
}

for (const [width, height] of [[360, 800], [390, 844], [430, 932], [768, 1024], [844, 390]]) {
  test(`cámara ${width}×${height}: fuente completa, escala física, pérdidas y recuperación`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await start(page);
    await expect.poll(async () => (await snapshot(page))?.irisStable).toBe(true);
    await expect.poll(async () => Math.abs((await snapshot(page))?.pixelsPerMm - 2)).toBeLessThan(.02);
    await expect.poll(async () => (await snapshot(page))?.presentation.alignmentErrorPx).toBeLessThan(.1);
    expect((await snapshot(page)).presentation.visibleFraction).toBeGreaterThan(.998);
    await page.getByLabel("Estímulo de tracking").selectOption("none");
    await expect(badge(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Guardar foto", exact: true })).toBeDisabled();
    await expect.poll(async () => (await snapshot(page)).trackingState).toBe("lost");
    await page.getByLabel("Estímulo de tracking").selectOption("face");
    await expect(badge(page)).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).recoveries).toBeGreaterThan(0);
    await page.getByLabel("Estímulo de tracking").selectOption("invalid");
    await expect.poll(async () => (await snapshot(page)).detection.poseConversionRejections).toBeGreaterThan(0);
    await expect(badge(page)).toHaveCount(0);
    await page.getByLabel("Estímulo de tracking").selectOption("face");
    await expect(badge(page)).toBeVisible();
    await page.getByRole("button", { name: "Rotar fuente", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).camera.videoWidth).toBe(1280);
    await expect.poll(async () => (await snapshot(page)).presentation.alignmentErrorPx).toBeLessThan(.1);
    await expect(badge(page)).toBeVisible();
    await page.getByRole("button", { name: "Cambiar cámara", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).camera.requestedFacingMode).toBe("environment");
    await expect(badge(page)).toBeVisible();
    const harley = page.locator("article").filter({ has: page.getByText("HD0896-001", { exact: true }) });
    await harley.getByRole("button", { name: "Probar", exact: true }).click();
    await expect(badge(page)).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).frameWidthMm).toBe(137);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Guardar foto", exact: true }).click();
    expect((await download).suggestedFilename()).toContain("HD0896-001.png");
    const reportDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Descargar informe técnico JSON" }).click();
    expect((await reportDownload).suggestedFilename()).toBe("optica-stylo-diagnostico.json");
    await page.getByRole("button", { name: "Apagar cámara", exact: true }).click();
    await expect(badge(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Encender cámara", exact: true }).click();
    await expect(badge(page)).toBeVisible();
  });
}

test("fuente 1080×1920 cambia a 640×480 conservando proyección y captura", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, "1080x1920");
  await expect.poll(async () => (await snapshot(page)).camera.videoHeight).toBe(1920);
  await page.getByLabel("Dimensiones de fuente").selectOption("640x480");
  await expect.poll(async () => (await snapshot(page)).camera.videoWidth).toBe(640);
  await expect(badge(page)).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).presentation.alignmentErrorPx).toBeLessThan(.1);
  expect((await snapshot(page)).presentation.visibleFraction).toBeGreaterThan(.998);
});

test("latencia de 220 ms entrega poses, elimina las vencidas y permite usar una fotografía", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, "640x480", 220);
  await expect.poll(async () => (await snapshot(page)).detection.inferencesWithFace).toBeGreaterThan(4);
  expect((await snapshot(page)).resultAgeMs).toBeGreaterThan(180);
  await page.getByLabel("Latencia sintética").fill("600");
  await expect.poll(async () => (await snapshot(page)).detection.discardedStaleResults).toBeGreaterThan(0);
  await expect(badge(page)).toHaveCount(0);
  await page.getByLabel("Latencia sintética").fill("20");
  await expect(badge(page)).toBeVisible({ timeout: 10000 });
  // La imagen sólo contiene un patrón generado aquí. La pose la suministra el
  // proveedor determinista; esto valida el flujo de foto, no la detección ML.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
    const context = canvas.getContext("2d"); context.fillStyle = "#eee"; context.fillRect(0, 0, 640, 480);
    return canvas.toDataURL().split(",")[1];
  });
  await page.getByRole("button", { name: "Usar foto", exact: true }).click();
  await page.locator('input[type="file"]').last().setInputFiles({ name: "patron.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(badge(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar foto", exact: true })).toBeEnabled();
  await expect.poll(async () => (await snapshot(page)).presentation.alignmentErrorPx).toBeLessThan(.1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Guardar foto", exact: true }).click();
  expect((await download).suggestedFilename()).toContain(".png");
});

test("MediaPipe real: modelo, WASM y backend procesan el patrón sin inventar un rostro", async ({ page }) => {
  await page.route("**/api/store/**", (route) => route.fulfill({ json: { success: true, data: [] } }));
  await page.goto("/virtual-try-on/3d/validation/camera?vtoDebug=1");
  await page.getByRole("button", { name: "Probarme este marco", exact: true }).click();
  await expect.poll(async () => (await snapshot(page))?.detection.inferencesWithoutFace ?? 0, { timeout: 60000 }).toBeGreaterThan(2);
  const report = await snapshot(page);
  expect(report.detection.mediaPipeErrors).toBe(0);
  expect(report.detection.inferencesWithFace).toBe(0);
  expect(["worker", "main-thread"]).toContain(report.backend);
  await expect(badge(page)).toHaveCount(0);
});

test("MediaPipe real: entrada tardía, ambos GLB, pérdida y fotografía", async ({ page }) => {
  test.skip(!process.env.VTO_PORTRAIT_PATH, "Requiere el fixture público portrait.jpg de MediaPipe en una ruta local, fuera de Git.");
  await page.route("**/api/store/**", (route) => route.fulfill({ json: { success: true, data: [] } }));
  await page.goto("/virtual-try-on/3d/validation/camera?vtoDebug=1");
  await page.getByLabel("Dimensiones de fuente").selectOption("720x1280");
  await page.getByRole("button", { name: "Probarme este marco", exact: true }).click();
  await expect.poll(async () => (await snapshot(page))?.detection.inferencesWithoutFace ?? 0, { timeout: 60000 }).toBeGreaterThan(2);
  await page.locator('input[type="file"]').first().setInputFiles(process.env.VTO_PORTRAIT_PATH);
  await expect(badge(page)).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => (await snapshot(page)).detection.inferencesWithFace).toBeGreaterThan(3);
  const renderedPixels = () => page.evaluate(() => {
    const webgl = document.querySelector('[class*="threeCanvas"] canvas');
    const copy = document.createElement("canvas"); copy.width = webgl.width; copy.height = webgl.height;
    const context = copy.getContext("2d"); context.drawImage(webgl, 0, 0);
    const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
    let opaque = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) opaque++;
    return opaque;
  });
  await expect.poll(renderedPixels).toBeGreaterThan(100);
  await page.locator("article").filter({ has: page.getByText("HD0896-001", { exact: true }) }).getByRole("button", { name: "Probar", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).frameWidthMm).toBe(137);
  await expect(badge(page)).toBeVisible(); await expect.poll(renderedPixels).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Patrón sin rostro", exact: true }).click();
  await expect(badge(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Usar foto", exact: true }).click();
  await page.locator('input[type="file"]').last().setInputFiles(process.env.VTO_PORTRAIT_PATH);
  await expect(badge(page)).toBeVisible({ timeout: 30000 });
  await expect.poll(renderedPixels).toBeGreaterThan(100);
  await expect.poll(async () => (await snapshot(page)).presentation.alignmentErrorPx).toBeLessThan(.1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Guardar foto", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("HD0896-001.png");
  expect((await snapshot(page)).scaleSource).toMatch(/iris|blend|face/);
});
