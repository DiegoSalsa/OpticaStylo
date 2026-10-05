import { spawnSync } from "node:child_process";

import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();

const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "validate"],
  { env: process.env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
