const port = "3000";
const host = "127.0.0.1";

module.exports = {
  apps: [
    {
      name: "optica-stylo",
      script: "node_modules/next/dist/bin/next",
      args: `start --hostname ${host} --port ${port}`,
      cwd: __dirname,
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
