"use client";

import { useEffect, useState } from "react";
import { readResponse } from "@/components/internal/internal-shell";
export default function CareAssignmentPanel({
  patientId
}) {
  const [options, setOptions] = useState([]),
    [rows, setRows] = useState([]),
    [professionalId, setProfessionalId] = useState(""),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/clinical-care-assignments?options=true").then(readResponse), fetch(`/api/clinical-care-assignments?patientId=${patientId}`).then(readResponse)]).then(([o, r]) => {
      if (active) {
        setOptions(o);
        setRows(r);
      }
    }).catch(e => {
      if (active) setNotice(e.message);
    });
    return () => {
      active = false;
    };
  }, [patientId]);
  async function submit(e, row) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await readResponse(await fetch("/api/clinical-care-assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(row ? {
          action: "REVOKE",
          id: row.id,
          reason
        } : {
          patientId,
          professionalId,
          reason,
          confirmPatient: confirmed
        })
      }));
      setRows(await readResponse(await fetch(`/api/clinical-care-assignments?patientId=${patientId}`)));
      setReason("");
      setConfirmed(false);
      setNotice(row ? "Asignación revocada." : "Atención asignada al profesional.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="app-card">
  <h2>Asignación de atención presencial</h2>
  <p>Verifique la identidad por RUT y la atención solicitada. Esta gestión concede acceso al profesional seleccionado.</p>
  {notice && <p role="status">{notice}</p>}
  <form onSubmit={submit}>
    <label className="field"><span>Profesional clínico</span><select value={professionalId} required onChange={e => setProfessionalId(e.target.value)}><option value="">Seleccione</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
    <label className="field"><span>Motivo de asignación o revocación</span><input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
    <label><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Verifiqué identidad y atención solicitada para este paciente</label>
    <div className="editor-actions">
      <button className="app-button app-button--soft" disabled={busy}>Asignar atención</button>
    </div>
  </form>
  {rows.map(r => <div key={r.id}>
    <p>{r.professional} · {r.revokedAt ? "Revocada" : "Activa"} · {r.reason}</p>
    {!r.revokedAt && <button type="button" disabled={busy || !reason.trim()} onClick={e => submit(e, r)}>Revocar asignación</button>}
  </div>)}
</section>;
}
