export const TRY_ON_MODEL_SCHEMA_VERSION = 2;
// Lógica del probador virtual 3D y sus contratos de datos.

export const REQUIRED_TRY_ON_NODE_ROLES = Object.freeze([
  "front",
  "bridge",
  "hingeLeft",
  "hingeRight",
  "templeLeft",
  "templeRight",
]);

const OPTIONAL_TRY_ON_NODE_ROLES = Object.freeze([
  "lensLeft",
  "lensRight",
  "nosepadLeft",
  "nosepadRight",
]);

function fail(message) {
  throw new TypeError(`Metadata 3D inválida: ${message}`);
}

function positiveNumber(value, path) {
  if (!Number.isFinite(value) || value <= 0) fail(`${path} debe ser mayor que cero.`);
  return value;
}

function finiteNumber(value, path) {
  if (!Number.isFinite(value)) fail(`${path} debe ser un número finito.`);
  return value;
}

function unitInterval(value, path) {
  const normalized = finiteNumber(value, path);
  if (normalized < 0 || normalized > 1) fail(`${path} debe estar entre 0 y 1.`);
  return normalized;
}

function nonEmptyString(value, path) {
  if (typeof value !== "string" || !value.trim()) fail(`${path} es obligatorio.`);
  return value.trim();
}

function vector3(value, path) {
  if (!Array.isArray(value) || value.length !== 3) fail(`${path} debe tener tres valores.`);
  return value.map((item, index) => finiteNumber(item, `${path}[${index}]`));
}

function nodeNames(value, path, required) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0)) {
    fail(`${path} debe contener al menos un nodo.`);
  }
  const normalized = value.map((item, index) => nonEmptyString(item, `${path}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail(`${path} contiene nodos repetidos.`);
  return normalized;
}

/**
 * Valida y normaliza el archivo auxiliar generado cuando un GLB ingresa a la
 * plataforma. Este módulo es seguro para el navegador y permite que el importador
 * y el probador compartan exactamente el mismo contrato.
 */
export function validateTryOnModelMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("se esperaba un objeto.");
  }
  if (value.schemaVersion === 2) return validateV2(value);
  if (value.schemaVersion !== 1) fail("schemaVersion debe ser 1 o 2.");

  const status = value.analysis?.status;
  if (!["valid", "review_required"].includes(status)) {
    fail("analysis.status debe ser valid o review_required.");
  }

  const nodes = {};
  for (const role of REQUIRED_TRY_ON_NODE_ROLES) {
    nodes[role] = nodeNames(
      value.nodes?.[role],
      `nodes.${role}`,
      status === "valid",
    );
  }
  for (const role of OPTIONAL_TRY_ON_NODE_ROLES) {
    nodes[role] = nodeNames(value.nodes?.[role], `nodes.${role}`, false);
  }

  const frontDepthMm = positiveNumber(
    value.occlusion?.frontDepthMm,
    "occlusion.frontDepthMm",
  );
  const templeStartDepthMm = positiveNumber(
    value.occlusion?.templeStartDepthMm,
    "occlusion.templeStartDepthMm",
  );
  const maskFrontDepthMm = positiveNumber(
    value.occlusion?.maskFrontDepthMm,
    "occlusion.maskFrontDepthMm",
  );
  if (!(frontDepthMm < maskFrontDepthMm && maskFrontDepthMm < templeStartDepthMm)) {
    fail("la máscara debe quedar entre el frente y el inicio de las patillas.");
  }

  return {
    analysis: {
      confidence: unitInterval(value.analysis.confidence, "analysis.confidence"),
      status,
      warnings: Array.isArray(value.analysis.warnings)
        ? value.analysis.warnings.map((warning, index) => nonEmptyString(
          warning,
          `analysis.warnings[${index}]`,
        ))
        : [],
    },
    anchorsRaw: {
      bridge: vector3(value.anchorsRaw?.bridge, "anchorsRaw.bridge"),
      fitOrigin: vector3(value.anchorsRaw?.fitOrigin, "anchorsRaw.fitOrigin"),
      hingeLeft: vector3(value.anchorsRaw?.hingeLeft, "anchorsRaw.hingeLeft"),
      hingeRight: vector3(value.anchorsRaw?.hingeRight, "anchorsRaw.hingeRight"),
    },
    dimensionsMm: {
      bridgeWidth: positiveNumber(value.dimensionsMm?.bridgeWidth, "dimensionsMm.bridgeWidth"),
      frameWidth: positiveNumber(value.dimensionsMm?.frameWidth, "dimensionsMm.frameWidth"),
      lensWidth: positiveNumber(value.dimensionsMm?.lensWidth, "dimensionsMm.lensWidth"),
      templeLength: positiveNumber(value.dimensionsMm?.templeLength, "dimensionsMm.templeLength"),
    },
    fitting: {
      verticalOffsetMm: finiteNumber(value.fitting?.verticalOffsetMm, "fitting.verticalOffsetMm"),
    },
    identity: {
      modelId: nonEmptyString(value.identity?.modelId, "identity.modelId"),
      name: nonEmptyString(value.identity?.name, "identity.name"),
      sha256: nonEmptyString(value.identity?.sha256, "identity.sha256"),
      sku: nonEmptyString(value.identity?.sku, "identity.sku"),
      sourceFilename: nonEmptyString(value.identity?.sourceFilename, "identity.sourceFilename"),
    },
    nodes,
    normalization: {
      axisConvention: nonEmptyString(
        value.normalization?.axisConvention,
        "normalization.axisConvention",
      ),
      millimetersPerUnit: positiveNumber(
        value.normalization?.millimetersPerUnit,
        "normalization.millimetersPerUnit",
      ),
      modelYawOffsetDegrees: finiteNumber(
        value.normalization?.modelYawOffsetDegrees,
        "normalization.modelYawOffsetDegrees",
      ),
      offsetRaw: vector3(value.normalization?.offsetRaw, "normalization.offsetRaw"),
    },
    occlusion: {
      frontDepthMm,
      maskFrontDepthMm,
      templeStartDepthMm,
    },
    schemaVersion: 1,
  };
}

const ANCHOR_ROLES = ["bridgeSeat", "frontCenter", "hingeLeft", "hingeRight",
  "lensCenterLeft", "lensCenterRight", "templeDirectionLeft", "templeDirectionRight"];

function validateV2(value) {
  if (value.normalization?.axisConvention !== "X_RIGHT_Y_UP_Z_FORWARD") {
    fail("V2 requiere X_RIGHT_Y_UP_Z_FORWARD (patillas hacia -Z).");
  }
  const matrix = value.normalization?.canonicalFromSource;
  if (!Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(Number.isFinite)) {
    fail("canonicalFromSource debe ser una matriz finita de 16 valores column-major.");
  }
  const basis = [0, 4, 8].map((i) => Math.hypot(matrix[i], matrix[i + 1], matrix[i + 2]));
  const determinant = matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
    - matrix[4] * (matrix[1] * matrix[10] - matrix[2] * matrix[9])
    + matrix[8] * (matrix[1] * matrix[6] - matrix[2] * matrix[5]);
  if (determinant <= 0 || basis.some((n) => n <= 0 || Math.abs(n / basis[0] - 1) > 1e-4)
    || matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) {
    fail("canonicalFromSource requiere transformación afín con escala uniforme positiva.");
  }
  for (const [a, b] of [[0, 4], [0, 8], [4, 8]]) {
    if (Math.abs(matrix[a] * matrix[b] + matrix[a + 1] * matrix[b + 1]
      + matrix[a + 2] * matrix[b + 2]) / basis[0] ** 2 > 1e-4) fail("ejes no ortogonales.");
  }
  if (Math.abs(basis[0] / value.normalization.millimetersPerUnit - 1) > 1e-4) fail("millimetersPerUnit no coincide con transformación.");
  if (!["frameWidth", "declaredUnits"].includes(value.normalization.scaleSource)) fail("scaleSource inválido.");
  const anchors = {};
  for (const role of ANCHOR_ROLES) {
    const anchor = value.anchors?.[role];
    anchors[role] = { position: vector3(anchor?.position, `anchors.${role}`),
      confidence: unitInterval(anchor?.confidence, `anchors.${role}.confidence`),
      source: nonEmptyString(anchor?.source, `anchors.${role}.source`) };
  }
  if (Math.hypot(...anchors.bridgeSeat.position) > 1e-4) fail("bridgeSeat debe ser origen V2.");
  const dimensionsMm = { frameWidth: positiveNumber(value.dimensionsMm?.frameWidth, "dimensionsMm.frameWidth") };
  for (const key of ["bridgeWidth", "lensWidth", "templeLength"]) {
    if (value.dimensionsMm?.[key] != null) dimensionsMm[key] = positiveNumber(value.dimensionsMm[key], `dimensionsMm.${key}`);
  }
  const status = value.analysis?.status;
  if (!["valid", "review_required"].includes(status)) fail("analysis.status inválido.");
  const level = value.capabilities?.level;
  if (!["full", "partial", "basic"].includes(level)) fail("capabilities.level inválido.");
  const nodes = {};
  for (const role of [...REQUIRED_TRY_ON_NODE_ROLES, ...OPTIONAL_TRY_ON_NODE_ROLES]) {
    nodes[role] = nodeNames(value.nodes?.[role], `nodes.${role}`, false);
  }
  const temples = {};
  for (const side of ["left", "right"]) {
    const samples = value.temples?.[side]?.samplesMm ?? [];
    if (!Array.isArray(samples) || samples.length > 256) fail("samplesMm inválido.");
    const cells = value.temples?.[side]?.cellsMm ?? [];
    if (!Array.isArray(cells) || cells.length > 128) fail("cellsMm inválido.");
    temples[side] = { samplesMm: samples.map((p) => vector3(p, "samplesMm")), cellsMm: cells.map((cell) => {
      const min = vector3(cell.min, "cellsMm.min"), max = vector3(cell.max, "cellsMm.max");
      if (min.some((n, i) => n > max[i])) fail("cellsMm límites invertidos.");
      return { min, max };
    }) };
  }
  const templeBending = value.capabilities.templeBending === true;
  if (templeBending && (!nodes.templeLeft.length || !nodes.templeRight.length
    || !temples.left.samplesMm.length || !temples.right.samplesMm.length)) fail("bending requiere piezas y muestras por lado.");
  const identity = {};
  for (const key of ["modelId", "name", "sha256", "sku", "sourceFilename"]) {
    identity[key] = nonEmptyString(value.identity?.[key], `identity.${key}`);
  }
  if (!/^[a-f0-9]{64}$/.test(identity.sha256)) fail("sha256 inválido.");
  return {
    schemaVersion: 2, identity, nodes, anchors, dimensionsMm, temples,
    analysis: { status, confidence: unitInterval(value.analysis.confidence, "analysis.confidence"),
      warnings: (value.analysis.warnings ?? []).map((s) => nonEmptyString(s, "warning")) },
    capabilities: { level, templeBending, lensMaterials: value.capabilities.lensMaterials === true },
    normalization: { axisConvention: value.normalization.axisConvention,
      canonicalFromSource: [...matrix], scaleSource: value.normalization.scaleSource,
      millimetersPerUnit: positiveNumber(value.normalization.millimetersPerUnit, "millimetersPerUnit") },
    occlusion: { frontDepthMm: positiveNumber(value.occlusion?.frontDepthMm, "frontDepthMm"),
      maskFrontDepthMm: positiveNumber(value.occlusion?.maskFrontDepthMm, "maskFrontDepthMm") },
  };
}
