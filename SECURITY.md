# Security Policy

## Supported Versions

Security fixes are tracked against the latest development branch and the latest public release snapshot.

## How To Report

- Do not post secrets, tokens, credentials, or exploit details in public issues.
- Prefer GitHub private vulnerability reporting once the public repository enables it.
- If private reporting is not available yet, open a minimal issue requesting a secure reporting channel without including sensitive details.

## What To Include

Helpful reports usually include:

- affected area or endpoint
- impact summary
- reproduction prerequisites
- version, commit, or deployment context
- whether the issue affects self-hosted defaults, admin controls, auth/session handling, or media/runtime boundaries

## Scope Priorities

The highest-priority areas are:

- authentication, sessions, and token handling
- admin or instance-control surfaces
- gateway and media internal boundaries
- deployment defaults that expose unsafe behavior in self-hosted setups

## Response Expectations

Reports are handled on a best-effort basis. Please avoid public disclosure until maintainers confirm a fix or mitigation path.
