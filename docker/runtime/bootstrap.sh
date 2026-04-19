#!/bin/sh
set -eu

. /opt/baker-runtime/lib.sh

mkdir -p "$RUNTIME_DIR"
umask 077

created=0

if [ ! -f "$RUNTIME_ENV" ]; then
  created=1

  : "${NODE_ENV:=production}"
  : "${WEB_PORT:=3000}"
  : "${ADMIN_HTTP_PORT:=3001}"
  : "${POSTGRES_DB:=baker}"
  : "${POSTGRES_USER:=baker}"
  : "${POSTGRES_PASSWORD:=$(generate_secret 24)}"
  : "${JWT_ACCESS_SECRET:=$(generate_secret 32)}"
  : "${JWT_REFRESH_SECRET:=$(generate_secret 32)}"
  : "${MEDIA_INTERNAL_SECRET:=$(generate_secret 32)}"
  : "${ADMIN_PANEL_PASSWORD:=$(generate_secret 20)}"
  : "${DESKTOP_DEV_SERVER_URL:=http://localhost:5174}"
  : "${VITE_ALLOWED_HOSTS:=}"
  : "${ALLOWED_HOSTS:=}"
  : "${STUN_URLS:=stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302}"
  : "${TURN_URLS:=}"
  : "${TURN_USERNAME:=}"
  : "${TURN_PASSWORD:=}"
  : "${TURN_REALM:=baker}"
  : "${TURN_PORT:=3478}"
  : "${TURN_MIN_PORT:=49160}"
  : "${TURN_MAX_PORT:=49200}"
  : "${TURN_EXTERNAL_IP:=}"

  tmp_env="${RUNTIME_ENV}.tmp"
  {
    write_runtime_kv NODE_ENV "$NODE_ENV"
    write_runtime_kv WEB_PORT "$WEB_PORT"
    write_runtime_kv ADMIN_HTTP_PORT "$ADMIN_HTTP_PORT"
    write_runtime_kv POSTGRES_DB "$POSTGRES_DB"
    write_runtime_kv POSTGRES_USER "$POSTGRES_USER"
    write_runtime_kv POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
    write_runtime_kv JWT_ACCESS_SECRET "$JWT_ACCESS_SECRET"
    write_runtime_kv JWT_REFRESH_SECRET "$JWT_REFRESH_SECRET"
    write_runtime_kv MEDIA_INTERNAL_SECRET "$MEDIA_INTERNAL_SECRET"
    write_runtime_kv ADMIN_PANEL_PASSWORD "$ADMIN_PANEL_PASSWORD"
    write_runtime_kv DESKTOP_DEV_SERVER_URL "$DESKTOP_DEV_SERVER_URL"
    write_runtime_kv VITE_ALLOWED_HOSTS "$VITE_ALLOWED_HOSTS"
    write_runtime_kv ALLOWED_HOSTS "$ALLOWED_HOSTS"
    write_runtime_kv STUN_URLS "$STUN_URLS"
    write_runtime_kv TURN_URLS "$TURN_URLS"
    write_runtime_kv TURN_USERNAME "$TURN_USERNAME"
    write_runtime_kv TURN_PASSWORD "$TURN_PASSWORD"
    write_runtime_kv TURN_REALM "$TURN_REALM"
    write_runtime_kv TURN_PORT "$TURN_PORT"
    write_runtime_kv TURN_MIN_PORT "$TURN_MIN_PORT"
    write_runtime_kv TURN_MAX_PORT "$TURN_MAX_PORT"
    write_runtime_kv TURN_EXTERNAL_IP "$TURN_EXTERNAL_IP"
  } >"$tmp_env"
  mv "$tmp_env" "$RUNTIME_ENV"
fi

load_runtime_env

if [ "$created" -eq 1 ]; then
  status='Created'
else
  status='Reusing'
fi

echo "[$status] Baker runtime config ready at $RUNTIME_ENV"
echo "Web URL: $(format_local_url "$WEB_PORT")"
echo "Admin URL: $(format_local_url "$ADMIN_HTTP_PORT")"
echo "Admin password: $ADMIN_PANEL_PASSWORD"
echo "Tip: create .env from .env.selfhost.example before first boot if you want fixed ports, fixed secrets, or different image registries."
