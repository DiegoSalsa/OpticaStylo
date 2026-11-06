"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { readResponse, useInternalActor } from "@/components/internal/internal-shell";
import { MONEY_FORMATTER as money, PAYMENT_METHODS } from "./pos-form-model";

const labels={MANUAL_IN:"Ingreso extraordinario",MANUAL_OUT:"Egreso extraordinario",WITHDRAWAL:"Retiro parcial",PAYMENT:"Cobro en efectivo",REVERSAL:"Reverso autorizado"};
export default function CashRegisterPanel({branchId,onChange,revision=0}) {
  const actor=useInternalActor();
  const [terminals,setTerminals]=useState([]),[terminalId,setTerminalId]=useState("");
  const [session,setSession]=useState(null),[historical,setHistorical]=useState(null),[history,setHistory]=useState([]);
  const [historyPage,setHistoryPage]=useState(1),[consolidated,setConsolidated]=useState(false);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[counter,setCounter]=useState(0);
  const [counted,setCounted]=useState(""); const pending=useRef(false),keys=useRef(new Map());
  const canOperate=actor?.permissions.includes("cash.operate"),canManage=actor?.permissions.includes("cash.manage_all");
  useEffect(()=>{
    if(!branchId) return;
    const controller=new AbortController();
    fetch(`/api/cash-register/terminals?branchId=${branchId}`,{cache:"no-store",signal:controller.signal}).then(readResponse).then((rows)=>{if(!controller.signal.aborted){setTerminals(rows);setTerminalId((value)=>rows.some((r)=>r.id===value)?value:rows.find((r)=>r.own)?.id??rows.find((r)=>!r.occupied)?.id??rows[0]?.id??"");}}).catch((e)=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[branchId,onChange,counter]);
  useEffect(()=>{
    if(!terminalId)return;
    const controller=new AbortController();
    fetch(`/api/cash-register?terminalId=${terminalId}`,{cache:"no-store",signal:controller.signal}).then(readResponse).then((row)=>{if(!controller.signal.aborted){setSession(row);onChange?.(row);}}).catch((e)=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[terminalId,onChange,revision,counter]);
  const loadHistory=useCallback(async(signal)=>{
    if(!branchId)return;
    const rows=await readResponse(await fetch(`/api/cash-register?history=true&${consolidated?"consolidated=true":`branchId=${branchId}`}&page=${historyPage}`,{cache:"no-store",signal})); if(!signal?.aborted)setHistory(rows);
  },[branchId,historyPage,consolidated]);
  useEffect(()=>{const controller=new AbortController(); const timer=setTimeout(()=>{if(branchId)loadHistory(controller.signal).catch((e)=>{if(!controller.signal.aborted)setError(e.message);});},0); return()=>{clearTimeout(timer);controller.abort();};},[loadHistory,branchId,counter,revision]);
  async function request(url,body,message) {
    if(pending.current)return;pending.current=true;setBusy(true);setError("");setNotice("");
    const identity=`${url}:${JSON.stringify(body)}`;if(!keys.current.has(identity))keys.current.set(identity,crypto.randomUUID());
    try {
      const row=await readResponse(await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","X-Idempotency-Key":keys.current.get(identity)},body:JSON.stringify(body)}));
      keys.current.delete(identity);setNotice(message);
      if(url.endsWith("/terminals")){setCounter((v)=>v+1);return row;}
      if(row.status==="CLOSED"){setHistorical(row);setSession(null);onChange?.(null);}else{setHistorical(null);setSession(row);onChange?.(row);}
      await loadHistory();return row;
    } catch(e){setError(e.message);return null;} finally{pending.current=false;setBusy(false);}
  }
  const current=historical??session, selected=terminals.find((t)=>t.id===terminalId);
  return <section className="app-card cash-register-panel" aria-labelledby="cash-register-title">
    <div className="cash-register-heading"><div><p className="eyebrow">Caja · {current?.status==="CLOSED"?"Cierre guardado":session?"Abierta":"Sin sesión abierta"}</p><h2 id="cash-register-title">Caja de la sucursal</h2><p>{session?`${session.terminal.name} · Responsable: ${session.openedBy.name} · ${new Date(session.openedAt).toLocaleString("es-CL")}`:"Selecciona el punto de cobro para abrir o consultar tu sesión."}</p></div><button className="text-button" disabled={busy} type="button" onClick={()=>{setHistorical(null);setCounter((v)=>v+1);}}>Actualizar caja</button></div>
    {error&&<p className="inline-error" role="alert">{error}</p>}{notice&&<p className="inline-success" role="status">{notice}</p>}
    {!branchId?<p>Selecciona primero la sucursal de la venta.</p>:<>
      <label className="field"><span>Punto de cobro</span><select value={terminalId} disabled={busy} onChange={(e)=>{setTerminalId(e.target.value);setSession(null);onChange?.(null);setHistorical(null);setError("");}}><option value="">Selecciona una caja</option>{terminals.map((t)=><option key={t.id} value={t.id}>{t.name}{t.occupied?` · Abierta por ${t.responsible}`:" · Disponible"}</option>)}</select></label>
      {canManage&&<details className="cash-section"><summary>Agregar punto de cobro</summary><form className="cash-register-form" onSubmit={async(e)=>{e.preventDefault();const form=e.currentTarget;const row=await request("/api/cash-register/terminals",{branchId,name:new FormData(form).get("name")},"Punto de cobro creado.");if(row)form.reset();}}><label className="field"><span>Nombre del punto de cobro</span><input name="name" required maxLength={100}/></label><button className="app-button" disabled={busy}>Crear punto de cobro</button></form></details>}
      {!current&&terminalId&&canOperate&&(!selected?.occupied||selected?.own||canManage)&&<form className="cash-register-form" onSubmit={(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);request("/api/cash-register",{branchId,terminalId,openingAmountCents:Number(f.get("openingAmountCents")),openingNotes:f.get("openingNotes")||null},"Caja abierta y asociada a la sucursal.");}}><label className="field"><span>Fondo inicial de efectivo</span><input type="number" name="openingAmountCents" required min={0} max={1000000000}/></label><label className="field"><span>Observación de apertura</span><input name="openingNotes" maxLength={500}/></label><button className="app-button app-button--primary" disabled={busy}>Abrir caja</button></form>}
      {current&&<div className="cash-register-content">
        <p><strong>{current.branch?.name} · {current.terminal?.name}</strong> · {current.openedBy.name}</p>
        <dl className="cash-register-summary">{[["Fondo inicial",current.openingAmountCents],["Cobrado en efectivo",current.cashPaymentsCents],["Cobrado electrónico",current.electronicPaymentsCents],["Total cobrado",current.receivedCents],["Ingresos extraordinarios",current.manualInCents],["Egresos",current.manualOutCents],["Retiros parciales",current.withdrawalCents],["Reversos netos",current.reversalCents],["Efectivo esperado",current.expectedAmountCents]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money.format(value)}</dd></div>)}</dl>
        <p>{current.saleCount} ventas con cobros · {current.paymentCount} pagos registrados. Los medios electrónicos no aumentan el efectivo esperado.</p>
        {Object.entries(current.byMethod).map(([method,amount])=><span className="status-chip" key={method}>{PAYMENT_METHODS.find(([m])=>m===method)?.[1]??method}: {money.format(amount)}</span>)}
        {current.pending.length>0&&<p className="inline-error">{current.pending.length} ventas conservan saldo pendiente: {current.pending.map((p)=>`N.º ${p.saleNumber} (${money.format(p.balanceCents)})`).join(", ")}. El cierre exige una observación; estos saldos no se contabilizan como cobros.</p>}
        {current.status==="CLOSED"?<div className="cash-register-closed"><p>Caja cerrada · Contado: {money.format(current.closingCountedCents)} · Diferencia: {money.format(current.differenceCents)} · Cierre por {current.closedBy}.</p><p>{current.closingNotes}</p><button className="app-button" type="button" onClick={()=>{setHistorical(null);setCounter((v)=>v+1);}}>Volver a la caja actual</button></div>:canOperate&&<>
          <details className="cash-section"><summary>Ingreso, egreso o retiro de efectivo</summary><form className="cash-register-form" onSubmit={async(e)=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);const result=await request(`/api/cash-register/${session.id}/movements`,{movementType:f.get("movementType"),amountCents:Number(f.get("amountCents")),reason:f.get("reason")},"Movimiento registrado.");if(result)form.reset();}}><label className="field"><span>Movimiento</span><select name="movementType">{Object.entries(labels).filter(([type])=>["MANUAL_IN","MANUAL_OUT","WITHDRAWAL"].includes(type)).map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></label><label className="field"><span>Monto del movimiento</span><input type="number" name="amountCents" min={1} max={1000000000} required/></label><label className="field"><span>Motivo del movimiento</span><input name="reason" required maxLength={500}/></label><button className="app-button" disabled={busy}>Registrar movimiento</button></form></details>
          <details className="cash-section"><summary>Cerrar y arquear caja</summary><form className="cash-register-form cash-register-close" onSubmit={(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);request(`/api/cash-register/${session.id}/close`,{closingCountedCents:Number(counted),closingNotes:f.get("closingNotes")||null},"Cierre guardado. La sesión quedó bloqueada.");}}><label className="field"><span>Efectivo contado al cierre</span><input aria-label="Efectivo contado al cierre" type="number" required min={0} max={1000000000} value={counted} onChange={(e)=>setCounted(e.target.value)}/><small>Diferencia: {money.format(Number(counted||0)-current.expectedAmountCents)}</small></label><label className="field"><span>Observación de cierre</span><input name="closingNotes" maxLength={500} required={(counted!==""&&Number(counted)!==current.expectedAmountCents)||current.pending.length>0}/></label><button className="app-button app-button--primary" disabled={busy}>Confirmar cierre de caja</button></form></details>
        </>}
        <details className="cash-section"><summary>Movimientos y pagos de esta sesión</summary><div className="cash-ledger"><table><caption>Movimientos de efectivo</caption><thead><tr><th>Fecha</th><th>Tipo / operación</th><th>Importe</th><th>Motivo / responsable</th><th>Corrección</th></tr></thead><tbody>{current.movements.map((m)=><tr key={m.id}><td>{new Date(m.createdAt).toLocaleString("es-CL")}</td><td>{labels[m.movementType]}<small>{m.operationId}</small></td><td>{money.format(m.amountCents)}</td><td>{m.reason}<small>{m.actor}</small></td><td>{m.reversed?"Reversado":current.status==="OPEN"&&actor?.permissions.includes("cash.adjust")&&["MANUAL_IN","MANUAL_OUT","WITHDRAWAL"].includes(m.movementType)?<Reversal movement={m} disabled={busy} onReverse={(reason)=>request(`/api/cash-register/${current.id}/movements`,{movementType:"REVERSAL",reversalOf:m.id,reason},"Reverso registrado con trazabilidad.")}/>:"—"}</td></tr>)}</tbody></table><table><caption>Cobros acreditados en la sesión</caption><thead><tr><th>Venta</th><th>Medio</th><th>Importe</th><th>Referencia</th></tr></thead><tbody>{current.payments.map((p)=><tr key={p.id}><td>N.º {p.saleNumber}</td><td>{PAYMENT_METHODS.find(([m])=>m===p.paymentMethod)?.[1]??p.paymentMethod}</td><td>{money.format(p.amountCents)}</td><td>{p.reference??"—"}</td></tr>)}</tbody></table></div></details>
      </div>}
      <details className="cash-section"><summary>Historial de aperturas y cierres</summary>{canManage&&<label><input type="checkbox" checked={consolidated} onChange={(e)=>{setConsolidated(e.target.checked);setHistoryPage(1);}}/>Consultar todas las sucursales</label>}<div className="cash-ledger"><table><thead><tr><th>Apertura / sucursal</th><th>Caja / responsable</th><th>Estado</th><th>Esperado / contado</th><th>Diferencia</th><th>Detalle</th></tr></thead><tbody>{history.map((row)=><tr key={row.id}><td>{new Date(row.openedAt).toLocaleString("es-CL")}<small>{row.branch}</small></td><td>{row.terminal}<small>{row.responsible}</small></td><td>{row.status==="CLOSED"?"Cerrada":"Abierta"}</td><td>{row.expectedAmountCents==null?"—":money.format(row.expectedAmountCents)} / {row.countedCents==null?"—":money.format(row.countedCents)}</td><td>{row.differenceCents==null?"—":money.format(row.differenceCents)}</td><td>{row.status==="CLOSED"&&row.branch!=="Histórica sin atribuir"&&<button className="text-button" type="button" onClick={async()=>{try{setHistorical(await readResponse(await fetch(`/api/cash-register/${row.id}`,{cache:"no-store"})));}catch(e){setError(e.message);}}}>Ver cierre</button>}</td></tr>)}</tbody></table></div><div className="editor-actions"><button className="app-button" type="button" disabled={historyPage<=1} onClick={()=>setHistoryPage((v)=>v-1)}>Más recientes</button><span>Página {historyPage}</span><button className="app-button" type="button" disabled={history.length<30} onClick={()=>setHistoryPage((v)=>v+1)}>Más antiguas</button></div></details>
    </>}
  </section>;
}
function Reversal({movement,disabled,onReverse}) {
  const [reason,setReason]=useState(""); return <details><summary>Reversar</summary><form onSubmit={(e)=>{e.preventDefault();onReverse(reason);}}><label className="field"><span>Motivo del reverso de {movement.id}</span><input required maxLength={500} value={reason} onChange={(e)=>setReason(e.target.value)}/></label><button className="app-button" disabled={disabled}>Confirmar reverso</button></form></details>;
}
