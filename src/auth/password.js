import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const ALGORITHM = "scrypt";
const COST = 131_072;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const DERIVED_KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEMORY = 256 * 1024 * 1024;
const HASH_PARTS = 6;

function validatePassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("La contraseña debe ser una cadena no vacía.");
  }

  if (Buffer.byteLength(password, "utf8") > 1_024) {
    throw new RangeError("La contraseña excede el tamaño máximo permitido.");
  }
}

async function deriveKey(password, salt, parameters) {
  return scrypt(password, salt, DERIVED_KEY_LENGTH, {
    N: parameters.cost,
    maxmem: MAX_MEMORY,
    p: parameters.parallelization,
    r: parameters.blockSize,
  });
}

export async function hashPassword(password) {
  validatePassword(password);

  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await deriveKey(password, salt, {
    blockSize: BLOCK_SIZE,
    cost: COST,
    parallelization: PARALLELIZATION,
  });

  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

function parseStoredHash(storedHash) {
  if (typeof storedHash !== "string") {
    return null;
  }

  const parts = storedHash.split("$");

  if (parts.length !== HASH_PARTS || parts[0] !== ALGORITHM) {
    return null;
  }

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64url");
  const expectedKey = Buffer.from(parts[5], "base64url");

  if (
    cost !== COST ||
    blockSize !== BLOCK_SIZE ||
    parallelization !== PARALLELIZATION ||
    salt.length !== SALT_LENGTH ||
    expectedKey.length !== DERIVED_KEY_LENGTH
  ) {
    return null;
  }

  return {
    expectedKey,
    parameters: { blockSize, cost, parallelization },
    salt,
  };
}

export async function verifyPassword(password, storedHash) {
  validatePassword(password);

  const parsedHash = parseStoredHash(storedHash);

  if (!parsedHash) {
    return false;
  }

  const actualKey = await deriveKey(
    password,
    parsedHash.salt,
    parsedHash.parameters,
  );

  return timingSafeEqual(actualKey, parsedHash.expectedKey);
}
