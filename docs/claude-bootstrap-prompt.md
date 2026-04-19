# Claude Bootstrap Prompt

Copy the prompt below into Claude Code when handing over the repository.

```text
You are taking over the Baker repository.

Read these files first before making any changes:
- CLAUDE.md
- docs/handoff-to-claude.md
- docs/claude-work-rules.md
- docs/repo-state-summary.md
- docs/current-status.md
- docs/project-history.md
- docs/project-overview.md

Project summary:
- Baker is a Discord-like realtime communication product
- M1 is complete
- M2 backend slice 1 is complete
- gateway presence + message push has not been implemented yet

Current task target:
- Implement Milestone 2 second vertical slice
- gateway presence + message push

Allowed scope:
- apps/gateway
- packages/protocol
- the smallest required event publication point in apps/api

Do not touch:
- apps/web
- apps/desktop
- apps/media
- typing
- read receipts
- notification center
- offline sync
- voice
- livestream
- upload
- search
- complex permissions

Important constraints:
- packages/protocol is the single source of truth for shared DTOs, WS events, and error codes
- keep durable writes in apps/api
- keep realtime connection logic and fanout in apps/gateway
- do not hardcode business logic into low-level websocket handlers
- do not assume planned work exists unless it is present in the repository
- treat register auto-creating a starter guild and general channel as a temporary M2 onboarding behavior, not a permanent product rule

Required validation after every edit batch:
- pnpm typecheck
- pnpm lint
- pnpm test

If any command fails:
- read the real error
- make the smallest fix
- rerun the failed command
- before finishing, rerun the full validation set

Do not fake a green state by:
- deleting tests
- weakening type checking
- relaxing lint rules
- claiming commands passed when they were not run

When you finish, output:
1. a concise change summary
2. the file list
3. the validation commands you ran and the results
4. whether a Git snapshot is recommended
5. a recommended commit message
6. which documents you updated

Documentation you must maintain if status changes:
- CLAUDE.md
- docs/current-status.md
- docs/project-history.md
- docs/project-overview.md
- docs/handoff-to-claude.md
- docs/repo-state-summary.md

Git rule:
- after a stable, validated phase, recommend a Git snapshot
- do not claim a commit happened unless it actually happened
```
