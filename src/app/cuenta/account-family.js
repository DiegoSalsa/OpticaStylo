"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import RutInput from "@/components/ui/rut-input";
import { formatChileanRut } from "@/utils/chilean-rut";
import { readStoreResponse } from "@/utils/store-client";
import AccountAppointments from "./account-appointments";
import AccountPrescriptions from "./account-prescriptions";
import AccountSavedPrescriptions from "./account-saved-prescriptions";
import AccountClinicalLink from "./account-clinical-link";

const endpoint = "/api/store/accounts/me/dependants";
const familyHref = "/cuenta?seccion=menores";

function DependantHistory({ account, dependant, onExpired }) {
  const [clinical, setClinical] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [verify, setVerify] = useState(false);
  const reload = () => setAttempt((current) => current + 1);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/store/accounts/me/clinical?dependantId=" + dependant.id, { cache: "no-store", signal: controller.signal })
      .then(readStoreResponse).then((data) => { if (!controller.signal.aborted) setClinical(data); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [dependant.id, attempt]);
  if (!dependant.isMinor) return <p>Al cumplir 18 años, esta persona debe gestionar sus atenciones desde su propia cuenta.</p>;
  return <section className="account-card">
    <h2>Atenciones y recetas de la óptica</h2>
    {error && <p className="inline-error" role="alert">{error} <button onClick={() => { setError(""); reload(); }} type="button">Reintentar</button></p>}
    {!clinical && !error && <p role="status">Consultando sus atenciones…</p>}
    {clinical && !clinical.linked && <>
      <p>Las atenciones aparecerán aquí cuando la ficha tenga registrado al adulto responsable de esta cuenta.</p>
      <button className="button button--secondary" onClick={() => setVerify((current) => !current)} type="button">Consultar atenciones anteriores</button>
      {verify && <AccountClinicalLink dependantId={dependant.id} onLinked={reload} onExpired={onExpired} />}
    </>}
    {clinical?.linked && <>
      <AccountAppointments clinical={clinical} standalone reload={reload} />
      <AccountPrescriptions accountId={account.id} prescriptions={clinical.prescriptions} standalone />
      <h3>Historial de atenciones</h3>
      {clinical.encounters?.length ? clinical.encounters.map((item) => <article className="prescription-row" key={item.id}>
        <strong>{item.type === "CONTACTOLOGY" ? "Contactología" : item.type === "OPTOMETRY" ? "Optometría" : "Atención clínica"}</strong>
        <span>{new Date(item.date).toLocaleDateString("es-CL", { timeZone: "UTC" })}</span>
        <p>{item.reason}</p>
      </article>) : <p>Todavía no hay atenciones finalizadas registradas.</p>}
    </>}
  </section>;
}

export default function AccountFamily({ account, onExpired }) {
  const params = useSearchParams();
  const [records, setRecords] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const selected = records?.find(({ id }) => id === params.get("menor"));

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(readStoreResponse)
      .then((items) => { if (!controller.signal.aborted) setRecords(items); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [attempt]);

  async function add(event) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await readStoreResponse(await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      form.reset();
      setAttempt((current) => current + 1);
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(false); }
  }

  return <>
    <header><h1>Menores a mi cargo</h1><p>Administra sus datos, recetas y atenciones desde tu cuenta.</p></header>
    {error && <p role="alert" className="inline-error">{error} <button onClick={() => { setError(""); setAttempt((current) => current + 1); }} type="button">Reintentar</button></p>}
    {!records && !error && <p role="status">Cargando los perfiles…</p>}
    {selected ? <>
      <Link className="account-family-back" href={familyHref}>Volver a Menores a mi cargo</Link>
      <section className="account-card account-data"><h2>{selected.firstNames} {selected.lastNames}</h2>
        <dl><div><dt>RUT</dt><dd>{formatChileanRut(selected.rut)}</dd></div><div><dt>Fecha de nacimiento</dt><dd>{new Date(selected.birthDate + "T00:00:00Z").toLocaleDateString("es-CL", { timeZone: "UTC" })}</dd></div><div><dt>Tu relación</dt><dd>{selected.relationship}</dd></div></dl>
      </section>
      <AccountSavedPrescriptions key={selected.id} dependantId={selected.id} title={"Recetas de " + selected.firstNames} />
      <DependantHistory account={account} dependant={selected} key={selected.id} onExpired={onExpired} />
    </> : <>
      <section className="account-card">
        {records?.length === 0 && <p>Aún no has añadido menores a tu cargo.</p>}
        {records?.map((item) => <article className="prescription-row" key={item.id}>
          <strong>{item.firstNames} {item.lastNames}</strong><span>{formatChileanRut(item.rut)} · {item.relationship}</span>
          <Link className="button button--secondary" href={familyHref + "&menor=" + item.id}>Ver datos, recetas y atenciones</Link>
        </article>)}
      </section>
      <section className="account-card"><h2>Añadir menor a mi cargo</h2><form className="account-family-form" onSubmit={add}>
        <label className="field"><span>Nombres del menor</span><input name="firstNames" required maxLength={150} disabled={busy} /></label>
        <label className="field"><span>Apellidos del menor</span><input name="lastNames" required maxLength={150} disabled={busy} /></label>
        <label className="field"><span>RUT del menor</span><RutInput name="rut" required disabled={busy} /></label>
        <label className="field"><span>Fecha de nacimiento del menor</span><input name="birthDate" type="date" required disabled={busy} /></label>
        <label className="field"><span>Tu relación con el menor</span><select name="relationship" required disabled={busy}><option value="">Selecciona</option><option>Madre</option><option>Padre</option><option>Tutor o tutora legal</option></select></label>
        <button className="button button--primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Añadir menor"}</button>
      </form></section>
    </>}
  </>;
}
