import nextEnvironment from "@next/env";
// Script operativo para load-environment.

const { loadEnvConfig } = nextEnvironment;

// Consultar load project environment y devolver los datos en el formato esperado por la capa llamadora
export function loadProjectEnvironment() {
  loadEnvConfig(process.cwd());
}
