"use client";

import { useEffect, useState } from "react";
import { agendaContracts, readAgendaResponse } from "./agenda-api";

function ProfessionalRow({ item, onSaved }) {
  const [form, setForm] = useState(item);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/professionals/${item.id}`, {
        body: JSON.stringify({ appointmentDurationMinutes: Number(form.appointmentDurationMinutes), isBookable: form.isBookable, slotIntervalMinutes: Number(form.slotIntervalMinutes) }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const saved = await readAgendaResponse(response, agendaContracts.professional);
      setForm(saved);
      onSaved(saved);
    } catch (requestError) {
      setError(requestError.message);
    } finally { setSaving(false); }
  }
  return <div className="professional-row"><div><strong>{item.firstName} {item.lastName}</strong><small>{item.email}</small></div><label>Duración<input max="480" min="5" onChange={(event)=>setForm({...form,appointmentDurationMinutes:event.target.value})} type="number" value={form.appointmentDurationMinutes} /></label><label>Intervalo<input max="120" min="5" onChange={(event)=>setForm({...form,slotIntervalMinutes:event.target.value})} type="number" value={form.slotIntervalMinutes} /></label><label className="bookable-check"><input checked={form.isBookable} onChange={(event)=>setForm({...form,isBookable:event.target.checked})} type="checkbox" /> Reserva web</label><button className="app-button app-button--soft" disabled={saving} onClick={save} type="button">{saving?"Guardando…":"Guardar"}</button>{error && <p className="inline-error" role="alert">{error}</p>}</div>;
}

export default function ProfessionalManager({ onChanged, professionals }) {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    fetch("/api/users?pageSize=100", { signal })
      .then((response) => readAgendaResponse(response, agendaContracts.users))
      .then((data) => {
        if (!signal.aborted) setUsers(data.items.filter((item) => item.isActive && item.roles.includes("CLINICAL_PROFESSIONAL")));
      })
      .catch((error) => { if (!signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, []);
  const available=users.filter((user)=>!professionals.some((item)=>item.id===user.id));
  async function create(event){event.preventDefault();const form=new FormData(event.currentTarget);setSaving(true);setMessage("");try{const saved=await readAgendaResponse(await fetch("/api/professionals",{body:JSON.stringify({appointmentDurationMinutes:Number(form.get("duration")),isBookable:form.get("bookable")==="on",slotIntervalMinutes:Number(form.get("interval")),userId}),headers:{"Content-Type":"application/json"},method:"POST"}), agendaContracts.professional);onChanged((items)=>[...items,saved]);setUserId("");setMessage("Perfil profesional creado.");}catch(error){setMessage(error.message);}finally{setSaving(false);}}
  function update(saved){onChanged((items)=>items.map((item)=>item.id===saved.id?saved:item));setMessage("Perfil actualizado.");}
  return <section className="app-card professional-manager"><div><h2>Perfiles profesionales</h2><p>Solo usuarios activos con rol clínico pueden recibir agenda.</p></div><div className="professional-list">{professionals.map((item)=><ProfessionalRow item={item} key={item.id} onSaved={update} />)}</div>{available.length>0&&<form className="professional-create" onSubmit={create}><label className="field"><span>Usuario clínico sin perfil</span><select onChange={(event)=>setUserId(event.target.value)} required value={userId}><option value="">Selecciona</option>{available.map((user)=><option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}</select></label><label className="field"><span>Duración (min)</span><input defaultValue="30" max="480" min="5" name="duration" required type="number" /></label><label className="field"><span>Intervalo (min)</span><input defaultValue="30" max="120" min="5" name="interval" required type="number" /></label><label className="bookable-check"><input defaultChecked name="bookable" type="checkbox" /> Disponible en web</label><button className="app-button app-button--primary" disabled={saving} type="submit">Crear perfil</button></form>}{message&&<p aria-live="polite" className={message.includes("creado")||message.includes("actualizado")?"inline-success":"inline-error"}>{message}</p>}</section>;
}
