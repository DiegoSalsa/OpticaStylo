import { AppError } from "../utils/app-error.js";
import { isOpticalDecimal, normalizedOpticalDecimal } from "../utils/optical-decimal.js";
import { CLINICAL_TYPES, CLINICAL_LATERALITIES, GLASSES_TYPES, clinicalDateToday } from "../config/clinical-forms.js";
export function clinicalInvalid(message, code = "INVALID_CLINICAL_DATA", status = 400) {
  throw new AppError({
    code,
    message,
    status
  });
}
export function clinicalObject(value, allowed, label = "El formulario") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) clinicalInvalid(`${label} no es válido.`);
  if (Object.keys(value).some(key => !allowed.includes(key))) clinicalInvalid(`${label} contiene campos no admitidos.`);
  return value;
}
export function clinicalText(value, label, limit = 10000) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > limit) clinicalInvalid(`${label} debe ser texto de hasta ${limit} caracteres.`);
  return value.replace(/\r\n?/g, "\n").trim() || null;
}
export function clinicalVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) clinicalInvalid("Indique la versión del borrador que está editando.");
  return value;
}
export function clinicalDate(value, {
  optional = false,
  currentDate = new Date()
} = {}) {
  if (optional && value == null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value || value > clinicalDateToday(currentDate)) clinicalInvalid("La fecha de atención debe ser una fecha válida y no futura.");
  return value;
}
export function clinicalType(value) {
  if (!Object.hasOwn(CLINICAL_TYPES, value)) clinicalInvalid("Seleccione un tipo de ficha válido.");
  return value;
}
function number(value, label, positive = false) {
  if (value == null || value === "") return null;
  if (!isOpticalDecimal(value) || positive && value <= 0) clinicalInvalid(`${label} debe ser un número ${positive ? "positivo " : ""}con hasta dos decimales.`);
  return normalizedOpticalDecimal(value);
}
function bool(value, label) {
  if (value == null) return null;
  if (typeof value !== "boolean") clinicalInvalid(`${label} debe indicar sí, no o sin registrar.`);
  return value;
}
function textFields(input, fields, label) {
  clinicalObject(input ?? {}, fields, label);
  return Object.fromEntries(fields.map(field => [field, clinicalText(input?.[field], `${label}: ${field}`, field === "notes" ? 2000 : 80)]));
}
function optical(input, label, {
  final = false,
  addition = false,
  acuity = false
} = {}) {
  clinicalObject(input ?? {}, ["sphere", "cylinder", "axis", ...(addition ? ["addition"] : []), ...(acuity ? ["acuity"] : [])], label);
  const sphere = number(input?.sphere, `${label}: ESF`),
    cylinder = number(input?.cylinder, `${label}: CIL`);
  let axis = input?.axis ?? null;
  if (axis !== null && (!Number.isInteger(axis) || axis < 0 || axis > 180)) clinicalInvalid(`${label}: EJE debe ser un entero entre 0 y 180.`);
  if (final && cylinder !== null && cylinder !== 0 && axis === null) clinicalInvalid(`${label}: registre EJE cuando CIL no sea cero.`);
  return {
    sphere,
    cylinder,
    axis,
    ...(addition ? {
      addition: number(input?.addition, `${label}: ADD`)
    } : {}),
    ...(acuity ? {
      acuity: clinicalText(input?.acuity, `${label}: AV`, 80)
    } : {})
  };
}
function eyes(input, map, label) {
  clinicalObject(input ?? {}, ["rightEye", "leftEye"], label);
  return {
    rightEye: map(input?.rightEye, "OD"),
    leftEye: map(input?.leftEye, "OI")
  };
}
function diameter(input, label) {
  clinicalObject(input ?? {}, ["value", "unit"], label);
  return {
    value: number(input?.value, label, true),
    unit: clinicalText(input?.unit, `${label}: unidad`, 20)
  };
}
function side(value, label, final, filled) {
  if (value == null || value === "") {
    if (final && filled) clinicalInvalid(`${label}: indique la lateralidad, o consigne explícitamente que no consta.`);
    return null;
  }
  if (!CLINICAL_LATERALITIES.some(([code]) => code === value)) clinicalInvalid(`${label}: lateralidad no válida.`);
  return value;
}
function rows(input, label, map) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 100) clinicalInvalid(`${label} admite hasta 100 filas por solicitud.`);
  return input.map(map);
}
export function hasClinicalValue(value) {
  return value !== null && value !== undefined && value !== "" && (Array.isArray(value) ? value.some(hasClinicalValue) : typeof value === "object" ? Object.values(value).some(hasClinicalValue) : true);
}
export function validateClinicalFormData(type, input, {
  final = false
} = {}) {
  clinicalType(type);
  if (type === "GENERAL") {
    if (input != null) clinicalObject(input, [], "La ficha general");
    return null;
  }
  if (type === "OPTOMETRY") {
    const data = clinicalObject(input ?? {}, ["ag", "af", "usesGlasses", "glassesType", "visualAcuity", "rp", "observations"]);
    const antecedent = (value, label) => {
      clinicalObject(value ?? {}, ["present", "notes"], label);
      return {
        present: bool(value?.present, label),
        notes: clinicalText(value?.notes, label, 5000)
      };
    };
    const usesGlasses = bool(data.usesGlasses, "Uso actual de lentes"),
      glassesType = data.glassesType ?? null;
    if (glassesType !== null && !GLASSES_TYPES.some(([key]) => key === glassesType)) clinicalInvalid("El tipo de lentes no es válido.");
    if (usesGlasses === false && glassesType !== null) clinicalInvalid("El tipo de lentes solo corresponde cuando se registra uso actual.");
    clinicalObject(data.rp ?? {}, ["pl", "pc"], "RP");
    return {
      ag: antecedent(data.ag, "AG"),
      af: antecedent(data.af, "AF"),
      usesGlasses,
      glassesType,
      visualAcuity: eyes(data.visualAcuity, (v, eye) => textFields(v, ["uncorrected", "withGlasses"], `AV ${eye}`), "Agudeza visual"),
      rp: {
        pl: clinicalText(data.rp?.pl, "RP PL", 5000),
        pc: clinicalText(data.rp?.pc, "RP PC", 5000)
      },
      observations: clinicalText(data.observations, "Observaciones")
    };
  }
  const data = clinicalObject(input ?? {}, ["visualAcuity", "irisDiameter", "refraction", "preAdaptation", "trialLenses", "postAdaptation", "overRefraction", "finalLenses"]);
  return {
    visualAcuity: eyes(data.visualAcuity, (v, eye) => textFields(v, ["sc", "cc", "cclc"], `AV ${eye}`), "Agudeza visual"),
    irisDiameter: eyes(data.irisDiameter, (v, eye) => diameter(v, `Diámetro iris ${eye}`), "Diámetro iris"),
    refraction: eyes(data.refraction, (v, eye) => optical(v, `Refracción ${eye}`, {
      final,
      addition: true
    }), "Refracción"),
    preAdaptation: clinicalText(data.preAdaptation, "Lámpara de hendidura preadaptación"),
    trialLenses: rows(data.trialLenses, "Lentes de prueba", (row, index) => {
      const label = `Prueba ${index + 1}`;
      clinicalObject(row, ["eye", "lens", "sphere", "cylinder", "axis", "acuity", "notes"], label);
      const {
        sphere,
        cylinder,
        axis,
        acuity
      } = optical({
        sphere: row.sphere,
        cylinder: row.cylinder,
        axis: row.axis,
        acuity: row.acuity
      }, label, {
        final,
        acuity: true
      });
      const lens = clinicalText(row.lens, `${label}: lente`, 200),
        notes = clinicalText(row.notes, `${label}: observaciones`, 2000);
      return {
        eye: side(row.eye, label, final, hasClinicalValue({
          sphere,
          cylinder,
          axis,
          acuity,
          lens,
          notes
        })),
        lens,
        sphere,
        cylinder,
        axis,
        acuity,
        notes
      };
    }),
    postAdaptation: clinicalText(data.postAdaptation, "Lámpara de hendidura postadaptación"),
    overRefraction: eyes(data.overRefraction, (v, eye) => optical(v, `Sobrerrefracción ${eye}`, {
      final,
      acuity: true
    }), "Sobrerrefracción"),
    finalLenses: rows(data.finalLenses, "Lentes finales", (row, index) => {
      const label = `Lente final ${index + 1}`;
      clinicalObject(row, ["eye", "lens", "sphere", "cylinder", "axis", "diameter", "lcType"], label);
      const {
        sphere,
        cylinder,
        axis
      } = optical({
        sphere: row.sphere,
        cylinder: row.cylinder,
        axis: row.axis
      }, label, {
        final
      });
      const lens = clinicalText(row.lens, `${label}: lente`, 200),
        d = diameter(row.diameter, `${label}: diámetro`),
        lcType = clinicalText(row.lcType, `${label}: tipo de LC`, 200);
      return {
        eye: side(row.eye, label, final, hasClinicalValue({
          sphere,
          cylinder,
          axis,
          lens,
          diameter: d,
          lcType
        })),
        lens,
        sphere,
        cylinder,
        axis,
        diameter: d,
        lcType
      };
    })
  };
}
