#!/bin/sh

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

capture_env_override() {
  var="$1"
  eval "if [ \"\${$var+x}\" = x ]; then export BAKER_OVERRIDE_HAS_${var}=1; export BAKER_OVERRIDE_${var}=\"\${$var}\"; fi"
}

apply_env_override() {
  var="$1"
  eval "if [ \"\${BAKER_OVERRIDE_HAS_${var}:-}\" = 1 ]; then export ${var}=\"\${BAKER_OVERRIDE_${var}}\"; fi"
}

capture_turn_runtime_overrides() {
  capture_env_override STUN_URLS
  capture_env_override TURN_URLS
  capture_env_override TURN_USERNAME
  capture_env_override TURN_PASSWORD
  capture_env_override TURN_REALM
  capture_env_override TURN_PORT
  capture_env_override TURN_MIN_PORT
  capture_env_override TURN_MAX_PORT
  capture_env_override TURN_EXTERNAL_IP
}

apply_turn_runtime_overrides() {
  apply_env_override STUN_URLS
  apply_env_override TURN_URLS
  apply_env_override TURN_USERNAME
  apply_env_override TURN_PASSWORD
  apply_env_override TURN_REALM
  apply_env_override TURN_PORT
  apply_env_override TURN_MIN_PORT
  apply_env_override TURN_MAX_PORT
  apply_env_override TURN_EXTERNAL_IP
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

wait_for_tcp() {
  host="$1"
  port="$2"
  label="$3"
  attempts="${4:-120}"
  i=0

  while ! nc -z "$host" "$port" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "$attempts" ]; then
      echo "Timed out waiting for $label at ${host}:${port}" >&2
      return 1
    fi
    sleep 1
  done
}

wait_for_http() {
  url="$1"
  label="$2"
  attempts="${3:-120}"
  i=0

  while ! curl -fsS "$url" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "$attempts" ]; then
      echo "Timed out waiting for $label at $url" >&2
      return 1
    fi
    sleep 1
  done
}

postgres_server_opts() {
  printf '%s' "-c listen_addresses=127.0.0.1 -c port=5432 -c unix_socket_directories=/var/run/postgresql"
}

postgres_dsn() {
  printf 'postgres://%s:%s@127.0.0.1:5432/%s' "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$POSTGRES_DB"
}

sql_literal() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

sql_identifier() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/"/""/g')"
}
