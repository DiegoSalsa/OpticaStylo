#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGzip } from "node:zlib";

const platform = "linux/amd64";
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const tagPattern = /^[a-z0-9][a-z0-9._/:-]*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const tar = process.platform === "win32" ? "tar.exe" : "tar";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const run = promisify(execFile);

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function shortTag(tag) {
  return tag.replace(/^docker\.io\/(?:library\/)?/, "");
}

function blobPath(digest) {
  requireThat(digestPattern.test(digest), "El tar contiene un descriptor sin digest SHA-256 válido.");
  return "blobs/sha256/" + digest.slice("sha256:".length);
}

async function tarJSON(archive, entry, descriptor) {
  const { stdout } = await run(tar, ["-xOf", archive, entry], {
    encoding: "buffer",
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (descriptor) {
    const digest = "sha256:" + createHash("sha256").update(stdout).digest("hex");
    requireThat(
      digest === descriptor.digest && stdout.length === descriptor.size,
      "El contenido de " + entry + " no corresponde a su descriptor.",
    );
  }
  return JSON.parse(stdout);
}

async function selectManifest(archive, descriptor) {
  if (descriptor.platform) {
    requireThat(
      descriptor.platform.os + "/" + descriptor.platform.architecture === platform,
      "El tar contiene una variante distinta de " + platform + ".",
    );
  }
  const blob = await tarJSON(archive, blobPath(descriptor.digest), descriptor);
  if (Array.isArray(blob.manifests)) {
    const images = blob.manifests.filter((item) =>
      item.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest");
    requireThat(images.length === 1, "Exporta una sola variante ejecutable por etiqueta mediante --platform " + platform + ".");
    return selectManifest(archive, images[0]);
  }
  requireThat(blob.schemaVersion === 2 && blob.config && Array.isArray(blob.layers), "Falta el manifiesto ejecutable de la imagen.");
  return { digest: descriptor.digest, blob };
}

async function describe(archive, role, tag, legacy, index) {
  const matches = legacy.filter((entry) =>
    Array.isArray(entry.RepoTags) && entry.RepoTags.length === 1 && shortTag(entry.RepoTags[0]) === tag);
  requireThat(matches.length === 1, "manifest.json debe contener una sola entrada para " + tag + ".");
  const [entry] = matches;

  const targets = index.manifests.filter((item) => {
    const name = item.annotations?.["io.containerd.image.name"]
      ?? item.annotations?.["org.opencontainers.image.ref.name"];
    return typeof name === "string" && shortTag(name) === tag;
  });
  requireThat(targets.length === 1, "index.json debe identificar un solo destino OCI para " + tag + ".");
  const [target] = targets;
  const { digest: manifestDigest, blob } = await selectManifest(archive, target);
  const configPath = blobPath(blob.config.digest);
  const config = await tarJSON(archive, configPath, blob.config);

  requireThat(entry.Config === configPath, "Los manifiestos Docker y OCI discrepan sobre la configuración de " + tag + ".");
  requireThat(
    config.os + "/" + config.architecture === platform,
    "La configuración de " + tag + " no es " + platform + ".",
  );
  requireThat(
    Array.isArray(entry.Layers) && blob.layers.length === entry.Layers.length
      && blob.layers.every((layer, index) => blobPath(layer.digest) === entry.Layers[index]),
    "Los manifiestos Docker y OCI discrepan sobre las capas de " + tag + ".",
  );

  return [role, tag, platform, blob.config.digest, manifestDigest, target.digest].join(" ");
}

async function archiveHash(archive) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  return hash.digest("hex");
}

async function metadata(archive, web, db) {
  const [legacy, index] = await Promise.all([
    tarJSON(archive, "manifest.json"),
    tarJSON(archive, "index.json"),
  ]);
  requireThat(
    Array.isArray(legacy) && legacy.length === 2 && index.schemaVersion === 2
      && Array.isArray(index.manifests) && index.manifests.length === 2,
    "El tar debe contener únicamente las dos imágenes etiquetadas para la entrega.",
  );
  const [sha256, webRow, dbRow] = await Promise.all([
    archiveHash(archive),
    describe(archive, "web", web, legacy, index),
    describe(archive, "db", db, legacy, index),
  ]);
  return ["stylo-image-archive-v1 " + sha256, webRow, dbRow, ""].join("\n");
}

async function exportArchive(archive, web, db) {
  const file = await open(archive, "wx");
  try {
    const child = spawn(docker, ["image", "save", "--platform", platform, web, db], {
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    });
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error("docker image save terminó con código " + code + "."));
      });
    });
    await Promise.all([exited, pipeline(child.stdout, createGzip({ level: 3 }), file.createWriteStream())]);
  } finally {
    await file.close();
  }
}

async function main() {
  const [mode, file, web, db, manifest, ...extra] = process.argv.slice(2);
  requireThat(
    ["registrar", "exportar"].includes(mode) && file && web && db && manifest && extra.length === 0,
    "Uso: node registrar-imagenes.mjs (registrar|exportar) ARCHIVO.tar.gz ETIQUETA_WEB ETIQUETA_DB IMAGENES-AMD64.txt",
  );
  requireThat(
    tagPattern.test(web) && tagPattern.test(db) && shortTag(web) !== shortTag(db),
    "Indica dos referencias Docker distintas, con etiquetas explícitas.",
  );
  const archive = resolve(file);
  if (mode === "exportar") await exportArchive(archive, web, db);
  const content = await metadata(archive, shortTag(web), shortTag(db));
  await writeFile(manifest, content, { flag: "wx" });
  process.stdout.write(content);
}

main().catch((error) => {
  console.error("ERROR [archivo de imágenes] " + error.message);
  process.exitCode = 1;
});
