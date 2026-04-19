#!/bin/sh
set -eu

: "${BAKER_DATA_DIR:=/var/lib/baker}"
: "${REDIS_DATA_DIR:=$BAKER_DATA_DIR/redis}"

mkdir -p "$REDIS_DATA_DIR"
chown -R redis:redis "$REDIS_DATA_DIR"

exec gosu redis redis-server \
  --bind 127.0.0.1 \
  --port 6379 \
  --appendonly yes \
  --dir "$REDIS_DATA_DIR" \
  --protected-mode yes
