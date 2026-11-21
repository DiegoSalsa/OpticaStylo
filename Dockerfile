FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/
# npm ci ejecuta postinstall, que genera Prisma Client para Linux.
RUN npm ci
COPY next.config.mjs jsconfig.json ./
COPY config ./config
COPY public ./public
COPY src ./src
COPY tests/fixtures ./tests/fixtures
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production
RUN mkdir -p /var/lib/stylo-private && chown node:node /var/lib/stylo-private
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY package.json next.config.mjs ./
COPY config ./config
COPY public ./public
COPY prisma ./prisma
COPY src/auth/password.js ./src/auth/password.js
COPY scripts/evaluation-support/rut-fixture.js ./scripts/evaluation-support/rut-fixture.js
COPY scripts/docker/init.mjs scripts/docker/entrypoint.sh ./scripts/docker/
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "scripts/docker/entrypoint.sh"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
