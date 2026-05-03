# Direct Use Live Status

> Single source of truth for Direct Use Completion / Phase 8 production
> usability hardening.
> **Last updated:** 2026-05-03 - Block 4 production acceptance prep in
> progress; C7 improves Telegram turn output with progress edits, chunked long
> output, and native Codex item summaries for development/tool-call work.

## 1. Current State

- **Mode:** Block 4 real production acceptance prep in progress.
- **Plan:** `docs/superpowers/plans/2026-05-03-direct-use-completion-plan.md`.
- **Prior release baseline:** `production-readiness-2026-05-03-r2`.
- **Prior Phase 7 status:** complete; do not mutate Phase 7 as hidden tail work.
- **Branch:** `codex/live-im-acceptance`.
- **Baseline HEAD:** `a641159`.
- **Linear:** create a new parent/milestone named
  `Direct Use Completion / Phase 8 - Production usability hardening`.
- **Current implementation block:** Block 4 - launchd / soak evidence.
- **Completed in this effort:**
  - `3bcdcd0` - docs-only Direct Use / Phase 8 plan v2 and live-status anchor.
  - `15dfba6` - A1 launchd dry-run runtime verification.
  - `42098fb` - A2 daemon bundle build artifact.
  - `3752f01` - A3 bridge install app layout + installed daemon preflight.
  - `90ff7ec` - A4 release-readiness bridge chain + ops doc convergence.
  - `48e85c5` - B0 IM command control-plane hard gates.
  - `6057714` - B1 `/help`, `/projects`, `/status` IM-safe controls.
  - `7892bed` - B2 `thread_sessions` migration + repository.
  - `0e631d0` - B3 `/new [title]` durable thread creation.
  - `e11d4ff` - B4 `/threads [project]` thread listing.
  - `71d346d` - B5 `/switch <thread>` resume-before-bind flow.
  - `1479a37` - B6 `/alias <title>` local display metadata.
  - `9a7f9da` - B7 production daemon-run thread session repository wire-up.
  - `b5d86c5` - B8 `/fork [thread]` Codex thread fork control.
  - `15e3547` - C1 `smoke:daemon-roundtrip` non-live daemon control and
    approval callback smoke.
  - `38af098` - C2 rename/clarify `smoke:telegram-side-by-side` as the
    live Telegram adapter + real Codex side-by-side check.
  - `6839f98` - C3 `smoke:telegram-live-roundtrip` operator-gated real
    Telegram inbound daemon evidence.
  - `0e0c016` - C4 IM terminal output appends concise non-chat Codex item
    summaries.
  - `dfe732c` - C5 read-only `launchd:status` evidence command.
  - `92c5c5e` - C6 Telegram `/start` bootstrap maps to existing help.
  - latest commit - C7 Telegram turn output streams progress, chunks long
    output, and summarizes native Codex development/tool-call items.
- **Next exact action:** run live roundtrip with Telegram Web when an
  operator/browser driver can send the nonce prompt; launchd install/soak
  remains operator-gated.

## 2. Why This Exists

Telegram live acceptance proved the real adapter and approval path with an
operator-driven foreground daemon. That is not yet enough for direct daily use.

The direct-use blocker is:

```text
installed bridge artifact
-> launchd-loaded daemon
-> repeatable non-live daemon round-trip
-> operator-gated live Telegram round-trip
-> launchd soak evidence
```

## 3. GPT Pro Verdict

Verdict: `APPROVE_WITH_CHANGES`.

Required P0 plan edits:

- Treat this as Direct Use Completion / Phase 8, not Phase 7 tail work.
- Add this live-status anchor.
- Prove `better-sqlite3` and other runtime dependencies work from the installed
  bridge artifact, not just the repo checkout.
- Make `release:check` prove build -> temp HOME install -> installed daemon
  preflight -> launchd dry-run -> redaction scan.
- Split Telegram smoke into injected daemon round-trip, operator-gated live
  Telegram round-trip, and launchd soak.
- Make `/use`, `/new`, `/switch`, and `/fork` refuse while an active turn or
  pending approval exists.
- Require `/switch` to call `thread/resume` before mutating the current binding.
- Keep `thread_bindings` as current pointer and add `thread_sessions` for known
  real Codex threads.

## 4. Block Queue

| Block | Scope | Status |
|---|---|---|
| Block 0 | plan v2 + live-status + Linear parent | repo docs complete; Linear parent still to create |
| Block 1 | truthful production launch chain | complete through A4 |
| Block 2 | IM command control plane | complete through B8 |
| Block 3 | repeatable smoke layers | complete through C4; live roundtrip command ready, real browser-driver send still pending |
| Block 4 | real production acceptance + 24h soak | in progress: Telegram bootstrap help and richer Codex turn output implemented, gates green |

## 5. Active Redlines

- No OpenClaw plugin.
- No Codex CLI/TUI output parsing as product protocol.
- No generic chat abstraction replacing Codex App Server rich semantics.
- No public App Server listener.
- No approval bypass.
- No raw callback token persistence, display, docs, logs, or Linear leakage.
- `messageRef` and server-side callback/approval binding remain required before
  `ApprovalBroker.resolve()`.
- No command may switch project/thread while an active turn or pending approval
  exists.
- No live external call by default.
- No Keychain write by default.
- No launchd install/uninstall by default.
- No implicit Computer Use.

## 6. Latest Gate Evidence

Last known full local gates at baseline `a641159`:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green |
| `pnpm lint` | green |
| `pnpm protocol:check` | green |
| `pnpm test` | green: 141 files, 1261 passing, 1 skipped |

Latest Block 0 docs-only gates:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green |
| `pnpm test` | green: 141 files, 1261 passing, 1 skipped |
| `pnpm lint` | green: 316 files checked |
| `pnpm protocol:check` | green |

Latest A1 targeted gate:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --project unit scripts/install-launchd.test.mjs` | green: 1 file, 8 passing |

Latest A1 full gates:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green |
| `pnpm test` | green: 141 files, 1263 passing, 1 skipped |
| `pnpm lint` | green: 316 files checked |
| `pnpm protocol:check` | green |

Latest A2 targeted gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit scripts/build-daemon-bundle.test.mts` | green: 1 file, 4 passing |
| `pnpm bridge:build` | green; produced ignored local `dist/codex-im-daemon.mjs` |

Latest A2 full gates:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green |
| `pnpm test` | green: 142 files, 1267 passing, 1 skipped |
| `pnpm lint` | green: 319 files checked |
| `pnpm protocol:check` | green |

Latest A3 targeted gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit scripts/build-daemon-bundle.test.mts scripts/install-bridge.test.mjs scripts/uninstall-bridge.test.mjs scripts/load-and-run.test.mjs packages/cli/test/daemon-run.test.ts` | green: 5 files, 21 passing |
| `pnpm bridge:build && pnpm bridge:install -- --home <temp>` | green; installed app layout with `better-sqlite3@12.9.0`, `bindings@1.5.0`, `file-uri-to-path@1.0.0`; installed daemon preflight `ok` |
| `pnpm typecheck` | green |
| `pnpm test` | green: 144 files, 1278 passing, 1 skipped |
| `pnpm lint` | green: 323 files checked |
| `pnpm protocol:check` | green |

Latest A4 gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit scripts/release-readiness-check.test.mts` | green: 1 file, 8 passing |
| `pnpm release:check -- --skip-full-gates` | green; bridge build, dry-run install, real temp-HOME install, installed daemon preflight, launchd dry-run, wrapper dry-run, redaction scan, backup proof, fake IM smokes, and default live gates all passed |
| `pnpm typecheck` | green |
| `pnpm test` | green: 144 files, 1279 passing, 1 skipped |
| `pnpm lint` | green: 324 files checked |
| `pnpm protocol:check` | green |

Latest B0 targeted gate:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/core/test/command-router.test.ts packages/daemon/test/daemon.test.ts` | green: 2 files, 92 passing |
| `pnpm typecheck` | green |
| `pnpm test` | green: 144 files, 1287 passing, 1 skipped |
| `pnpm lint` | green: 324 files checked |
| `pnpm protocol:check` | green |

Latest B8 targeted gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/daemon/test/daemon.test.ts` | green: 1 file, 107 passing |
| `pnpm typecheck` | green |
| `pnpm test` | green: 145 files, 1317 passing, 1 skipped |
| `pnpm lint` | green: 326 files checked |
| `pnpm protocol:check` | green |

Latest C1 targeted gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/cli/test/daemon-roundtrip-smoke.test.ts scripts/release-readiness-check.test.mts` | green: 2 files, 10 passing |
| `pnpm smoke:daemon-roundtrip` | green: `/use`, `/new`, `/fork`, `/threads`, `/switch`, prompt turn, `/stop`, approval card, callback resolve |
| `pnpm typecheck` | green |
| `pnpm lint` | green: 328 files checked |
| `pnpm test` | green: 146 files, 1319 passing, 1 skipped |
| `pnpm protocol:check` | green |
| `pnpm release:check -- --skip-full-gates` | green; includes `smoke-daemon-roundtrip` with installed bridge migrations |

Latest C2 gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/cli/test/telegram-real-smoke.test.ts scripts/release-readiness-check.test.mts` | green: 2 files, 13 passing |
| `pnpm smoke:telegram-side-by-side` without live env | expected refusal: exits 1 with operator-gated Telegram message |
| `pnpm release:check -- --skip-full-gates` | green; default release gate now checks `smoke-telegram-side-by-side-default-gate` |
| `pnpm typecheck` | green |
| `pnpm test` | green: 146 files, 1319 passing, 1 skipped |
| `pnpm lint` | green: 328 files checked |
| `pnpm protocol:check` | green |

Latest C3 targeted gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/im-telegram/test/live-smoke-bot.test.ts packages/cli/test/telegram-live-roundtrip-smoke.test.ts scripts/release-readiness-check.test.mts` | green: 3 files, 16 passing |
| `pnpm smoke:telegram-live-roundtrip` without live env | expected refusal: exits 1 with operator-gated live roundtrip message |
| `pnpm release:check -- --skip-full-gates` | green; default release gate now checks `smoke-telegram-live-roundtrip-default-gate` |
| `pnpm typecheck` | green |
| `pnpm lint` | green: 330 files checked |
| `pnpm test` | green: 147 files, 1326 passing, 1 skipped |
| `pnpm protocol:check` | green |

Latest C4 gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/daemon/test/turn-output.test.ts` | green: 1 file, 3 passing |
| `pnpm typecheck` | green |
| `pnpm lint` | green: 330 files checked |
| `pnpm test` | green: 147 files, 1327 passing, 1 skipped |
| `pnpm protocol:check` | green |

Latest C5 targeted gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit scripts/launchd-status.test.mjs` | green: 1 file, 4 passing |
| `pnpm launchd:status` | expected local not-loaded exit 2; reports missing plist, not-loaded launchctl, and stale daemon status snapshot without token material |
| `pnpm typecheck` | green |
| `pnpm lint` | green: 332 files checked |
| `pnpm test` | green: 148 files, 1331 passing, 1 skipped |
| `pnpm protocol:check` | green |

Latest C6 gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/core/test/command-router.test.ts packages/daemon/test/daemon.test.ts` | green: 2 files, 112 passing |
| `pnpm typecheck` | green |
| `pnpm lint` | green: 332 files checked |
| `pnpm test` | green: 148 files, 1331 passing, 1 skipped |
| `pnpm protocol:check` | green |

Latest C7 gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/daemon/test/turn-output.test.ts packages/cli/test/telegram-live-roundtrip-smoke.test.ts` | green: 2 files, 11 passing |
| `pnpm typecheck` | green |
| `pnpm lint` | green: 332 files checked |
| `pnpm test` | green: 148 files, 1333 passing, 1 skipped |
| `pnpm protocol:check` | green |
| `pnpm release:check -- --skip-full-gates` | green; includes bridge install chain, daemon roundtrip, fake IM smokes, and default live gates |

## 7. Next Implementation Order

Start with Block 1 only:

1. Done: `fix(launchd): verify runtime paths during dry-run`
2. Done: `feat(bridge): build daemon bundle`
3. Done: `feat(bridge): install runtime app artifacts and dependencies`
4. Done in A3: `test(bridge): prove installed daemon preflight from temp HOME`
5. Done: `test(release): prove bridge install -> launchd dry-run chain`
6. Done in A4: `docs(ops): update production launch docs to remove false-green wording`

Do not start Track B commands until Block 1 is green.

Block 2:

1. Done: `fix(daemon): refuse context switches during active work`
2. Next: `feat(daemon): implement help projects and status commands`
3. `feat(storage): add thread_sessions migration and repository` (done)
4. `feat(daemon): implement /new with durable thread session persistence` (done)
5. `feat(daemon): implement /threads` (done)
6. `feat(daemon): implement /switch with thread/resume-before-bind` (done)
7. `feat(daemon): implement /alias` (done)
8. `fix(cli): wire thread sessions into production daemon-run` (done)
9. `feat(daemon): implement /fork with thread/fork semantics` (done)

Block 3:

1. `test(smoke): add daemon roundtrip control and approval smoke` (done)
2. `chore(smoke): clarify Telegram side-by-side smoke` (done)
3. `test(smoke): add operator-gated live Telegram roundtrip evidence` (done)
4. `feat(daemon): append Codex item summaries to IM turn output` (done)

Block 4:

1. `chore(launchd): add read-only launchd status evidence command` (done)
2. `fix(telegram): map /start to help` (done)
3. `feat(daemon): stream and chunk Codex turn output for IM` (done)

## 8. Compact / Resume

If resuming this work:

1. Read this file first.
2. Read `docs/superpowers/plans/2026-05-03-direct-use-completion-plan.md`.
3. Read `AGENTS.md`.
4. Run `git status --short` and `git log --oneline -8`.
5. Continue from the current block only when branch/HEAD/scope are clear.
