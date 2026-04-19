FROM node:20-alpine AS workspace-base

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile

FROM workspace-base AS services-builder

RUN pnpm turbo run build --filter=@baker/api --filter=@baker/gateway --filter=@baker/media

FROM node:20-alpine AS services-runtime

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV NODE_ENV=production

WORKDIR /app

RUN corepack enable

COPY --from=services-builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/turbo.json /app/tsconfig.base.json ./
COPY --from=services-builder /app/node_modules ./node_modules
COPY --from=services-builder /app/apps ./apps
COPY --from=services-builder /app/packages ./packages
COPY docker/runtime/lib.sh /opt/baker-runtime/lib.sh
COPY docker/runtime/node-service-entrypoint.sh /opt/baker-runtime/node-service-entrypoint.sh
RUN chmod +x /opt/baker-runtime/lib.sh /opt/baker-runtime/node-service-entrypoint.sh
RUN node -e 'const fs = require("node:fs"); for (const name of ["shared", "protocol", "db"]) { const path = "/app/packages/" + name + "/package.json"; const pkg = JSON.parse(fs.readFileSync(path, "utf8")); pkg.main = "./dist/index.js"; pkg.types = "./dist/index.d.ts"; fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n"); }'

FROM alpine:3.20 AS bootstrap-runtime

COPY docker/runtime/lib.sh /opt/baker-runtime/lib.sh
COPY docker/runtime/bootstrap.sh /opt/baker-runtime/bootstrap.sh
RUN chmod +x /opt/baker-runtime/lib.sh /opt/baker-runtime/bootstrap.sh

FROM postgres:16-alpine AS postgres-runtime

COPY docker/runtime/lib.sh /opt/baker-runtime/lib.sh
COPY docker/runtime/postgres-entrypoint.sh /opt/baker-runtime/postgres-entrypoint.sh
COPY docker/runtime/postgres-healthcheck.sh /opt/baker-runtime/postgres-healthcheck.sh
RUN chmod +x /opt/baker-runtime/lib.sh /opt/baker-runtime/postgres-entrypoint.sh /opt/baker-runtime/postgres-healthcheck.sh

FROM workspace-base AS proxy-builder

RUN pnpm turbo run build --filter=@baker/web --filter=@baker/admin

FROM caddy:2.10-alpine AS proxy-runtime

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=proxy-builder /app/apps/web/dist /srv/web
COPY --from=proxy-builder /app/apps/admin/dist /srv/admin
