import { getDatabasePool } from "./pool.js";

export async function executeQuery(text, parameters = []) {
  return getDatabasePool().query(text, parameters);
}

export async function executeTransaction(operation) {
  const client = await getDatabasePool().connect();

  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
