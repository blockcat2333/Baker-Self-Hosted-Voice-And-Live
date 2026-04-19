#!/bin/sh

RUNTIME_DIR="${BAKER_RUNTIME_DIR:-/run/baker}"
RUNTIME_ENV="${RUNTIME_DIR}/runtime.env"

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
