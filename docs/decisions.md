# Decisions

## M1 Service Boundary Decision

Decision:

- keep `apps/api`, `apps/gateway`, and `apps/media` separate from the start

Why:

- prevents durable CRUD, realtime routing, and media orchestration from collapsing into one service

Alternatives rejected:

- one backend app for everything
- deeper microservice split in M1

Impact:

- clearer boundaries now
- slightly more workspace/setup overhead

Reference:

- `docs/adr/0001-service-boundaries.md`

## M1 Validation Baseline Decision

Decision:

- M1 is only accepted when `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass

Why:

- later milestones depend on a stable baseline
- type-only or test-only acceptance would hide integration issues

Alternatives rejected:

- postponing type issues to M2
- weakening lint or test requirements

Impact:

- slightly more dependency setup in M1
- much lower risk of dragging broken scaffolding into feature work

## Discord-Inspired UI Reference Decision

Decision:

- use Discord as the primary interaction and information-hierarchy reference for Baker's Web and Windows clients
- reproduce familiar patterns such as compact grouped context menus, member actions, voice controls, livestream entry points, tooltips, and touch long-press equivalents
- keep Baker branding, assets, implementation, and product-specific controls independent

Why:

- users already understand Discord's realtime channel, voice, and livestream interaction vocabulary
- familiar placement and feedback reduce ambiguity around high-frequency actions such as mute, leave, participant volume, and watching a stream
- a shared reference keeps the browser client, Windows client, settings, and admin panel visually coherent

Alternatives rejected:

- continuing with separate ad-hoc interaction patterns for each feature
- copying Discord assets or hiding Baker-specific network and livestream controls to match the reference exactly
- introducing a multi-level settings architecture before the product requires that complexity

Impact:

- UI reviews should compare interaction clarity and hierarchy against Discord where applicable
- Baker may intentionally diverge for extended stream quality options, selective application-audio capture, self-hosted deployment controls, and voice/livestream network diagnostics
- touch layouts must provide long-press or explicit controls for actions that use right-click on desktop
