# Claude Work Rules

This file is written for Claude Code or any follow-up AI working in this repository.

## Required Validation After Every Change

After each code or documentation change batch, run:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

## Failure Handling

- if any command fails, read the actual error output
- make the smallest reasonable fix
- rerun the failed command
- before finishing the task, rerun the full set:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`

## What Is Not Allowed

- do not delete tests to make the suite pass
- do not disable or weaken type checking
- do not relax lint rules to get a green run
- do not pretend a command passed if it was not actually executed
- do not pretend a Git commit happened if it did not
- do not expand into unapproved modules or features

## Scope Discipline

- stay inside the user-approved module scope
- do not modify `web`, `desktop`, or `media` unless that scope is explicitly approved
- do not implement future milestone features early
- keep `packages/protocol` as the single source of truth for shared contracts

## Documentation Discipline

Whenever a stable phase is completed or project state changes materially:

- update `docs/current-status.md`
- update `docs/project-history.md`
- update `docs/project-overview.md` when scope or runnable surface changed
- update `CLAUDE.md` or other handoff documents when the recommended next task or repo status changes

## Git Snapshot Rule

After completing a stable, validated stage:

- recommend creating a Git snapshot
- provide a concise Conventional Commit style message
- state clearly whether Git status was checked
- state clearly whether a commit was actually created

## Blocking Rule

If you cannot run a required command because of permissions, sandbox restrictions, missing tools, or environment issues:

- say exactly which command was blocked
- say why it was blocked
- do not claim validation is complete

## Output Rule

At the end of a task, provide:

1. a change summary
2. the file list
3. the validation commands that were run and their results
4. whether a Git snapshot is recommended
5. a recommended commit message
6. the documents that were updated
