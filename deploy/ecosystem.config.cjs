const path = require("node:path");

// Mantener un único proceso Next.js local enlazado al puerto supervisado por PM2
const port = "3000";
const host = "127.0.0.1";
const projectRoot = path.resolve(__dirname, "..");

module.exports = {
  apps: [
    {
      // Ejecutar la versión publicada desde el enlace current y reiniciarla ante fallos
      name: "optica-stylo",
      script: "node_modules/next/dist/bin/next",
      args: `start --hostname ${host} --port ${port}`,
      cwd: projectRoot,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "768M",
      kill_timeout: 30000,
      listen_timeout: 15000,
      env: {
        NODE_ENV: "production",
        HOSTNAME: host,
        PORT: port,
      },
    },
  ],
};
