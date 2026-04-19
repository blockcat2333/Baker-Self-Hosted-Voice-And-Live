#!/bin/sh

set -eu

cat <<'EOF'
Baker's `blockcat233/baker-runtime` image is the advanced Compose runtime image, not a standalone all-in-one container.

Use Docker Compose to start the full stack instead:

  1. Copy `.env.selfhost.example` to `.env` only if you want fixed secrets, custom ports, or custom image tags.
  2. Start the stack:
       docker compose up -d
  3. Read the first-boot output:
       docker compose logs bootstrap

The advanced Compose stack starts Baker with:
  - blockcat233/baker-runtime
  - blockcat233/baker-proxy
  - postgres:16-alpine
  - redis:7-alpine

If you want the easiest direct-start image, use `blockcat233/baker`.
If you want the advanced multi-service deployment, run the Compose stack from the repository root.
EOF

exit 64
