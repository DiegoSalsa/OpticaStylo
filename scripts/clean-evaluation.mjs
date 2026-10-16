import { readdir, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Recuperación después de cerrar por la fuerza una terminal o interrumpir npm en Windows.
// Nunca detiene procesos ni elimina una instancia PostgreSQL que siga escuchando.
for (const port of [3117, 55439, 9324]) {
  await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", () => reject(new Error(`El puerto ${port} sigue activo. Cierra primero la sesión de evaluación.`)));
    listener.listen(port, "127.0.0.1", () => listener.close(resolve));
  });
}
const output = fileURLToPath(new URL("../tmp/evaluation/", import.meta.url));
const entries = await readdir(output, { withFileTypes: true }).catch((error) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
for (const entry of entries.filter((item) => item.isDirectory() && /^run-[0-9a-f]{16}$/.test(item.name))) {
  const target = path.resolve(output, entry.name);
  if (path.dirname(target) !== path.resolve(output)) throw new Error("Directorio de limpieza no autorizado.");
  await rm(target, { recursive: true, force: true });
}
await rm(path.join(output, "runtime.json"), { force: true });
console.log("Limpieza de evaluación verificada; evidencias y reportes conservados.");
