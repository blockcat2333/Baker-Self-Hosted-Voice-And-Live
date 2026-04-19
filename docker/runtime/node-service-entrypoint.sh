#!/bin/sh
set -eu

. /opt/baker-runtime/lib.sh

preserve_env_override() {
  var="$1"
  eval "if [ \"\${$var+x}\" = x ]; then export BAKER_ENTRYPOINT_HAS_${var}=1; export BAKER_ENTRYPOINT_${var}=\"\${$var}\"; fi"
}

restore_env_override() {
  var="$1"
  eval "if [ \"\${BAKER_ENTRYPOINT_HAS_${var}:-}\" = 1 ]; then export ${var}=\"\${BAKER_ENTRYPOINT_${var}}\"; fi"
}

preserve_env_override STUN_URLS
preserve_env_override TURN_URLS
preserve_env_override TURN_USERNAME
preserve_env_override TURN_PASSWORD
preserve_env_override TURN_REALM
preserve_env_override TURN_PORT
preserve_env_override TURN_MIN_PORT
preserve_env_override TURN_MAX_PORT
preserve_env_override TURN_EXTERNAL_IP

load_runtime_env

restore_env_override STUN_URLS
restore_env_override TURN_URLS
restore_env_override TURN_USERNAME
restore_env_override TURN_PASSWORD
restore_env_override TURN_REALM
restore_env_override TURN_PORT
restore_env_override TURN_MIN_PORT
restore_env_override TURN_MAX_PORT
restore_env_override TURN_EXTERNAL_IP

: "${NODE_ENV:=production}"
: "${WEB_PORT:=3000}"
: "${API_HOST:=0.0.0.0}"
: "${API_PORT:=3001}"
: "${GATEWAY_HOST:=0.0.0.0}"
: "${GATEWAY_PORT:=3002}"
: "${MEDIA_HOST:=0.0.0.0}"
: "${MEDIA_PORT:=3003}"
: "${MEDIA_INTERNAL_URL:=http://media:3003}"
: "${DATABASE_URL:=postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB}"
: "${REDIS_URL:=redis://redis:6379}"
: "${DESKTOP_DEV_SERVER_URL:=http://localhost:5174}"
: "${STUN_URLS:=stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302}"
: "${TURN_URLS:=}"
: "${TURN_USERNAME:=}"
: "${TURN_PASSWORD:=}"

export NODE_ENV
export WEB_PORT
export API_HOST
export API_PORT
export GATEWAY_HOST
export GATEWAY_PORT
export MEDIA_HOST
export MEDIA_PORT
export MEDIA_INTERNAL_URL
export DATABASE_URL
export REDIS_URL
export DESKTOP_DEV_SERVER_URL
export STUN_URLS
export TURN_URLS
export TURN_USERNAME
export TURN_PASSWORD
export POSTGRES_DB
export POSTGRES_USER
export POSTGRES_PASSWORD
export JWT_ACCESS_SECRET
export JWT_REFRESH_SECRET
export MEDIA_INTERNAL_SECRET
export ADMIN_PANEL_PASSWORD
export VITE_ALLOWED_HOSTS
export ALLOWED_HOSTS
export TURN_REALM
export TURN_PORT
export TURN_MIN_PORT
export TURN_MAX_PORT
export TURN_EXTERNAL_IP

exec "$@"
