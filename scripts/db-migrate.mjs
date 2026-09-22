import { spawnSync } from "node:child_process";
// Script operativo para db-migrate.

import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();

const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { env: process.env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
