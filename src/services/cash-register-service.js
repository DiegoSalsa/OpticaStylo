import { prisma } from "../db/prisma.js";
import { requireGlobalBranchAccess } from "../auth/branch-access.js";
import { requirePermissions } from "../auth/require-permission.js";
import { inventoryBranchAccess, assertBranch } from "../repositories/inventory-repository.js";
import {
  cashError, cashReadSnapshot, cashSessionAccess, closeCashRegister as closeRepository,
  createCashRegisterMovement, findCashSession, findOpenCashRegisterSession, getCashMovementPage,
  getCashPaymentPage, openCashRegister as openRepository, readCashPage,
} from "../repositories/cash-register-repository.js";
import { cashInteger } from "../repositories/cash-register-summary.js";
import {
  validateCashPage, validateCashRegisterClosingInput, validateCashRegisterId as id,
  validateCashRegisterMovementInput, validateCashRegisterOpeningInput,
} from "../validations/cash-register-validation.js";

const withLedgers = (query) => query?.get("view") !== "summary";

export async function getCashTerminals(branchId, actor) {
  requirePermissions(actor,["cash.read"]); const branch=id(branchId); await inventoryBranchAccess(actor,branch);
  const rows=await prisma.cash_register_terminals.findMany({where:{branch_id:branch,is_active:true},include:{cash_register_sessions:{where:{status:"OPEN"},select:{opened_by:true,users_cash_register_sessions_opened_byTousers:{select:{first_name:true,last_name:true}}}}},orderBy:{name:"asc"}});
  return rows.map((row)=>({id:row.id,name:row.name,branchId:row.branch_id,occupied:row.cash_register_sessions.length>0,own:row.cash_register_sessions[0]?.opened_by===actor.userId,responsible:row.cash_register_sessions[0] ? `${row.cash_register_sessions[0].users_cash_register_sessions_opened_byTousers.first_name} ${row.cash_register_sessions[0].users_cash_register_sessions_opened_byTousers.last_name}` : null}));
}
export async function createCashTerminal(input,actor) {
  requirePermissions(actor,["cash.manage_all"]); const branchId=id(input?.branchId); await inventoryBranchAccess(actor, branchId); await assertBranch(prisma,branchId);
  const name=typeof input.name==="string"?input.name.trim():"";
  if(!name || name.length>100) cashError("INVALID_CASH_TERMINAL","Indique un nombre de caja de hasta 100 caracteres.",400);
  try{return await prisma.cash_register_terminals.create({data:{branch_id:branchId,name},select:{id:true,name:true}});}
  catch(error){if(error.code==="P2002")cashError("CASH_TERMINAL_EXISTS","Ya existe un punto de cobro con ese nombre en la sucursal.");throw error;}
}
async function getCashHistory(query, actor) {
  const consolidated = query.get("consolidated") === "true";
  if (consolidated) {
    requirePermissions(actor, ["cash.manage_all"]);
    requireGlobalBranchAccess(actor);
  }
  const branchId = consolidated ? null : id(query.get("branchId"));
  const pagination = validateCashPage(query, 30);

  return prisma.$transaction(async (client) => {
    if (branchId) await inventoryBranchAccess(actor, branchId, client);
    const result = await readCashPage(client.cash_register_sessions, pagination, {
      where: {
        ...(branchId ? { branch_id: branchId } : {}),
        ...(!actor.permissions.includes("cash.manage_all") ? { opened_by: actor.userId } : {}),
      },
      select: {
        id: true, status: true, branch_id: true, opened_at: true, closed_at: true,
        opening_amount_cents: true, expected_amount_cents: true, closing_counted_cents: true, difference_cents: true,
        branches: { select: { name: true } }, cash_register_terminals: { select: { name: true } },
        users_cash_register_sessions_opened_byTousers: { select: { first_name: true, last_name: true } },
      },
      orderBy: [{ opened_at: "desc" }, { id: "desc" }],
    });
    return {
      ...result,
      items: result.items.map((row) => {
        const user = row.users_cash_register_sessions_opened_byTousers;
        return {
          id: row.id, status: row.status, branchId: row.branch_id, openedAt: row.opened_at, closedAt: row.closed_at,
          branch: row.branches?.name ?? "Histórica sin atribuir", terminal: row.cash_register_terminals?.name ?? "Sin caja asignada",
          responsible: user.first_name + " " + user.last_name,
          openingAmountCents: cashInteger(row.opening_amount_cents),
          expectedAmountCents: row.expected_amount_cents == null ? null : cashInteger(row.expected_amount_cents),
          countedCents: row.closing_counted_cents == null ? null : cashInteger(row.closing_counted_cents),
          differenceCents: row.difference_cents == null ? null : cashInteger(row.difference_cents),
        };
      }),
    };
  }, cashReadSnapshot);
}

export async function getOpenCashRegister(query, actor) {
  requirePermissions(actor, ["cash.read"]);
  if (query.get("history") === "true") return getCashHistory(query, actor);

  const terminalId=query.get("terminalId"); if(!terminalId) return null;
  const terminal=await prisma.cash_register_terminals.findUnique({where:{id:id(terminalId)}});
  if(!terminal) cashError("CASH_TERMINAL_NOT_FOUND","No se encontró el punto de cobro.",404);
  await inventoryBranchAccess(actor, terminal.branch_id);
  return findOpenCashRegisterSession(terminal.id, actor, withLedgers(query));
}

async function readCashSession(sessionId, actor, read) {
  requirePermissions(actor, ["cash.read"]);
  const key = id(sessionId);
  return prisma.$transaction(async (client) => {
    await cashSessionAccess(client, key, actor);
    return read(client, key);
  }, cashReadSnapshot);
}

export function getCashSession(sessionId, actor, query) {
  return readCashSession(sessionId, actor, (client, key) => findCashSession(key, client, withLedgers(query)));
}

export function getCashMovements(sessionId, actor, query) {
  return readCashSession(sessionId, actor, (client, key) => getCashMovementPage(client, key, validateCashPage(query)));
}

export function getCashPayments(sessionId, actor, query) {
  return readCashSession(sessionId, actor, (client, key) => getCashPaymentPage(client, key, validateCashPage(query)));
}

export async function openCashRegister(input, actor, query) {
  requirePermissions(actor, ["cash.operate"]);
  return openRepository(validateCashRegisterOpeningInput(input), actor, withLedgers(query));
}

export async function registerCashMovement(sessionId, input, actor, requestKey, query) {
  requirePermissions(actor, ["cash.operate"]);
  if (!requestKey) cashError("IDEMPOTENCY_KEY_REQUIRED", "El movimiento requiere identificador de operación.", 400);
  return createCashRegisterMovement(id(sessionId), validateCashRegisterMovementInput(input), actor, requestKey, withLedgers(query));
}

export async function closeCashRegister(sessionId, input, actor, query) {
  requirePermissions(actor, ["cash.operate"]);
  return closeRepository(id(sessionId), validateCashRegisterClosingInput(input), actor, withLedgers(query));
}
