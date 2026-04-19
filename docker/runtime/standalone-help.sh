#!/bin/sh

set -eu

cat <<'EOF'
Baker's `services-runtime` image target is an internal runtime layer for local development and image assembly. It is not the supported public deployment entrypoint.

Use the published all-in-one image instead:

  docker run -d --name baker \
    -p 3000:80 \
    -p 3001:8080 \
    -v baker-data:/var/lib/baker \
    blockcat233/baker:latest

Then open:
  - http://localhost:3000
  - http://localhost:3001

Browser voice, camera, and screen sharing require HTTPS in real deployments.
EOF

exit 64
