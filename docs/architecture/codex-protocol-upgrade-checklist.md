# Codex App Server Protocol Upgrade Checklist

Use this checklist before changing `CODEX_VERSION` or
`package.json` `codexIm.codexVersion`.

## Preflight

- Confirm the current local state:
  - `git status --short`
  - `codex --version`
  - `node --version`
  - `pnpm --version`
- Update both version pins together:
  - `CODEX_VERSION`
  - `package.json` `codexIm.codexVersion`
- Do not change product code until the generated protocol diff has been
  reviewed.

## Regenerate And Diff

```bash
pnpm protocol:generate
git diff -- packages/codex-protocol
```

Inspect:

- `packages/codex-protocol/schema/ClientRequest.json`
- `packages/codex-protocol/schema/ServerNotification.json`
- `packages/codex-protocol/schema/v2/ThreadStartParams.json`
- `packages/codex-protocol/schema/v2/ThreadResumeParams.json`
- `packages/codex-protocol/schema/v2/ThreadForkParams.json`
- `packages/codex-protocol/src/generated/v2/ThreadStartParams.ts`
- `packages/codex-protocol/src/generated/v2/ThreadResumeParams.ts`
- `packages/codex-protocol/src/generated/v2/ThreadForkParams.ts`

## Required Semantic Checks

- `ClientRequest` still includes:
  - `thread/start`
  - `thread/resume`
  - `thread/fork`
  - `thread/name/set`
  - `thread/archive`
  - `thread/unarchive`
- `ServerNotification` still includes:
  - `remoteControl/status/changed`
- `ThreadResumeParams` and `ThreadForkParams` still expose
  `excludeTurns`, or every metadata-only resume/fork path is rewritten
  before release.
- If `ThreadStartParams`, `ThreadResumeParams`, or `ThreadForkParams`
  now expose top-level `permissions`, stop and review the
  writable-roots enforcement plan before release.
- If `permissions` is implemented, prove no request combines
  `sandbox` and `permissions`.

## Known Drift Risks From 2026-05-12 Evidence

- `thread/turns/list` exists in the `0.128.0` pin but was absent from
  the latest upstream default schema inspected on 2026-05-12. Audit
  every runtime wrapper and daemon call before bumping.
- Newer upstream methods such as `plugin/share/save`,
  `plugin/share/list`, `plugin/share/updateTargets`,
  `plugin/share/delete`, `plugin/skill/read`, and
  `windowsSandbox/readiness` must not be used until they appear in the
  local generated protocol and have a reviewed product/security plan.
- Newer upstream notifications such as `process/outputDelta` and
  `process/exited` need explicit rendering decisions before they are
  considered supported by the IM bridge.

## Guardrails And Gates

Run:

```bash
pnpm check:app-server-semantics
pnpm check:contract
pnpm typecheck
pnpm typecheck:tests
pnpm test
pnpm lint
pnpm protocol:check
pnpm release:check -- --skip-full-gates
```

If `check:app-server-semantics` fails because `permissions` is now
present, do not suppress the failure. Either implement the reviewed
writable-roots enforcement slice or keep the Codex pin unchanged.

## Forbidden Upgrade Shortcuts

- Do not use upstream `openai/codex` main fields that are absent from
  the local generated protocol.
- Do not tunnel absent fields through `config` or untyped object
  spreads.
- Do not replace the stdio Supervisor lifecycle with
  `codex app-server daemon` in a protocol bump.
- Do not implement remote-control WebSocket as part of a protocol bump.
- Do not change ApprovalBroker, SecurityPolicy, callback token, or
  messageRef semantics as a side effect of regeneration.
