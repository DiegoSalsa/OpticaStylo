import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const baselineName = "20260908000000_baseline";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const sqlChecksums = (sql) => { const lf = sql.replace(/\r\n/g, "\n"); return [...new Set([hash(lf), hash(lf.replace(/\n/g, "\r\n"))])]; };
function canonical(v) { return Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v; }

// Catalog only: no patient, customer, sales, session or credential values.
// Compare CHECKs, FKs, expression indexes, triggers, functions, views and RLS,
// including objects that Prisma's datamodel cannot describe.
export async function schemaSignature(client, includeLegacy = false) {
  const [{ schema }] = await client.$queryRaw`SELECT current_schema() AS schema`;
  const rows = await client.$queryRaw`
    SELECT 'table:'||c.relname AS key, jsonb_build_object('kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
      'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))::text AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations' AND (c.relname <> 'schema_migrations' OR ${includeLegacy})
    UNION ALL SELECT 'constraint:'||c.relname||':'||x.conname,pg_get_constraintdef(x.oid,false)||':'||x.condeferrable||':'||x.condeferred
    FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname <> '_prisma_migrations' AND (c.relname <> 'schema_migrations' OR ${includeLegacy})
    UNION ALL SELECT 'index:'||c.relname||':'||i.relname,pg_get_indexdef(i.oid)
    FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname <> '_prisma_migrations' AND (c.relname <> 'schema_migrations' OR ${includeLegacy})
    UNION ALL SELECT 'trigger:'||c.relname||':'||t.tgname,pg_get_triggerdef(t.oid,false)||':'||t.tgenabled::text
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND NOT t.tgisinternal
    UNION ALL SELECT 'function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=${schema} AND p.prokind='f' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')
    UNION ALL SELECT 'view:'||c.relname,pg_get_viewdef(c.oid,false) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relkind IN ('v','m')
    UNION ALL SELECT 'sequence:'||c.relname,jsonb_build_array(s.seqstart,s.seqincrement,s.seqmin,s.seqmax,s.seqcache,s.seqcycle)::text
    FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema}
    UNION ALL SELECT 'policy:'||c.relname||':'||p.polname,pg_get_expr(p.polqual,p.polrelid)||':'||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),'')||':'||p.polcmd::text
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema}
    ORDER BY key`;
  const objects = Object.fromEntries(rows.map(r=>[r.key,hash(r.definition.replaceAll(`"${schema}".`, 'public.').replaceAll(`${schema}.`, 'public.').replace(/\r\n/g,"\n").trim())]));
  return { objects, fingerprint: hash(JSON.stringify(canonical(objects))) };
}
export function differences(expected, actual) {
  return [...new Set([...Object.keys(expected),...Object.keys(actual)])].sort().filter(k=>expected[k]!==actual[k]).map(k=>({object:k,kind:!expected[k]?"unexpected":!actual[k]?"missing":"different"}));
}
export async function auditDatabase(client, reference) {
  const signature = await schemaSignature(client);
  const [{ legacy, modern }] = await client.$queryRaw`SELECT to_regclass('schema_migrations') IS NOT NULL AS legacy,to_regclass('_prisma_migrations') IS NOT NULL AS modern`;
  const historical = legacy ? await client.$queryRaw`SELECT version,name,checksum FROM schema_migrations ORDER BY version` : [];
  const applied = modern ? await client.$queryRaw`SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY started_at` : [];
  const errors = [];
  if (legacy) {
    const actual = Object.fromEntries(Object.entries((await schemaSignature(client,true)).objects).filter(([k])=>k.split(":")[1]==="schema_migrations"));
    if (differences(reference.legacyShape,actual).length) errors.push("LEGACY_LEDGER_SHAPE_MISMATCH");
  }
  if (historical.length && (historical.length!==reference.legacy.length || historical.some((m,i)=>m.version!==reference.legacy[i]?.version || m.name!==reference.legacy[i]?.name || !reference.legacy[i].checksums.includes(m.checksum.trim())))) errors.push("LEGACY_HISTORY_MISMATCH");
  const completed = applied.filter(m=>m.finished_at && !m.rolled_back_at);
  if (!legacy && completed.some(m=>m.migration_name === "20261106010000_legacy_migration_ledger")) errors.push("LEGACY_LEDGER_MISSING");
  if (applied.some(m=>!m.finished_at && !m.rolled_back_at)) errors.push("FAILED_MIGRATION");
  if (completed.some((m,i)=>m.migration_name!==reference.stages[i]?.name || !reference.stages[i].checksums.includes(m.checksum))) errors.push("PRISMA_HISTORY_MISMATCH");
  const state = completed.length ? reference.stages[completed.length-1] : reference.stages[0];
  const expected = {};
  for (const stage of reference.stages.slice(0,completed.length || 1)) for(const [k,v] of Object.entries(stage.changes)) { if(v===null) delete expected[k]; else expected[k]=v; }
  const drift = differences(expected,signature.objects);
  const empty = Object.keys(signature.objects).length===0 && !historical.length && !completed.length;
  if (!empty && drift.length) errors.push("STRUCTURAL_DRIFT");
  if (!empty && !completed.length && historical.length!==32) errors.push("UNVERIFIED_BASELINE");
  return { status: errors.length?"BLOCKED":empty?"EMPTY":completed.length?"PRISMA_MANAGED":"LEGACY_BASELINE_VERIFIED",
    fingerprint: signature.fingerprint, legacyCount: historical.length, applied: completed.map(m=>m.migration_name),
    expectedStage: state?.name, pending: reference.stages.slice(completed.length || (empty?0:1)).map(m=>m.name), errors, drift };
}
export async function loadReference() {
  const reference=JSON.parse(await readFile(new URL("../../config/migrations-reference.json",import.meta.url),"utf8"));
  for (const stage of reference.stages) {
    const source=await readFile(new URL(`../../prisma/migrations/${stage.name}/migration.sql`,import.meta.url),"utf8");
    if(!sqlChecksums(source).some(h=>stage.checksums.includes(h))) throw new Error(`SQL de migración alterado: ${stage.name}`);
  }
  return reference;
}
