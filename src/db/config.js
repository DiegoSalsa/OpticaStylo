const DEFAULT_POOL_MAX = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

function parsePositiveInteger(value, variableName, defaultValue) {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${variableName} debe ser un número entero positivo.`);
  }

  return parsedValue;
}

function parseBoolean(value, variableName, defaultValue) {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${variableName} debe tener el valor true o false.`);
}

function validateConnectionString(connectionString) {
  if (!connectionString) {
    throw new Error("La variable DATABASE_URL es obligatoria.");
  }

  let databaseUrl;

  try {
    databaseUrl = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL no contiene una URL válida.");
  }

  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL debe utilizar el protocolo PostgreSQL.");
  }

  if (!databaseUrl.hostname || databaseUrl.pathname === "/") {
    throw new Error("DATABASE_URL debe indicar el servidor y la base de datos.");
  }
}

function requiresSecureConnection(connectionString, environment) {
  const hostname = new URL(connectionString).hostname.toLowerCase();
  return environment.NODE_ENV === "production" || hostname.endsWith(".neon.tech");
}

function normalizeSecureConnectionString(connectionString, useSsl) {
  if (!useSsl) return connectionString;
  const databaseUrl = new URL(connectionString);
  databaseUrl.searchParams.set("sslmode", "verify-full");
  return databaseUrl.toString();
}

export function getDatabaseConfig(environment = process.env) {
  const connectionString = environment.DATABASE_URL?.trim();
  validateConnectionString(connectionString);

  const useSsl = parseBoolean(environment.DATABASE_SSL, "DATABASE_SSL", false);
  if (requiresSecureConnection(connectionString, environment) && !useSsl) {
    throw new Error("DATABASE_SSL debe ser true en producción y al conectar con Neon.");
  }

  return {
    application_name: "optica-stylo",
    connectionString: normalizeSecureConnectionString(connectionString, useSsl),
    connectionTimeoutMillis: parsePositiveInteger(
      environment.DATABASE_CONNECTION_TIMEOUT_MS,
      "DATABASE_CONNECTION_TIMEOUT_MS",
      DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
    idleTimeoutMillis: parsePositiveInteger(
      environment.DATABASE_IDLE_TIMEOUT_MS,
      "DATABASE_IDLE_TIMEOUT_MS",
      DEFAULT_IDLE_TIMEOUT_MS,
    ),
    max: parsePositiveInteger(
      environment.DATABASE_POOL_MAX,
      "DATABASE_POOL_MAX",
      DEFAULT_POOL_MAX,
    ),
    ssl: useSsl ? { rejectUnauthorized: true } : false,
  };
}
