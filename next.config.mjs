import path from "node:path";
import { fileURLToPath } from "node:url";
import { vtoBuildInfo } from "./config/vto-build-info.mjs";

// Resolver la raíz del proyecto y los orígenes permitidos para el servidor de desarrollo
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const vtoBuild = vtoBuildInfo(projectRoot);
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Aplicar cabeceras de seguridad globales, incluyendo restricciones de cámara y contenido embebido
const securityHeaders = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(), microphone=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

/** @type {import('next').NextConfig} */
// Exponer la configuración de Next.js, imágenes remotas y la raíz usada por Turbopack
const nextConfig = {
  env: {
    NEXT_PUBLIC_VTO_COMMIT: vtoBuild.commit,
    NEXT_PUBLIC_VTO_BRANCH: vtoBuild.branch,
    NEXT_PUBLIC_VTO_DIRTY: String(vtoBuild.dirty),
    NEXT_PUBLIC_VTO_BUILT_AT: vtoBuild.builtAt,
    NEXT_PUBLIC_VTO_DEPLOYMENT: vtoBuild.deployment ?? "",
  },
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  ...(process.env.DEPLOYMENT_VERSION?.trim()
    ? { deploymentId: process.env.DEPLOYMENT_VERSION.trim() }
    : {}),
  images: {
    remotePatterns: [
      { hostname: "res.cloudinary.com", pathname: "/**", protocol: "https" },
    ],
  },
  headers() {
    return [{ headers: securityHeaders, source: "/:path*" }];
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
