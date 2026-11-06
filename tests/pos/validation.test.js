import assert from "node:assert/strict";
import {test} from "node:test";
import {validateCashRegisterOpeningInput,validateCashRegisterMovementInput,validateCashRegisterClosingInput} from "../../src/validations/cash-register-validation.js";
import {validateSalePaymentsInput} from "../../src/validations/sale-validation.js";
import {renderReceiptHtml} from "../../src/utils/receipt-template.js";
const id="40000000-0000-4000-8000-000000000001";
test("Caja valida sucursal, punto de cobro, límites, motivos y arqueo desde el servidor",()=>{
  assert.equal(validateCashRegisterOpeningInput({branchId:id,terminalId:id,openingAmountCents:0}).openingAmountCents,0);
  for(const amount of [-1,1.5,Infinity,1_000_000_001])assert.throws(()=>validateCashRegisterOpeningInput({branchId:id,terminalId:id,openingAmountCents:amount}));
  assert.throws(()=>validateCashRegisterOpeningInput({openingAmountCents:0}));
  assert.throws(()=>validateCashRegisterMovementInput({movementType:"WITHDRAWAL",amountCents:100,reason:""}));
  assert.equal(validateCashRegisterClosingInput({closingCountedCents:0}).closingCountedCents,0);
});
test("Efectivo calcula vuelto por el importe del abono y rechaza recibido insuficiente",()=>{
  const result=validateSalePaymentsInput({payments:[{paymentMethod:"CASH",amountCents:30000,cashReceivedCents:40000},{paymentMethod:"TRANSBANK",amountCents:50000,reference:"FOLIO-SINTETICO"}],cashSessionId:id});
  assert.equal(result.payments[0].changeCents,10000);assert.equal(result.payments[1].cashReceivedCents,null);
  assert.throws(()=>validateSalePaymentsInput({paymentMethod:"CASH",amountCents:1000,cashReceivedCents:999}));
});
test("Pago dividido exige medios diferentes, folio electrónico y no acredita Mercado Pago manualmente",()=>{
  assert.throws(()=>validateSalePaymentsInput({payments:[{paymentMethod:"BANK_TRANSFER",amountCents:1,reference:"A"},{paymentMethod:"BANK_TRANSFER",amountCents:1,reference:"B"}]}));
  assert.throws(()=>validateSalePaymentsInput({paymentMethod:"TRANSBANK",amountCents:1}));
  assert.throws(()=>validateSalePaymentsInput({paymentMethod:"MERCADO_PAGO",amountCents:1,reference:"Inventado"}));
});
test("Comprobante identifica sucursal, vendedor, medios y naturaleza comercial; escapa datos",()=>{
  const html=renderReceiptHtml({type:"FINAL",receiptNumber:1,issuedAt:new Date(),payload:{saleNumber:1,status:"PAID",items:[],payments:[{paymentMethod:"CASH",amountCents:100}],branch:{name:"Sucursal <prueba>"},seller:{name:"Vendedor sintético"},subtotalCents:100,totalCents:100,paidCents:100,balanceCents:0}});
  assert.match(html,/No constituye boleta tributaria/);assert.match(html,/Sucursal &lt;prueba&gt;/);assert.match(html,/Vendedor sintético/);assert.match(html,/Efectivo/);
});
