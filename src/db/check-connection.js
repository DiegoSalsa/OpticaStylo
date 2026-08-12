import { executeQuery } from "./query.js";

export async function checkDatabaseConnection() {
  const result = await executeQuery(`
    SELECT
      current_database() AS database_name,
      current_user AS database_user,
      current_setting('server_version') AS server_version
  `);

  return result.rows[0];
}
