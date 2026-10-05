import nextEnvironment from "@next/env";

const { loadEnvConfig } = nextEnvironment;

export function loadProjectEnvironment() {
  loadEnvConfig(process.cwd());
}
