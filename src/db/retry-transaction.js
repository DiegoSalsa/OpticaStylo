// PostgreSQL puede abortar una transacción serializable ante escrituras concurrentes.
// Reintentar la transacción completa conserva el aislamiento y sus validaciones.
export async function retryTransaction(client, operation, options) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await client.$transaction(operation, options); }
    catch (error) {
      if (error?.code !== "P2034" || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}
