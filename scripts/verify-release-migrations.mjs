import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { requireEvaluationDatabase } from "../tests/evaluation-data.js";
import { auditDatabase, baselineName, differences, schemaSignature, sqlChecksums } from "./lib/schema-audit.mjs";

requireEvaluationDatabase(process.env.DATABASE_URL,process.env.STORE_E2E_SCHEMA);
const root=process.cwd(), repository=process.env.RC_REPOSITORY_ROOT || root;
const base=new URL(process.env.DATABASE_URL), clients=[];
const pgBin=process.env.RC_PG_BIN;
if(!pgBin) throw new Error("Falta RC_PG_BIN del clúster aislado.");
const source="25f0901^", sourceDirectory="src/db/migrations/";
function client(suffix){const u=new URL(base);u.searchParams.set("schema",`${process.env.STORE_E2E_SCHEMA}_${suffix}`);const c=new PrismaClient({datasourceUrl:u.href});clients.push(c);return {c,url:u};}
function sql(url,source){
  assert.match(url.searchParams.get("schema"),/^stylo_e2e_[a-f0-9]{16}_(legacy|fresh)$/);
  const conn=new URL(url);conn.search="";
  const r=spawnSync(path.join(pgBin,`psql${process.platform==="win32"?".exe":""}`),["-X","-q","-v","ON_ERROR_STOP=1",conn.href],{input:source,encoding:"utf8",windowsHide:true,env:{...process.env,PGOPTIONS:`-c search_path=${url.searchParams.get("schema")}`}});
  if(r.status!==0) throw new Error(`DDL sintético falló: ${r.stderr?.slice(0,1000)}`);
}
function cli(url,args,expected=0){const r=spawnSync(process.execPath,["node_modules/prisma/build/index.js",...args],{cwd:root,env:{...process.env,DATABASE_URL:url.href},windowsHide:true,encoding:"utf8"});assert.equal(r.status,expected,(r.stdout+r.stderr).slice(-3000));return r.stdout+r.stderr;}
const admin=new PrismaClient({datasourceUrl:base.href});clients.push(admin);
const legacy=client("legacy"),fresh=client("fresh"),managed=client("managed");
try {
  for(const s of [legacy,fresh,managed]) await admin.$executeRawUnsafe(`CREATE SCHEMA "${s.url.searchParams.get("schema")}"`);
  const names=execFileSync("git",["-C",repository,"ls-tree","-r","--name-only",source,sourceDirectory],{encoding:"utf8"}).trim().split(/\r?\n/).filter(n=>!n.includes("/reversions/") && /\/\d{3}_[a-z0-9_]+\.sql$/.test(n)).sort();
  assert.equal(names.length,32);
  const reference={format:1,sourceCommit:execFileSync("git",["-C",repository,"rev-parse",source],{encoding:"utf8"}).trim(),legacy:[],stages:[]};
  sql(legacy.url,"CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY CHECK(version>0),name TEXT NOT NULL,checksum CHAR(64) NOT NULL,executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);");
  for(const file of names){
    const body=execFileSync("git",["-C",repository,"show",`${source}:${file}`],{encoding:"utf8"});
    const [,version,name]=/\/(\d{3})_(.*)\.sql$/.exec(file);
    const checksums=sqlChecksums(body);reference.legacy.push({version:Number(version),name,checksums});
    sql(legacy.url,`BEGIN;\n${body}\nCOMMIT;`);
    await legacy.c.$executeRaw`INSERT INTO schema_migrations(version,name,checksum) VALUES(${Number(version)},${name},${checksums[0]})`;
  }
  reference.legacyShape=Object.fromEntries(Object.entries((await schemaSignature(legacy.c,true)).objects).filter(([k])=>k.split(":")[1]==="schema_migrations"));
  const files=(await readdir(path.join(root,"prisma/migrations"),{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>d.name).sort();
  let previous={};
  for(const name of files){
    const body=await readFile(path.join(root,"prisma/migrations",name,"migration.sql"),"utf8");
    sql(fresh.url,`BEGIN;\n${body}\nCOMMIT;`);
    const current=(await schemaSignature(fresh.c)).objects;
    reference.stages.push({name,checksums:sqlChecksums(body),changes:Object.fromEntries(differences(previous,current).map(d=>[d.object,current[d.object]??null]))});
    previous=current;
    if(name===baselineName) assert.deepEqual(differences(current,(await schemaSignature(legacy.c)).objects),[],"Los 32 SQL archivados y el baseline deben producir los mismos objetos físicos.");
  }
  const refPath=path.join(root,"config/migrations-reference.json");
  if(process.argv.includes("--write-reference")){
    const serialized=JSON.stringify(reference,null,2)+"\n";
    await writeFile(refPath,serialized);
    if(repository!==root) await writeFile(path.join(repository,"config/migrations-reference.json"),serialized);
  } else assert.deepEqual(JSON.parse(await readFile(refPath,"utf8")),reference,"La referencia de estructura cambió; requiere auditoría explícita.");
  assert.equal((await auditDatabase(legacy.c,reference)).status,"LEGACY_BASELINE_VERIFIED");
  // Prove that numbered rows alone cannot establish a baseline.
  sql(legacy.url,"ALTER TABLE sales DROP CONSTRAINT sales_total_consistency;");
  assert.equal((await auditDatabase(legacy.c,reference)).status,"BLOCKED");
  sql(legacy.url,"ALTER TABLE sales ADD CONSTRAINT sales_total_consistency CHECK(total_cents=subtotal_cents+shipping_fee_cents-discount_cents);");
  assert.equal((await auditDatabase(legacy.c,reference)).status,"LEGACY_BASELINE_VERIFIED");
  const blocked=cli(legacy.url,["migrate","deploy"],1);assert.match(blocked,/P3005/);
  // Only this ephemeral, structurally verified schema is baselined.
  cli(legacy.url,["migrate","resolve","--applied",baselineName]);
  await legacy.c.$executeRaw`INSERT INTO users(id,email,first_name,last_name,password_hash) VALUES('47000000-0000-4000-8000-000000000001','legacy-rc@example.invalid','Legado','Sintético','SIN_CREDENCIALES_REALES_XXXXXXXXXXXXXXXXXXXX')`;
  await legacy.c.$executeRaw`INSERT INTO customers(id,first_names,email) VALUES('47000000-0000-4000-8000-000000000002','Cliente legado sintético','legacy-customer@example.invalid')`;
  await legacy.c.$executeRaw`INSERT INTO sales(id,customer_id,status,origin,subtotal_cents,shipping_fee_cents,total_cents,shipping_quote_source) VALUES('47000000-0000-4000-8000-000000000003','47000000-0000-4000-8000-000000000002','QUOTATION','IN_STORE',1000,300,1300,'MOCK')`;
  const before=await legacy.c.$queryRaw`SELECT to_jsonb(s) AS sale FROM sales s WHERE id='47000000-0000-4000-8000-000000000003'::uuid`;
  cli(legacy.url,["migrate","deploy"]);
  cli(legacy.url,["migrate","deploy"]);
  const after=await legacy.c.$queryRaw`SELECT to_jsonb(s) AS sale FROM sales s WHERE id='47000000-0000-4000-8000-000000000003'::uuid`;
  for(const [k,v] of Object.entries(before[0].sale)) assert.deepEqual(after[0].sale[k],v,`Conservar venta histórica: ${k}`);
  assert.equal(after[0].sale.branch_id,null);assert.equal(after[0].sale.shipping_quote_id,null);
  assert.equal(await legacy.c.inventory_stocks.count(),0);assert.equal(await legacy.c.shipping_shipments.count(),0);
  assert.equal(await legacy.c.schema_migrations.count(),32);
  assert.equal((await auditDatabase(legacy.c,reference)).status,"PRISMA_MANAGED");
  assert.deepEqual(differences((await schemaSignature(legacy.c)).objects,(await schemaSignature(fresh.c)).objects),[]);
  // Fresh Migrate path, including its real migration ledger, not just SQL replay.
  const newSchema=process.env.STORE_E2E_SCHEMA;
  assert.match(newSchema,/^stylo_e2e_[a-f0-9]{16}$/);
  cli(managed.url,["migrate","deploy"]);cli(managed.url,["migrate","deploy"]);
  assert.equal(await managed.c.schema_migrations.count(),0,"No fabricar historial legado en una base nueva.");
  assert.equal((await auditDatabase(managed.c,reference)).status,"PRISMA_MANAGED");
  await managed.c.$executeRaw`ALTER TABLE schema_migrations RENAME TO rc_missing_ledger`;
  assert.ok((await auditDatabase(managed.c,reference)).errors.includes("LEGACY_LEDGER_MISSING"));
  await managed.c.$executeRaw`ALTER TABLE rc_missing_ledger RENAME TO schema_migrations`;
  const drift=cli(managed.url,["migrate","diff","--from-url",managed.url.href,"--to-schema-datamodel","prisma/schema.prisma","--script"]);
  assert.match(drift,/empty migration/i);
  console.log(JSON.stringify({legacySql:32,prismaMigrations:files.length,objects:Object.keys(previous).length,baselineEquivalent:true,negativeDriftRejected:true,historyPreserved:true,legacyRecordsPreserved:true,repeatable:true,prismaDiff:"empty"}));
} finally {for(const c of clients)await c.$disconnect();}
