#!/bin/sh
set -eu

service="${1:-}"

. /opt/baker-runtime/lib.sh
. /opt/baker-allinone/lib.sh

: "${BAKER_DATA_DIR:=/var/lib/baker}"
: "${BAKER_RUNTIME_DIR:=$BAKER_DATA_DIR/runtime}"

export BAKER_DATA_DIR
export BAKER_RUNTIME_DIR

capture_turn_runtime_overrides
load_runtime_env
apply_turn_runtime_overrides
default_turn_urls_if_needed

export DATABASE_URL="${DATABASE_URL:-$(postgres_dsn)}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export MEDIA_INTERNAL_URL="${MEDIA_INTERNAL_URL:-http://127.0.0.1:3003}"

case "$service" in
  media)
    exec /opt/baker-runtime/node-service-entrypoint.sh node apps/media/dist/index.js
    ;;
  api)
    wait_for_tcp 127.0.0.1 5432 PostgreSQL
    wait_for_tcp 127.0.0.1 6379 Redis
    exec /opt/baker-runtime/node-service-entrypoint.sh node apps/api/dist/index.js
    ;;
  gateway)
    wait_for_tcp 127.0.0.1 5432 PostgreSQL
    wait_for_tcp 127.0.0.1 6379 Redis
    wait_for_http http://127.0.0.1:3003/health Media
    exec /opt/baker-runtime/node-service-entrypoint.sh node apps/gateway/dist/index.js
    ;;
  *)
    echo "Unknown Baker service: $service" >&2
    exit 1
    ;;
esac
