"use client";
import { useState } from "react";
import { PAYMENT_METHODS } from "./pos-form-model";
export default function PosPaymentPanel({model}) {
  const {sale,money,pending,cashRegister,registerPayment,receipt,reset,customer,issueCurrentReceipt}=model;
  const [parts,setParts]=useState([{method:"CASH",amount:String(sale?.balanceCents??0),received:"",reference:""}]);
  const patch=(index,field,value)=>setParts((rows)=>rows.map((row,i)=>i===index?{...row,[field]:value}:row));
  const paid=parts.reduce((sum,p)=>sum+Number(p.amount||0),0);
  const validSession=cashRegister?.status==="OPEN"&&cashRegister.branchId===sale?.branchId;
  return <>
    {sale?.payments?.length>0&&<section className="payment-history" aria-labelledby="payment-history-title"><h3 id="payment-history-title">Pagos recibidos</h3><ul>{sale.payments.map((payment)=><li key={payment.id}><span><strong>{PAYMENT_METHODS.find(([m])=>m===payment.paymentMethod)?.[1]??payment.paymentMethod}</strong><small>{money.format(payment.amountCents)}{payment.reference&&` · ${payment.reference}`}</small></span>{payment.receipt?<a href={`/api/sales/${sale.id}/receipt/print?receiptId=${payment.receipt.id}`} rel="noreferrer" target="_blank">Comprobante N.º {payment.receipt.receiptNumber}</a>:<button className="text-button" disabled={pending} type="button" onClick={()=>issueCurrentReceipt(payment.id)}>Emitir comprobante del pago</button>}</li>)}</ul></section>}
    {sale?.status==="PENDING"&&<form className="payment-form" onSubmit={registerPayment}>
      <h3>Cobrar venta · Saldo {money.format(sale.balanceCents)}</h3>
      <p>{validSession?`${cashRegister.terminal.name} · ${cashRegister.openedBy.name}`:"Abre o selecciona una caja de la sucursal antes de cobrar."}</p>
      <input type="hidden" name="parts" value={parts.length}/>
      {parts.map((part,index)=><fieldset className="payment-part" key={index}><legend>Pago {index+1}</legend>
        <label className="field"><span>Medio de pago {index+1}</span><select name={`method-${index}`} value={part.method} onChange={(e)=>patch(index,"method",e.target.value)}>{PAYMENT_METHODS.map(([method,label])=><option key={method} value={method}>{label}</option>)}</select></label>
        <label className="field"><span>Importe del pago {index+1}</span><input name={`amount-${index}`} type="number" min={1} max={sale.balanceCents} required value={part.amount} onChange={(e)=>patch(index,"amount",e.target.value)}/></label>
        {part.method==="CASH"?<label className="field"><span>Efectivo recibido {index+1}</span><input aria-label={`Efectivo recibido ${index+1}`} name={`received-${index}`} type="number" min={Number(part.amount)||1} max={1000000000} required value={part.received} onChange={(e)=>patch(index,"received",e.target.value)}/><small>Vuelto: {money.format(Math.max(0,Number(part.received||0)-Number(part.amount||0)))}</small></label>:<label className="field"><span>Referencia o folio {index+1}</span><input aria-label={`Referencia o folio ${index+1}`} name={`reference-${index}`} maxLength={200} required value={part.reference} onChange={(e)=>patch(index,"reference",e.target.value)}/><small>Registra únicamente pagos ya verificados en el terminal o banco.</small></label>}
        {parts.length>1&&<button className="text-button" type="button" onClick={()=>setParts((rows)=>rows.filter((_,i)=>i!==index))}>Quitar medio {index+1}</button>}
      </fieldset>)}
      {parts.length<4&&<button className="app-button app-button--soft" type="button" onClick={()=>setParts((rows)=>[...rows,{method:PAYMENT_METHODS.find(([m])=>!rows.some((p)=>p.method===m))?.[0]??"CASH",amount:String(Math.max(0,sale.balanceCents-paid)),received:"",reference:""}])}>Dividir pago / agregar medio</button>}
      <p>Total a registrar: <strong>{money.format(paid)}</strong> · Saldo posterior: {money.format(Math.max(0,sale.balanceCents-paid))}. Un abono conserva el saldo pendiente.</p>
      <label className="field"><span>Correo del comprobante (opcional)</span><input type="email" name="email" defaultValue={customer?.email??""}/></label>
      <button className="app-button app-button--primary" disabled={pending||!validSession||paid<=0||paid>sale.balanceCents||new Set(parts.map((p)=>p.method)).size!==parts.length}>Confirmar cobro</button>
      <p>Mercado Pago presencial requiere configurar la cuenta y el punto de cobro.</p>
    </form>}
    {receipt&&<div className="receipt-result"><span className="status-chip">Comprobante N.º {receipt.receiptNumber}</span><small>Comprobante comercial interno · {receipt.emailStatus==="SENT"?`Enviado a ${receipt.emailedTo}`:receipt.emailStatus==="DISABLED"?"Correo deshabilitado":"Consulta el estado del correo"}.</small><a className="app-button app-button--soft" href={`/api/sales/${sale.id}/receipt/print?receiptId=${receipt.id}`} target="_blank" rel="noreferrer">Abrir comprobante</a></div>}
    {sale?.status==="PAID"&&<div className="completed-actions"><p className="inline-success">Venta pagada. Existencias descontadas de {sale.branch?.name}.</p><button className="app-button app-button--soft" disabled={pending} type="button" onClick={()=>issueCurrentReceipt()}>Emitir comprobante final</button><button className="app-button app-button--primary" type="button" onClick={reset}>Finalizar y crear otra venta</button></div>}
  </>;
}
