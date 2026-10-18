import assert from "node:assert/strict";
import test from "node:test";
import { retryTransaction } from "../../src/db/retry-transaction.js";

test("reintenta un conflicto serializable sin repetir operaciones externas", async () => {
  let attempts = 0;
  const options = { isolationLevel: "Serializable" };
  const client = { $transaction: async (operation, received) => {
    assert.equal(received, options);
    if (++attempts < 3) throw Object.assign(new Error("conflict"), { code: "P2034" });
    return operation();
  } };
  assert.equal(await retryTransaction(client, async () => "committed", options), "committed");
  assert.equal(attempts, 3);
});
test("acota los reintentos y conserva errores de validación o persistencia", async () => {
  let attempts = 0;
  const conflict = Object.assign(new Error("conflict"), { code: "P2034" });
  await assert.rejects(retryTransaction({ $transaction: async () => { attempts++; throw conflict; } }, () => {}), (e) => e === conflict);
  assert.equal(attempts, 4);
  const validation = new Error("validation");
  await assert.rejects(retryTransaction({ $transaction: async () => { throw validation; } }, () => {}), (e) => e === validation);
});

test("reintenta SQLSTATE 40001 encapsulado por Prisma y conserva otros errores SQL", async () => {
  let attempts=0;
  const serialization=Object.assign(new Error("could not serialize access"),{code:"P2010",meta:{code:"40001"}});
  const client={$transaction:async(operation)=>{if(++attempts===1)throw serialization;return operation();}};
  assert.equal(await retryTransaction(client,async()=>"committed"),"committed");
  assert.equal(attempts,2);
  const syntax=Object.assign(new Error("syntax error"),{code:"P2010",meta:{code:"42601"}});
  let syntaxAttempts=0;
  await assert.rejects(retryTransaction({$transaction:async()=>{syntaxAttempts++;throw syntax;}},async()=>{}),(error)=>error===syntax);
  assert.equal(syntaxAttempts,1);
});
