import { emptyClinicalFormData } from "../../src/config/clinical-forms.js";
export const clinicalDemo = {
  professionalId: "40000000-0000-4000-8000-000000000001",
  colleagueId: "40000000-0000-4000-8000-000000000002",
  patientId: "40000000-0000-4000-8000-000000000003",
  otherPatientId: "40000000-0000-4000-8000-000000000004",
  appointmentId: "40000000-0000-4000-8000-000000000005",
  email: "clinica-sintetica@example.invalid",
  colleagueEmail: "clinica-colega@example.invalid"
};
export function optometryData() {
  return {
    ...emptyClinicalFormData("OPTOMETRY"),
    ag: {
      present: true,
      notes: "AG sintético\nSegunda línea"
    },
    af: {
      present: false,
      notes: "AF sintético"
    },
    usesGlasses: true,
    glassesType: "MULTIFOCAL",
    visualAcuity: {
      rightEye: {
        uncorrected: "20/40-2",
        withGlasses: "20/20"
      },
      leftEye: {
        uncorrected: "Cuenta dedos",
        withGlasses: "20/25+1"
      }
    },
    rp: {
      pl: "PL registrado",
      pc: "PC registrado"
    },
    observations: "Observación sintética <script>alert(1)</script>"
  };
}
export function contactologyData() {
  const d = emptyClinicalFormData("CONTACTOLOGY");
  d.visualAcuity = {
    rightEye: {
      sc: "20/50",
      cc: "20/25",
      cclc: "20/20"
    },
    leftEye: {
      sc: "20/40",
      cc: "20/25+1",
      cclc: "20/20-1"
    }
  };
  d.irisDiameter = {
    rightEye: {
      value: 11.75,
      unit: "mm"
    },
    leftEye: {
      value: 11.65,
      unit: null
    }
  };
  d.refraction = {
    rightEye: {
      sphere: 1.1,
      cylinder: -0.35,
      axis: 83,
      addition: 1.25
    },
    leftEye: {
      sphere: -2.15,
      cylinder: 0,
      axis: 0,
      addition: null
    }
  };
  d.preAdaptation = "Hallazgo PRE sintético";
  d.postAdaptation = "Hallazgo POST sintético";
  d.trialLenses = ["OD", "OI", "UNSPECIFIED"].map((eye, i) => ({
    eye,
    lens: `Prueba sintética ${i + 1}`,
    sphere: i === 0 ? 1.1 : -1.35,
    cylinder: -0.1,
    axis: 90 + i,
    acuity: "20/20-1",
    notes: `Observación prueba ${i + 1}`
  }));
  d.overRefraction = {
    rightEye: {
      sphere: 0.1 + 0.2,
      cylinder: -0.25,
      axis: 78,
      acuity: "20/20"
    },
    leftEye: {
      sphere: -0.15,
      cylinder: 0,
      axis: null,
      acuity: "20/25"
    }
  };
  d.finalLenses = ["OI", "OD"].map((eye, i) => ({
    eye,
    lens: `Final sintético ${i + 1}`,
    sphere: i === 0 ? -2.15 : 1.1,
    cylinder: 0,
    axis: null,
    diameter: {
      value: 14.2,
      unit: "mm"
    },
    lcType: "Tipo de LC sintético"
  }));
  return d;
}
