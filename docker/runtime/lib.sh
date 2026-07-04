#!/bin/sh

RUNTIME_DIR="${BAKER_RUNTIME_DIR:-/run/baker}"
RUNTIME_ENV="${RUNTIME_DIR}/runtime.env"

is_true() {
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

load_runtime_env() {
  if [ ! -f "$RUNTIME_ENV" ]; then
    echo "Missing runtime config at $RUNTIME_ENV. Start the bootstrap service first." >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$RUNTIME_ENV"
  set +a
}

clear_runtime_managed_media_env() {
  unset TURN_URLS
  unset TURN_EXTERNAL_IP
  unset SFU_ANNOUNCED_IP
}

default_turn_urls_if_needed() {
  if ! is_true "${TURN_ENABLED:-false}"; then
    return 0
  fi

  if [ -n "${TURN_URLS:-}" ] || [ -z "${TURN_EXTERNAL_IP:-}" ]; then
    return 0
  fi

  TURN_URLS="turn:${TURN_EXTERNAL_IP}:${TURN_PORT:-3478}?transport=udp,turn:${TURN_EXTERNAL_IP}:${TURN_PORT:-3478}?transport=tcp"
  export TURN_URLS
}

generate_secret() {
  length="${1:-32}"
  tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$length"
}

write_runtime_kv() {
  key="$1"
  value="$2"
  escaped="$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"
  printf "%s='%s'\n" "$key" "$escaped"
}

format_local_url() {
  port="$1"
  if [ "$port" = "80" ]; then
    printf 'http://localhost'
    return
  fi

  printf 'http://localhost:%s' "$port"
}
