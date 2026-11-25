import { requireGlobalBranchAccess } from "../auth/branch-access.js";
import { customerIdentityScope, identityBranchIds, operationBranch } from "../auth/branch-identity.js";
import { hasGlobalBranchAccess } from "../auth/permissions.js";
import { prisma } from "../db/prisma.js";
import { requirePermissions } from "../auth/require-permission.js";
import { saleBranchScope } from "../auth/sale-branch-access.js";
import { getCustomer } from "./customer-service.js";
import { inventoryId } from "../validations/inventory-validation.js";
import { validateCustomerId } from "../validations/customer-validation.js";
import { commercialError, commercialQuery, commercialReportQuery, commercialText, preferencesInput, contactInput, CONTACT_STATEMENT } from "../validations/customer-commercial-validation.js";
import { customerCommercialHistory, customerCommercialSummary, commercialReport } from "../repositories/customer-commercial-repository.js";
import { retryTransaction } from "../db/retry-transaction.js";
const scopeWhere = (scope) => scope.allowedBranchIds ? { branch_id: { in: scope.allowedBranchIds } } : {};
export async function contactState(customerId, client = prisma) {
  const customer = await client.customers.findUnique({
    where: {
      id: customerId
    },
    select: {
      email: true,
      phone: true
    }
  });
  const events = (await Promise.all(["EMAIL", "PHONE"].map(channel => client.customer_contact_events.findFirst({
    where: {
      customer_id: customerId,
      channel
    },
    orderBy: [{
      created_at: "desc"
    }, {
      // Ante decisiones simultáneas prevalece la oposición, sin inferir autorización.
      decision: "desc"
    }, {
      id: "desc"
    }],
    select: {
      id: true,
      channel: true,
      decision: true,
      source: true,
      created_at: true,
      destination: true,
      statement_version: true,
      evidence: true
    }
  })))).filter(Boolean);
  return {
    statement: CONTACT_STATEMENT,
    channels: ["EMAIL", "PHONE"].map(channel => {
      const event = events.find(e => e.channel === channel),
        destination = channel === "EMAIL" ? customer?.email : customer?.phone;
      return {
        channel,
        state: !event ? "UNKNOWN" : event.decision === "GRANTED" && event.destination !== destination ? "CONTACT_CHANGED" : event.decision,
        contactAvailable: !!destination,
        recordedAt: event?.created_at ?? null,
        source: event?.source ?? null,
        evidence: event?.evidence ?? null
      };
    })
  };
}
export async function commercialProfile(id, actor) {
  const customer = await getCustomer(id, actor),
    scope = await saleBranchScope(actor);
  requirePermissions(actor, ["sales.read"]);
  const branchId = scope.allowedBranchIds?.length === 1 ? scope.allowedBranchIds[0] : null;
  const [summary, account, details, contact] = await Promise.all([customerCommercialSummary(customer.id, scope), prisma.customer_accounts.findUnique({
    where: {
      customer_id: customer.id
    },
    select: {
      is_active: true,
      email_verified_at: true,
      created_at: true
    }
  }), branchId ? prisma.customer_branches.findUnique({
    where: { customer_id_branch_id: { customer_id: customer.id, branch_id: branchId } }, select: { preferences: true },
  }) : !scope.allowedBranchIds ? prisma.customers.findUnique({
    where: { id: customer.id }, select: { commercial_preferences: true },
  }) : null, contactState(customer.id)]);
  return {
    customer,
    summary,
    account: account ? {
      exists: true,
      isActive: account.is_active,
      emailVerifiedAt: account.email_verified_at,
      createdAt: account.created_at
    } : {
      exists: false
    },
    preferences: (details?.preferences ?? details?.commercial_preferences) ?? {
      brands: [],
      models: [],
      notes: null
    },
    contact: hasGlobalBranchAccess(actor) ? contact : { ...contact, channels: contact.channels.map((channel) => ({
      ...channel, evidence: null,
    })) },
  };
}
export async function commercialHistory(id, params, actor) {
  await getCustomer(id, actor);
  requirePermissions(actor, ["sales.read"]);
  const query = commercialQuery(params);
  query.status = params.get("status") || null;
  query.origin = params.get("origin") || null;
  if (query.status && !["QUOTATION", "PENDING", "PAID", "IN_PREPARATION", "READY", "DELIVERED", "CANCELLED"].includes(query.status) || query.origin && !["IN_STORE", "ONLINE"].includes(query.origin)) commercialError("El filtro de operaciones no es válido.");
  return customerCommercialHistory(validateCustomerId(id), query, await saleBranchScope(actor));
}
export async function saveCommercialPreferences(id, input, actor) {
  requirePermissions(actor, ["customers.manage"]);
  const customerId = validateCustomerId(id),
    data = preferencesInput(input);
  const branchId = await operationBranch(actor, input.branchId, { allowUnassigned: true });
  await getCustomer(customerId, branchId ? { ...actor, activeBranchId: branchId } : actor);
  return retryTransaction(prisma, async c => {
    await c.$queryRaw`SELECT set_config('stylo.customer_actor',${actor.userId},true)`;
    await c.$queryRaw`SELECT id FROM customers WHERE id=${customerId}::uuid FOR UPDATE`;
    const row = await c.customers.findUnique({
      where: {
        id: customerId
      }
    });
    if (!row) commercialError("No se encontró el cliente.", "CUSTOMER_NOT_FOUND", 404);
    if (row.record_version !== data.expectedVersion) commercialError("El perfil cambió en otra sesión. Conserve su texto y recargue antes de guardar.", "CUSTOMER_VERSION_CONFLICT", 409);
    await c.customers.update({
      where: {
        id: customerId
      },
      data: {
        ...(branchId ? { record_version: { increment: 1 } } : { commercial_preferences: data.preferences }),
        updated_by: actor.userId
      }
    });
    if (branchId) await c.customer_branches.upsert({
      where: { customer_id_branch_id: { customer_id: customerId, branch_id: branchId } },
      create: { customer_id: customerId, branch_id: branchId, preferences: data.preferences },
      update: { preferences: data.preferences },
    });
    return { saved: true };
  });
}
export async function commercialNotes(id, params, actor) {
  await getCustomer(id, actor);
  requirePermissions(actor, ["sales.read"]);
  const q = commercialQuery(params),
    scope = await saleBranchScope(actor),
    where = {
      customer_id: validateCustomerId(id),
      ...scopeWhere(scope)
    };
  const [rows, total] = await prisma.$transaction([prisma.customer_commercial_notes.findMany({
    where,
    include: {
      users: {
        select: {
          first_name: true,
          last_name: true
        }
      },
      branches: {
        select: {
          name: true
        }
      }
    },
    orderBy: [{
      created_at: "desc"
    }, {
      id: "desc"
    }],
    take: q.pageSize,
    skip: (q.page - 1) * q.pageSize
  }), prisma.customer_commercial_notes.count({
    where
  })]);
  return {
    items: rows.map(r => ({
      id: r.id,
      content: r.content,
      createdAt: r.created_at,
      author: `${r.users.first_name} ${r.users.last_name}`,
      branch: r.branches?.name ?? null
    })),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.ceil(total / q.pageSize)
  };
}
export async function addCommercialNote(id, input, actor) {
  requirePermissions(actor, ["customers.manage"]);
  const branchId = await operationBranch(actor, input?.branchId, { allowUnassigned: true });
  await getCustomer(id, branchId ? { ...actor, activeBranchId: branchId } : actor);
  return prisma.customer_commercial_notes.create({
    data: {
      customer_id: validateCustomerId(id),
      branch_id: branchId,
      created_by: actor.userId,
      content: commercialText(input?.content)
    }
  }).then(r => ({
    id: r.id
  }));
}
export async function saveContactEvent(customerId, input, actor, {
  account = null
} = {}) {
  if (!account) requirePermissions(actor, ["customers.manage"]);
  const id = validateCustomerId(customerId),
    data = contactInput(input, {
      self: !!account
    });
  return retryTransaction(prisma, async c => {
    const bounds = account ? null : await identityBranchIds(actor, c);
    await c.$queryRaw`SELECT id FROM customers WHERE id=${id}::uuid FOR UPDATE`;
    const customer = await c.customers.findFirst({ where: { id, ...customerIdentityScope(bounds) } });
    if (!customer) commercialError("No se encontró el cliente.", "CUSTOMER_NOT_FOUND", 404);
    if (account) {
      const current = await c.customer_accounts.findUnique({
        where: {
          id: account.id
        }
      });
      if (current?.customer_id !== id) commercialError("No se encontró el perfil autorizado.", "CUSTOMER_NOT_FOUND", 404);
    }
    const destination = data.channel === "EMAIL" ? customer.email : customer.phone;
    if (data.decision === "GRANTED" && !destination) commercialError("Registre primero un contacto válido para ese canal.");
    if (data.decision === "GRANTED" && !account && !data.evidence) commercialError("Registre la referencia de la autorización expresa.");
    if (account && data.decision === "REVOKED") {
      const current = await contactState(id, c);
      if (current.channels.some((channel) => channel.channel === data.channel && channel.state === "REVOKED")) return current;
    }
    await c.customer_contact_events.create({
      data: {
        ...data,
        customer_id: id,
        destination,
        performed_by: actor?.userId ?? null,
        account_id: account?.id ?? null
      }
    });
    const result = await contactState(id, c);
    return account || hasGlobalBranchAccess(actor) ? result : { ...result, channels: result.channels.map((channel) => ({ ...channel, evidence: null })) };
  });
}
export async function customerReport(params, actor) {
  if (!actor.permissions.some(p => ["reports.read", "sales.reports_read"].includes(p))) requirePermissions(actor, ["reports.read"]);
  const branchId = params.get("branchId");
  return commercialReport(commercialReportQuery(params), await saleBranchScope(actor, branchId ? inventoryId(branchId) : null));
}
export async function customerConflicts(params, actor) {
  requirePermissions(actor, ["reports.read"]);
  requireGlobalBranchAccess(actor);
  const q = commercialQuery(params);
  const cte = "SELECT ltrim(upper(regexp_replace(rut,'[^0-9kK]','','g')),'0') AS identity,count(*)::int AS count,array_agg(id) AS ids FROM customers WHERE rut IS NOT NULL GROUP BY 1 HAVING count(*)>1";
  const [rows, total] = await prisma.$transaction([prisma.$queryRawUnsafe(`SELECT * FROM (${cte}) conflicts ORDER BY identity LIMIT $1 OFFSET $2`, q.pageSize, (q.page - 1) * q.pageSize), prisma.$queryRawUnsafe(`SELECT count(*)::int AS total FROM (${cte}) conflicts`)]);
  return {
    items: rows,
    page: q.page,
    pageSize: q.pageSize,
    total: total[0].total,
    totalPages: Math.ceil(total[0].total / q.pageSize)
  };
}
