#!/bin/sh

set -eu

cat <<'EOF'
Baker's `blockcat233/baker` image is a shared runtime image, not a standalone all-in-one container.

Use Docker Compose to start the full stack instead:

  1. Copy `.env.selfhost.example` to `.env` only if you want fixed secrets, custom ports, or custom image tags.
  2. Start the stack:
       docker compose up -d
  3. Read the first-boot output:
       docker compose logs bootstrap

The Compose stack starts Baker with:
  - blockcat233/baker
  - blockcat233/baker-proxy
  - postgres:16-alpine
  - redis:7-alpine

If you only want to inspect the image locally, that is fine.
If you want a working Baker instance, please run the Compose stack from the repository root.
EOF

exit 64
