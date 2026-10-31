import { prisma } from "../db/prisma.js";
import { requirePermissions } from "../auth/require-permission.js";
import { inventoryBranchAccess, assertBranch } from "../repositories/inventory-repository.js";
import { cashError, cashSessionAccess, findCashSession, closeCashRegister as closeRepository, createCashRegisterMovement, findOpenCashRegisterSession, openCashRegister as openRepository } from "../repositories/cash-register-repository.js";
import { validateCashRegisterClosingInput, validateCashRegisterId as id, validateCashRegisterMovementInput, validateCashRegisterOpeningInput } from "../validations/cash-register-validation.js";

export async function getCashTerminals(branchId, actor) {
  requirePermissions(actor,["cash.read"]); const branch=id(branchId); await inventoryBranchAccess(actor,branch);
  const rows=await prisma.cash_register_terminals.findMany({where:{branch_id:branch,is_active:true},include:{cash_register_sessions:{where:{status:"OPEN"},select:{opened_by:true,users_cash_register_sessions_opened_byTousers:{select:{first_name:true,last_name:true}}}}},orderBy:{name:"asc"}});
  return rows.map((row)=>({id:row.id,name:row.name,branchId:row.branch_id,occupied:row.cash_register_sessions.length>0,own:row.cash_register_sessions[0]?.opened_by===actor.userId,responsible:row.cash_register_sessions[0] ? `${row.cash_register_sessions[0].users_cash_register_sessions_opened_byTousers.first_name} ${row.cash_register_sessions[0].users_cash_register_sessions_opened_byTousers.last_name}` : null}));
}
export async function createCashTerminal(input,actor) {
  requirePermissions(actor,["cash.manage_all"]); const branchId=id(input?.branchId); await assertBranch(prisma,branchId);
  const name=typeof input.name==="string"?input.name.trim():"";
  if(!name || name.length>100) cashError("INVALID_CASH_TERMINAL","Indique un nombre de caja de hasta 100 caracteres.",400);
  try{return await prisma.cash_register_terminals.create({data:{branch_id:branchId,name},select:{id:true,name:true}});}
  catch(error){if(error.code==="P2002")cashError("CASH_TERMINAL_EXISTS","Ya existe un punto de cobro con ese nombre en la sucursal.");throw error;}
}
export async function getOpenCashRegister(query,actor) {
  requirePermissions(actor,["cash.read"]);
  if(query.get("history")==="true") {
    const consolidated=query.get("consolidated")==="true";
    if(consolidated) requirePermissions(actor,["cash.manage_all"]);
    const branchId=consolidated?null:id(query.get("branchId")); if(branchId) await inventoryBranchAccess(actor,branchId);
    const page=Number(query.get("page")??1); if(!Number.isSafeInteger(page)||page<1||page>100000) cashError("INVALID_CASH_PAGE","La página no es válida.",400);
    const where={...(branchId?{branch_id:branchId}:{}),...(!actor.permissions.includes("cash.manage_all")?{opened_by:actor.userId}:{})};
    const rows=await prisma.cash_register_sessions.findMany({where,select:{id:true,status:true,opened_at:true,closed_at:true,opening_amount_cents:true,expected_amount_cents:true,closing_counted_cents:true,difference_cents:true,branches:{select:{name:true}},cash_register_terminals:{select:{name:true}},users_cash_register_sessions_opened_byTousers:{select:{first_name:true,last_name:true}}},orderBy:[{opened_at:"desc"},{id:"desc"}],skip:(page-1)*30,take:30});
    return rows.map((r)=>({id:r.id,status:r.status,openedAt:r.opened_at,closedAt:r.closed_at,branch:r.branches?.name??"Histórica sin atribuir",terminal:r.cash_register_terminals?.name??"Sin caja asignada",responsible:`${r.users_cash_register_sessions_opened_byTousers.first_name} ${r.users_cash_register_sessions_opened_byTousers.last_name}`,openingAmountCents:Number(r.opening_amount_cents),expectedAmountCents:r.expected_amount_cents==null?null:Number(r.expected_amount_cents),countedCents:r.closing_counted_cents==null?null:Number(r.closing_counted_cents),differenceCents:r.difference_cents==null?null:Number(r.difference_cents)}));
  }
  const terminalId=query.get("terminalId"); if(!terminalId) return null;
  const terminal=await prisma.cash_register_terminals.findUnique({where:{id:id(terminalId)}});
  if(!terminal) cashError("CASH_TERMINAL_NOT_FOUND","No se encontró el punto de cobro.",404);
  await inventoryBranchAccess(actor,terminal.branch_id); return findOpenCashRegisterSession(terminal.id,actor);
}
export async function getCashSession(sessionId,actor) {
  requirePermissions(actor,["cash.read"]); const key=id(sessionId); await cashSessionAccess(prisma,key,actor); return findCashSession(key);
}
export async function openCashRegister(input,actor) { requirePermissions(actor,["cash.operate"]); return openRepository(validateCashRegisterOpeningInput(input),actor); }
export async function registerCashMovement(sessionId,input,actor,requestKey) {
  requirePermissions(actor,["cash.operate"]); if(!requestKey) cashError("IDEMPOTENCY_KEY_REQUIRED","El movimiento requiere identificador de operación.",400);
  return createCashRegisterMovement(id(sessionId),validateCashRegisterMovementInput(input),actor,requestKey);
}
export async function closeCashRegister(sessionId,input,actor) { requirePermissions(actor,["cash.operate"]); return closeRepository(id(sessionId),validateCashRegisterClosingInput(input),actor); }
