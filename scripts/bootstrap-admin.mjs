import { createInterface } from "node:readline/promises";

import { loadProjectEnvironment } from "./load-environment.mjs";

function readHiddenInput(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Este comando requiere una terminal interactiva.");
  }

  return new Promise((resolve, reject) => {
    let value = "";

    function cleanup() {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", handleInput);
    }

    function handleInput(chunk) {
      const input = chunk.toString("utf8");

      if (input === "\u0003") {
        cleanup();
        process.stdout.write("\n");
        reject(new Error("Operación cancelada."));
        return;
      }

      if (input === "\r" || input === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
        return;
      }

      if (input === "\u007f" || input === "\b") {
        value = value.slice(0, -1);
        return;
      }

      value += input;
    }

    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", handleInput);
  });
}

loadProjectEnvironment();

const { bootstrapInitialAdmin } = await import(
  "../src/services/bootstrap-admin-service.js"
);
const { closeDatabasePool } = await import("../src/db/pool.js");
const terminal = createInterface({ input: process.stdin, output: process.stdout });

try {
  const email = await terminal.question("Correo del administrador: ");
  const firstName = await terminal.question("Nombre: ");
  const lastName = await terminal.question("Apellido: ");
  terminal.close();

  const password = await readHiddenInput("Contraseña: ");
  const passwordConfirmation = await readHiddenInput("Confirmar contraseña: ");

  if (password !== passwordConfirmation) {
    throw new Error("Las contraseñas no coinciden.");
  }

  const user = await bootstrapInitialAdmin({
    email,
    firstName,
    lastName,
    password,
  });

  console.log(`Administrador creado: ${user.email}`);
} finally {
  terminal.close();
  await closeDatabasePool();
}
