FROM node:20-bookworm-slim AS workspace-base

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile

FROM workspace-base AS services-builder

RUN pnpm turbo run build --filter=@baker/api --filter=@baker/gateway --filter=@baker/media

FROM node:20-bookworm-slim AS services-runtime

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV NODE_ENV=production

WORKDIR /app

RUN corepack enable

COPY --from=services-builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/turbo.json /app/tsconfig.base.json ./
COPY --from=services-builder /app/node_modules ./node_modules
COPY --from=services-builder /app/apps ./apps
COPY --from=services-builder /app/packages ./packages
COPY docker/runtime/bootstrap.sh /opt/baker-runtime/bootstrap.sh
COPY docker/runtime/lib.sh /opt/baker-runtime/lib.sh
COPY docker/runtime/node-service-entrypoint.sh /opt/baker-runtime/node-service-entrypoint.sh
COPY docker/runtime/standalone-help.sh /opt/baker-runtime/standalone-help.sh
RUN chmod +x /opt/baker-runtime/bootstrap.sh /opt/baker-runtime/lib.sh /opt/baker-runtime/node-service-entrypoint.sh /opt/baker-runtime/standalone-help.sh
RUN node -e 'const fs = require("node:fs"); for (const name of ["shared", "protocol", "db"]) { const path = "/app/packages/" + name + "/package.json"; const pkg = JSON.parse(fs.readFileSync(path, "utf8")); pkg.main = "./dist/index.js"; pkg.types = "./dist/index.d.ts"; fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n"); }'
CMD ["sh", "/opt/baker-runtime/standalone-help.sh"]

FROM workspace-base AS proxy-builder

RUN pnpm turbo run build --filter=@baker/web --filter=@baker/admin

FROM caddy:2.10-alpine AS caddy-binary

FROM postgres:16-bookworm AS allinone-runtime

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:/usr/lib/postgresql/16/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV NODE_ENV=production
ENV BAKER_DATA_DIR=/var/lib/baker
ENV BAKER_RUNTIME_DIR=/var/lib/baker/runtime
ENV PGDATA=/var/lib/baker/postgres
ENV REDIS_DATA_DIR=/var/lib/baker/redis
ENV TURN_ENABLED=false

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  coturn \
  curl \
  netcat-openbsd \
  procps \
  redis-server \
  supervisor \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/baker /etc/caddy /var/lib/baker /var/run/postgresql

COPY --from=services-runtime /usr/local /usr/local
RUN corepack enable

COPY --from=services-runtime /app /app
COPY --from=proxy-builder /app/apps/web/dist /srv/web
COPY --from=proxy-builder /app/apps/admin/dist /srv/admin
COPY --from=caddy-binary /usr/bin/caddy /usr/bin/caddy

COPY docker/runtime/bootstrap.sh /opt/baker-runtime/bootstrap.sh
COPY docker/runtime/lib.sh /opt/baker-runtime/lib.sh
COPY docker/runtime/node-service-entrypoint.sh /opt/baker-runtime/node-service-entrypoint.sh
COPY docker/runtime/standalone-help.sh /opt/baker-runtime/standalone-help.sh
COPY docker/allinone/Caddyfile /etc/caddy/Caddyfile
COPY docker/allinone/supervisord.conf /etc/baker/supervisord.conf
COPY docker/allinone/entrypoint.sh /opt/baker-allinone/entrypoint.sh
COPY docker/allinone/healthcheck.sh /opt/baker-allinone/healthcheck.sh
COPY docker/allinone/lib.sh /opt/baker-allinone/lib.sh
COPY docker/allinone/node-service.sh /opt/baker-allinone/node-service.sh
COPY docker/allinone/postgres.sh /opt/baker-allinone/postgres.sh
COPY docker/allinone/redis.sh /opt/baker-allinone/redis.sh
COPY docker/allinone/turn.sh /opt/baker-allinone/turn.sh

RUN chmod +x \
  /opt/baker-runtime/bootstrap.sh \
  /opt/baker-runtime/lib.sh \
  /opt/baker-runtime/node-service-entrypoint.sh \
  /opt/baker-runtime/standalone-help.sh \
  /opt/baker-allinone/entrypoint.sh \
  /opt/baker-allinone/healthcheck.sh \
  /opt/baker-allinone/lib.sh \
  /opt/baker-allinone/node-service.sh \
  /opt/baker-allinone/postgres.sh \
  /opt/baker-allinone/redis.sh \
  /opt/baker-allinone/turn.sh

EXPOSE 80 8080 3478/tcp 3478/udp
VOLUME ["/var/lib/baker"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 CMD ["/opt/baker-allinone/healthcheck.sh"]

ENTRYPOINT ["/opt/baker-allinone/entrypoint.sh"]
