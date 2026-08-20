export const TRY_ON_MODEL_SCHEMA_VERSION = 1;

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
 * Validates and normalizes the sidecar generated once when a GLB enters the
 * platform. This module is intentionally browser-safe so the importer and the
 * try-on runtime share exactly the same contract.
 */
export function validateTryOnModelMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("se esperaba un objeto.");
  }
  if (value.schemaVersion !== TRY_ON_MODEL_SCHEMA_VERSION) {
    fail(`schemaVersion debe ser ${TRY_ON_MODEL_SCHEMA_VERSION}.`);
  }

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
    schemaVersion: TRY_ON_MODEL_SCHEMA_VERSION,
  };
}
