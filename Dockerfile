# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN npm run build

# Esta imagen sólo contiene lo necesario para ejecutar migraciones. Mantenerla
# separada evita que el contenedor web ejecute cambios de esquema al reiniciar.
FROM base AS migration

ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY scripts ./scripts
COPY src/db ./src/db
USER node
CMD ["node", "scripts/db-migrate.mjs"]

FROM base AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# El modo standalone no incorpora automáticamente estos recursos estáticos.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
