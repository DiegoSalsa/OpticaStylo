import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PoseFilter } from "../../src/virtual-try-on-3d/pose-filter.js";
import { TrackingSession, MAX_CAPTURE_AGE_MS } from "../../src/virtual-try-on-3d/tracking-session.js";
import { PhysicalScaleEstimator, irisScaleFromDiameters } from "../../src/virtual-try-on-3d/physical-scale.js";
import { SessionScaleEstimator } from "../../src/virtual-try-on-3d/session-scale.js";
import { landmarksToGlassesPose } from "../../src/utils/virtual-try-on-3d-geometry.js";
import { technicalReport } from "../../src/virtual-try-on-3d/technical-report.js";
import { scaleFace } from "../fixtures/scale-face.js";

const models = ["RB2140-901-50-v2.19", "Harley-Davidson_HD0896_001_V4_definitivo"].map((name) =>
  JSON.parse(readFileSync(new URL(`../../public/virtual-try-on/models/${name}.tryon.json`, import.meta.url))));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const iris = irisScaleFromDiameters([23.4, 23.4, 23.4, 23.4], 1000, 500, [18, 18]);
const missing = irisScaleFromDiameters([], 1000, 500, [0, 0]);
const pose = (model = models[0], options = {}) => {
  const face = scaleFace(options);
  return landmarksToGlassesPose(face.landmarks, 1000, 500, model, face.transform);
};

test("mismo estímulo lento: antes vence al llegar; ahora se entrega sin extender predicción", () => {
  const before = new PoseFilter(), after = new TrackingSession();
  before.update(pose(), 0); after.update(pose(), 0, 220);
  assert.equal(before.sample(220), null); assert.ok(after.sample(220));
  assert.equal(after.metrics(220).resultAgeMs, 220);
  assert.deepEqual(after.sample(220).position, after.sample(270).position);
  assert.equal(after.sample(MAX_CAPTURE_AGE_MS + 1), null);
});

test("inicio sin rostro, adquisición, estabilidad, pérdidas breves, pérdida real y recuperación", () => {
  const session = new TrackingSession(0);
  session.update(null, 0, 20); assert.equal(session.phase, "unacquired");
  assert.equal(session.sample(20), null);
  session.update(pose(), 33, 53); assert.equal(session.phase, "detected");
  assert.equal(session.firstPoseMs, 53);
  session.update(pose(), 66, 86); session.update(pose(), 99, 119);
  assert.equal(session.phase, "stable");
  session.update(null, 132, 152); assert.equal(session.phase, "transient-loss");
  assert.ok(session.sample(152));
  session.update(pose(), 165, 185); assert.equal(session.phase, "recovering");
  assert.equal(session.recoveryMs, 33);
  assert.equal(session.sample(600), null); assert.equal(session.phase, "lost");
  session.update(pose(models[0], { x: 120 }), 620, 640);
  assert.equal(session.phase, "recovering");
  near(session.sample(640).position[0], pose(models[0], { x: 120 }).position[0]);
  assert.equal(session.filter.metrics(640).facialSpeedPxPerSecond, 0);
});

test("el presupuesto no renueva la edad de captura ni acepta resultados viejos/futuros", () => {
  const session = new TrackingSession();
  assert.equal(session.update(pose(), 0, 1000), false);
  assert.equal(session.update(pose(), 100, 50), false);
  assert.equal(session.update(pose(), 100, 120), true);
  assert.equal(session.update(pose(), 99, 130), false);
  assert.equal(session.update(pose(), 100, 130), false);
  assert.equal(session.sample(301), null);
  assert.equal(session.rejectedStale, 1);
});

for (const model of models) for (const fps of [15, 30, 60]) test(`notebook ${model.identity.sku}, ${fps} FPS: todas las poses filtradas idénticas`, () => {
  const before = new PoseFilter(), after = new TrackingSession();
  for (let i = 0; i < fps * 3; i++) {
    const timestamp = i * 1000 / fps;
    const measurement = pose(model, { yaw: Math.sin(i / 10) * .4, pitch: .1, pixelsPerMm: 2 + i / 200, x: i });
    before.update(measurement, timestamp); after.update(measurement, timestamp, timestamp + 12);
    assert.deepEqual(after.sample(timestamp + 16), before.sample(timestamp + 16));
  }
});

test("reinicios repetidos explican el exceso de ancho; una inferencia perdida ya no destruye la referencia", () => {
  const before = new PhysicalScaleEstimator(), after = new SessionScaleEstimator();
  let oldScale, newScale;
  for (let timestamp = 0; timestamp <= 990; timestamp += 33) {
    if (timestamp % 99 === 66) { before.reset(); continue; }
    oldScale = before.update(2.8, iris, 1000, timestamp).pixelsPerMm;
    newScale = after.update(2.8, iris, 1000, timestamp).pixelsPerMm;
  }
  near(oldScale, 2.44); near(newScale, 2);
  near(oldScale / newScale, 1.22);
  for (const model of models) near(newScale * model.dimensionsMm.frameWidth / model.dimensionsMm.frameWidth, 2);
});

test("oclusiones de iris: retención sigue distancia, transición finita, reinicio y referencia nueva", () => {
  const estimator = new SessionScaleEstimator();
  for (let time = 0; time <= 660; time += 33) estimator.update(2.8, iris, 1000, time);
  near(estimator.update(4.2, missing, 1000, 693).pixelsPerMm, 3);
  const transition = estimator.update(4.2, missing, 1000, 1200);
  assert.ok(transition.pixelsPerMm > 3 && transition.pixelsPerMm < 3.3);
  for (let time = 1233; time < 4000; time += 33) estimator.update(4.2, missing, 1000, time);
  assert.ok(estimator.update(4.2, missing, 1000, 4000).pixelsPerMm > 4.19);
  estimator.reset(); near(estimator.update(2.8, missing, 1000, 4033).pixelsPerMm, 2.8);
});

test("notebook: el estimador conserva exactamente sus mediciones válidas aprobadas", () => {
  const before = new PhysicalScaleEstimator(), after = new SessionScaleEstimator();
  for (let time = 0; time < 1000; time += 33) {
    assert.deepEqual(after.update(2.8, iris, 1000, time), before.update(2.8, iris, 1000, time));
  }
});

test("rostro presente con conversión inválida no se confunde con una pose adquirida", () => {
  const face = scaleFace(); face.landmarks[33].x = NaN;
  const measurement = landmarksToGlassesPose(face.landmarks, 1000, 500, models[0], face.transform);
  assert.equal(measurement, null);
  const session = new TrackingSession(); session.update(measurement, 0, 20);
  assert.equal(session.phase, "unacquired"); assert.equal(session.sample(20), null);
});

test("informe con lista permitida elimina datos privados incluso anidados y valores no finitos", () => {
  const secret = "SENTINELA_PRIVADA";
  const report = technicalReport({ pixelsPerMm: Infinity, posePosition: [secret], faceLandmarks: [secret],
    backend: secret, camera: { settings: { deviceId: secret, groupId: secret, width: 720, session: secret },
      capabilities: { deviceId: secret }, appliedConstraints: { deviceId: secret } },
    detection: { lastMediaPipeError: secret, inferencesWithFace: 3 }, projection: { focalPx: 720, source: "estimated" },
  }, { commit: "db686b4", branch: "mejoras-probador", deployment: secret });
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.equal(report.pixelsPerMm, null); assert.equal(report.camera.width, 720);
  assert.equal(report.detection.inferencesWithFace, 3); assert.equal(report.camera.intrinsics, "unavailable");
});
