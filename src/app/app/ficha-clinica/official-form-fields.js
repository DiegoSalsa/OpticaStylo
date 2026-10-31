"use client";

import { CLINICAL_EYES, CLINICAL_LATERALITIES, GLASSES_TYPES } from "@/config/clinical-forms";
export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  ...props
}) {
  const Tag = multiline ? "textarea" : "input";
  return <label className="field"><span>{label}</span><Tag value={value ?? ""} onChange={e => onChange(e.target.value)} maxLength={multiline ? 10000 : 80} {...props} /></label>;
}
const opticalFields = [["sphere", "ESF"], ["cylinder", "CIL"], ["axis", "EJE"]];
export function officialFormForEditing(record) {
  const signed = new Set(["sphere", "cylinder", "addition"]);
  function visit(value, key) {
    if (Array.isArray(value)) return value.map(v => visit(v));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v, k)]));
    return typeof value === "number" && signed.has(key) && value > 0 ? `+${value}` : value;
  }
  return visit(record);
}
export function officialFormPayload(data) {
  const numeric = new Set(["sphere", "cylinder", "axis", "addition", "value", "diameter"]);
  function visit(value, key) {
    if (Array.isArray(value)) return value.map(v => visit(v));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v, k)]));
    if (!numeric.has(key) || value == null) return value;
    if (String(value).trim() === "") return null;
    const raw = String(value).trim().replace(",", ".");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw))) throw new Error("Complete los valores numéricos; se admiten signos y coma decimal.");
    return Number(raw);
  }
  return visit(data);
}
export default function OfficialFormFields({
  type,
  data,
  setData
}) {
  function set(path, value) {
    const next = structuredClone(data);
    let target = next;
    path.slice(0, -1).forEach(key => {
      target = target[key];
    });
    target[path.at(-1)] = value;
    setData(next);
  }
  function fields(path, values) {
    return values.map(([key, label]) => <TextField key={key} label={label} multiline={["notes", "pl", "pc"].includes(key)} maxLength={key === "notes" ? 2000 : ["pl", "pc"].includes(key) ? 5000 : ["lens", "lcType"].includes(key) ? 200 : 80} value={path.reduce((v, k) => v?.[k], data)?.[key]} inputMode={["sphere", "cylinder", "axis", "addition", "value"].includes(key) ? "decimal" : undefined} onChange={v => set([...path, key], v)} />);
  }
  function eyes(title, key, columns) {
    return <details className="clinical-form-section">
  <summary>{title}</summary>
  <div className="clinical-eye-pair">
    {CLINICAL_EYES.map(([eye, label]) => <fieldset key={eye}>
      <legend>{label}</legend>
      <div className="management-fields">
        {fields([key, eye], columns)}
      </div>
    </fieldset>)}
  </div>
</details>;
  }
  function yesNo(label, path, value) {
    return <label className="field"><span>{label}</span><select value={value == null ? "" : String(value)} onChange={e => set(path, e.target.value === "" ? null : e.target.value === "true")}><option value="">Sin registrar</option><option value="true">Sí</option><option value="false">No</option></select></label>;
  }
  function rows(title, key, final = false) {
    const list = data[key];
    function updateList(next) {
      set([key], next);
    }
    function move(index, offset) {
      const next = [...list];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      updateList(next);
    }
    return <details className="clinical-form-section">
  <summary>{title}</summary>
  {list.map((row, i) => <fieldset key={i} aria-label={`${title} ${i + 1}`}>
    <legend>{title} · {i + 1}</legend>
    <div className="management-fields">
      <label className="field"><span>Lateralidad</span><select value={row.eye ?? ""} onChange={e => set([key, i, "eye"], e.target.value || null)}><option value="">Seleccione explícitamente</option>{CLINICAL_LATERALITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {fields([key, i], [["lens", title], ...opticalFields, ...(final ? [["lcType", "Tipo de LC"]] : [["acuity", "AV"], ["notes", "Observaciones"]])])}
      {final && fields([key, i, "diameter"], [["value", "Diámetro"], ["unit", "Unidad del diámetro"]])}
    </div>
    <div className="clinical-actions">
      <button type="button" disabled={i === 0} onClick={() => move(i, -1)}>Subir fila</button>
      <button type="button" disabled={i === list.length - 1} onClick={() => move(i, 1)}>Bajar fila</button>
      <button type="button" onClick={() => updateList(list.filter((_, n) => n !== i))}>Quitar fila {i + 1}</button>
    </div>
  </fieldset>)}
  <button className="app-button app-button--soft" type="button" onClick={() => updateList([...list, {
        eye: null,
        lens: null,
        sphere: null,
        cylinder: null,
        axis: null,
        ...(final ? {
          diameter: {
            value: null,
            unit: null
          },
          lcType: null
        } : {
          acuity: null,
          notes: null
        })
      }])}>Agregar {final ? "lente final" : "lente de prueba"}</button>
</details>;
  }
  if (type === "OPTOMETRY") return <>
    <details className="clinical-form-section">
  <summary>Antecedentes mórbidos y uso de lentes</summary>
  <div className="management-fields">
    {["ag", "af"].map(key => <div key={key}>
      {yesNo(key.toUpperCase(), [key, "present"], data[key].present)}
      <TextField label={`Detalle ${key.toUpperCase()}`} multiline maxLength={5000} value={data[key].notes} onChange={v => set([key, "notes"], v)} />
    </div>)}
    {yesNo("Usuario actual de lentes", ["usesGlasses"], data.usesGlasses)}
    <label className="field"><span>Tipo de lentes</span><select value={data.glassesType ?? ""} onChange={e => set(["glassesType"], e.target.value || null)}><option value="">Sin registrar</option>{GLASSES_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
  </div>
</details>
    {eyes("Examen de agudeza visual", "visualAcuity", [["uncorrected", "Sin corrección de lejos"], ["withGlasses", "Con sus lentes de lejos"]])}
    <details className="clinical-form-section">
  <summary>RP y observaciones</summary>
  <div className="management-fields">
    {fields(["rp"], [["pl", "PL"], ["pc", "PC"]])}
  </div>
  <TextField label="Observaciones" multiline value={data.observations} onChange={v => set(["observations"], v)} />
</details>
  </>;
  if (type !== "CONTACTOLOGY") return null;
  return <>
    {eyes("Agudeza visual", "visualAcuity", [["sc", "SC"], ["cc", "CC"], ["cclc", "CC.lc"]])}
    {eyes("Diámetro iris", "irisDiameter", [["value", "Diámetro iris"], ["unit", "Unidad consignada"]])}
    {eyes("Refracción", "refraction", [...opticalFields, ["addition", "ADD"]])}
    <details className="clinical-form-section">
  <summary>Lámpara de hendidura preadaptación</summary>
  <TextField label="Hallazgos preadaptación" multiline value={data.preAdaptation} onChange={v => set(["preAdaptation"], v)} />
</details>
    {rows("Lente de prueba", "trialLenses")}
    <details className="clinical-form-section">
  <summary>Lámpara de hendidura postadaptación</summary>
  <TextField label="Hallazgos postadaptación" multiline value={data.postAdaptation} onChange={v => set(["postAdaptation"], v)} />
</details>
    {eyes("Sobrerrefracción", "overRefraction", [...opticalFields, ["acuity", "AV.clc"]])}
    {rows("Lente final", "finalLenses", true)}
  </>;
}
