import { AppError } from "../utils/app-error.js";
import { normalizeChileanRut } from "../utils/chilean-rut.js";
export function customerIdentityConflict() {
  throw new AppError({
    code: "CUSTOMER_IDENTITY_CONFLICT",
    message: "Existe un conflicto de identidad comercial. Revise los registros antes de continuar.",
    status: 409
  });
}
export async function findCustomerByNormalizedRut(client, rut, {
  lock = false
} = {}) {
  if (!rut) return null;
  const canonical = normalizeChileanRut(rut);
  if (!canonical) customerIdentityConflict();
  if (lock) await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"customer-rut:" + canonical},0))::text`;
  const rows = await client.$queryRaw`SELECT id FROM customers WHERE ltrim(upper(regexp_replace(rut,'[^0-9kK]','','g')),'0')=ltrim(upper(regexp_replace(${canonical},'[^0-9kK]','','g')),'0') LIMIT 2`;
  if (rows.length > 1) customerIdentityConflict();
  return rows[0] ? client.customers.findUnique({
    where: {
      id: rows[0].id
    }
  }) : null;
}
