export const CLINICAL_TYPES = Object.freeze({
  OPTOMETRY: "Atención optométrica",
  CONTACTOLOGY: "Atención de contactología",
  GENERAL: "Atención clínica general"
});
export const CLINICAL_EYES = [["rightEye", "OD"], ["leftEye", "OI"]];
export const CLINICAL_LATERALITIES = [["OD", "OD"], ["OI", "OI"], ["BOTH", "Ambos ojos"], ["UNSPECIFIED", "Sin lateralidad consignada"]];
export const GLASSES_TYPES = [["MONOFOCAL", "Monofocal"], ["BIFOCAL", "Bifocal"], ["MULTIFOCAL", "Multifocal"]];
const optical = () => ({
  sphere: null,
  cylinder: null,
  axis: null,
  addition: null
});
export function emptyClinicalFormData(type) {
  if (type === "OPTOMETRY") return {
    ag: {
      present: null,
      notes: null
    },
    af: {
      present: null,
      notes: null
    },
    usesGlasses: null,
    glassesType: null,
    visualAcuity: {
      rightEye: {
        uncorrected: null,
        withGlasses: null
      },
      leftEye: {
        uncorrected: null,
        withGlasses: null
      }
    },
    rp: {
      pl: null,
      pc: null
    },
    observations: null
  };
  if (type === "CONTACTOLOGY") return {
    visualAcuity: {
      rightEye: {
        sc: null,
        cc: null,
        cclc: null
      },
      leftEye: {
        sc: null,
        cc: null,
        cclc: null
      }
    },
    irisDiameter: {
      rightEye: {
        value: null,
        unit: null
      },
      leftEye: {
        value: null,
        unit: null
      }
    },
    refraction: {
      rightEye: optical(),
      leftEye: optical()
    },
    preAdaptation: null,
    trialLenses: [],
    postAdaptation: null,
    overRefraction: {
      rightEye: {
        sphere: null,
        cylinder: null,
        axis: null,
        acuity: null
      },
      leftEye: {
        sphere: null,
        cylinder: null,
        axis: null,
        acuity: null
      }
    },
    finalLenses: []
  };
  return null;
}
export function clinicalDateToday(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).map(({
    type,
    value
  }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function clinicalAge(birthDate, encounterDate) {
  if (!birthDate || !encounterDate) return null;
  const birth = String(birthDate).slice(0, 10),
    date = String(encounterDate).slice(0, 10);
  if (date < birth) return null;
  return Number(date.slice(0, 4)) - Number(birth.slice(0, 4)) - (date.slice(5) < birth.slice(5) ? 1 : 0);
}
