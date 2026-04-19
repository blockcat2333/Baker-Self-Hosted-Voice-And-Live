#!/bin/sh
set -eu

. /opt/baker-runtime/lib.sh
. /opt/baker-allinone/lib.sh

: "${BAKER_DATA_DIR:=/var/lib/baker}"
: "${BAKER_RUNTIME_DIR:=$BAKER_DATA_DIR/runtime}"
: "${TURN_ENABLED:=false}"

export BAKER_RUNTIME_DIR

if ! is_true "$TURN_ENABLED"; then
  echo "[Init] TURN relay disabled"
  exit 0
fi

capture_turn_runtime_overrides
load_runtime_env
apply_turn_runtime_overrides
default_turn_urls_if_needed

if [ -z "${TURN_USERNAME:-}" ] || [ -z "${TURN_PASSWORD:-}" ]; then
  echo "TURN_ENABLED=true requires TURN_USERNAME and TURN_PASSWORD." >&2
  exit 1
fi

if [ -z "${TURN_URLS:-}" ]; then
  echo "TURN_ENABLED=true requires TURN_EXTERNAL_IP or TURN_URLS so clients receive a public TURN relay address." >&2
  exit 1
fi

if [ -n "${TURN_EXTERNAL_IP:-}" ]; then
  EXTERNAL_IP_ARG="--external-ip=$TURN_EXTERNAL_IP"
else
  EXTERNAL_IP_ARG=""
fi

exec turnserver -n --log-file=stdout --fingerprint --lt-cred-mech \
  --realm="$TURN_REALM" \
  --user="$TURN_USERNAME:$TURN_PASSWORD" \
  --listening-port="$TURN_PORT" \
  --min-port="$TURN_MIN_PORT" \
  --max-port="$TURN_MAX_PORT" \
  --no-cli --no-multicast-peers \
  $EXTERNAL_IP_ARG
