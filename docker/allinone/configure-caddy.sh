#!/bin/sh
set -eu

runtime_lib="${BAKER_RUNTIME_LIB:-/opt/baker-runtime/lib.sh}"
. "$runtime_lib"

: "${BAKER_RUNTIME_DIR:=/var/lib/baker/runtime}"
: "${BAKER_HTTPS_ENABLED:=false}"
: "${BAKER_HTTPS_PORT:=3443}"

caddy_runtime_dir="$BAKER_RUNTIME_DIR/caddy"
caddy_https_file="$caddy_runtime_dir/https.caddy"
caddy_https_tmp="$caddy_https_file.tmp"

mkdir -p "$caddy_runtime_dir"
chmod 700 "$caddy_runtime_dir"
umask 077

write_disabled_config() {
  printf '# Optional HTTPS listener is disabled.\n' >"$caddy_https_tmp"
  mv "$caddy_https_tmp" "$caddy_https_file"
}

if ! is_true "$BAKER_HTTPS_ENABLED"; then
  write_disabled_config
  exit 0
fi

https_host="${BAKER_HTTPS_HOST:-}"
case "$https_host" in
  ''|*[!A-Za-z0-9.-]*|.*|*..*|*.)
    echo "BAKER_HTTPS_HOST must be a valid DNS hostname." >&2
    exit 1
    ;;
esac

case "$BAKER_HTTPS_PORT" in
  ''|*[!0-9]*)
    echo "BAKER_HTTPS_PORT must be an integer between 1 and 65535." >&2
    exit 1
    ;;
esac
if [ "$BAKER_HTTPS_PORT" -lt 1 ] || [ "$BAKER_HTTPS_PORT" -gt 65535 ]; then
  echo "BAKER_HTTPS_PORT must be an integer between 1 and 65535." >&2
  exit 1
fi

if [ -z "${ALIYUN_ACCESS_KEY_ID:-}" ] || [ -z "${ALIYUN_ACCESS_KEY_SECRET:-}" ]; then
  echo "Aliyun DNS-01 requires ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET." >&2
  exit 1
fi

cat >"$caddy_https_tmp" <<EOF
https://${https_host}:${BAKER_HTTPS_PORT} {
	import baker_web

	tls {
		dns alidns {
			access_key_id {env.ALIYUN_ACCESS_KEY_ID}
			access_key_secret {env.ALIYUN_ACCESS_KEY_SECRET}
		}
	}
}
EOF

mv "$caddy_https_tmp" "$caddy_https_file"
echo "[HTTPS] Configured DNS-01 TLS for ${https_host}:${BAKER_HTTPS_PORT}."
