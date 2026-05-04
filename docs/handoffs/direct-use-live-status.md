# Direct Use Live Status

> Single source of truth for Direct Use Completion / Phase 8 production
> usability hardening.
> **Last updated:** 2026-05-04 - Block 4 real Telegram acceptance proved fresh
> Telegram Web `Allow once` through the installed launchd daemon, fixed
> `/switch` empty-thread resume, `/fork` empty-rollout UX, production IM
> approval handler timeout, and terminal approval card metadata preservation.
> Installed launchd daemon is healthy; remaining live matrix work is decline,
> abort, allow-session, and duplicate/stale-click coverage.

## 1. Current State

- **Mode:** Block 4 real production acceptance hardening in progress.
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
  - `6b7df19` - C7 Telegram turn output streams progress, chunks long
    output, and summarizes native Codex development/tool-call items.
  - `da34eaf` - C8 production launchd install defaults to the installed
    `app/daemon.mjs`, copies the daemon runtime dependency closure, and verifies
    the real LaunchAgent reaches `state = running`.
  - latest commit - C9 `/start` help states that non-command messages are
    Codex prompts for the current project/thread and that native file/command/tool
    activity may appear as `Codex items`.
  - latest commit - live Telegram acceptance hardening: current-thread
    `/switch` no longer resumes empty fresh threads, no-rollout `/fork` now
    returns actionable IM guidance, and production IM approval handlers outlive
    the previous 30s AppServerClient safety timeout.
  - latest patch - terminal resolved approval cards preserve original
    `kind`/`risk`/summary while removing buttons and retaining token-free
    rendering.
- **Next exact action:** continue Telegram Web approval button matrix:
  decline, abort, allow-session, and duplicate/stale-click coverage.

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
| Block 4 | real production acceptance + 24h soak | in progress: installed bridge daemon is running under launchd; Telegram bootstrap/help and richer Codex turn output implemented |

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

Latest C8 targeted and live launchd evidence:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit scripts/build-daemon-bundle.test.mts scripts/install-bridge.test.mjs scripts/install-launchd.test.mjs scripts/release-readiness-check.test.mts scripts/load-and-run.test.mjs packages/daemon/test/logger.test.ts` | green: 6 files, 38 passing |
| `pnpm launchd:uninstall || true && pnpm bridge:build && pnpm bridge:install && pnpm launchd:install && pnpm launchd:status` | green; launchd loaded installed `~/.codex-im-bridge/app/daemon.mjs`, `daemon status: present pid=44886`, and `launchctl print` reported `state = running` |
| launchd stdout/stderr spot check | token log stayed `***REDACTED***`; only Node deprecation warnings in stderr |
| `pnpm typecheck` | green |
| `pnpm lint` | green: 332 files checked |
| `pnpm test` | green: 148 files, 1334 passing, 1 skipped |
| `pnpm protocol:check` | green |
| `pnpm release:check -- --skip-full-gates` | green; bridge install, launchd dry-run, redaction scan, daemon roundtrip, fake IM smokes, and default live gates passed |
| follow-up `pnpm launchd:status` | still green; `daemon status: present pid=44886`, `launchctl` still `state = running`, `last exit code = (never exited)` |

Latest C9 targeted gate:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/daemon/test/daemon.test.ts` | green: 1 file, 107 passing |
| `pnpm typecheck` | green |
| `pnpm lint` | green: 332 files checked |
| `pnpm test` | green: 148 files, 1334 passing, 1 skipped |
| `pnpm protocol:check` | green |
| `pnpm release:check -- --skip-full-gates` | green; bridge install, launchd dry-run, redaction scan, daemon roundtrip, fake IM smokes, and default live gates passed |
| `pnpm launchd:uninstall || true && pnpm bridge:build && pnpm bridge:install && pnpm launchd:install && pnpm launchd:status` | green; reinstalled C9 bundle, `daemon status: present pid=70626`, `launchctl` `state = running`, token log redacted |

Latest soak checks:

| Time | Result |
|---|---|
| 2026-05-04 00:23 SGT | `pnpm launchd:status` still green for pid `70626`; `launchctl print` still reports `state = running`, `runs = 1`, `last exit code = (never exited)`; daemon logs show startup plus Node deprecation warnings only; installed bridge redaction scan passed |
| 2026-05-04 00:54 SGT | launchd still reports `state = running`, `runs = 1`, `pid = 70626`, and `last exit code = (never exited)`; daemon logs unchanged and redacted. `launchd:status` initially marked the snapshot stale because sandboxed PID probing could not inspect the external process, so `bin/launchd-status.mjs` now also accepts matching `launchctl print` pid evidence; targeted `scripts/launchd-status.test.mjs` passed and `pnpm launchd:status` is green again |
| 2026-05-04 11:19 SGT | Rebuilt and reinstalled the production daemon bundle after live Telegram findings; `launchctl kickstart -k gui/501/io.codex-im-bridge` started pid `10065`; `pnpm launchd:status` reports `daemon status: present pid=10065 startedAt=2026-05-04T03:19:44.379Z codexThreads=0 pendingApprovals=0`; token log remains `***REDACTED***`; stderr contains only Node deprecation warnings |

Latest live Telegram acceptance evidence:

| Area | Evidence | Status |
|---|---|---|
| Bot/API health | Keychain-backed Bot API `getMe` returned `jackcodexbot`; `getWebhookInfo` shows webhook `url=""`, `pending_update_count=0`, and no last error, so the launchd daemon owns long polling and Telegram has no backlog | green |
| Bootstrap/control plane | Telegram Web showed `/start`, `/status`, `/projects`, `/use codex-im`, `/new <title>`, `/alias <title>`, `/threads`, and `/switch 1` working against the real bot after the `/switch` current-thread fix | green |
| Native Codex prompt | `Reply exactly: LIVE-AUTO-1053` returned exactly `LIVE-AUTO-1053` through the real Telegram bot and launchd daemon | green |
| Development-task behavior | A Telegram prompt asking Codex to run read-only `git status --short` and `git log --oneline -3` returned `DEV-STATUS-1056 ...` plus native `commandExecution completed` Codex item summaries | green |
| Forking | `/fork` fails on an empty no-rollout thread in Codex App Server; daemon now returns an actionable IM message telling the user to run a prompt first. After a turn exists, `/fork` succeeded and rebound the current Telegram target to the forked Codex thread | fixed/green |
| Approval timeout | Real Telegram prompt for a write command produced a pending approval card. After the 31-minute production server-request handler timeout patch, a fresh Telegram Web `Allow once` click created `/tmp/codex-im-live-allow-once-20260504-1147.txt`, returned `Done`, and `pnpm launchd:status` reported pid `10065` with `pendingApprovals=0` | fixed/green |
| Stale callback fail-closed | Clicking a pre-restart stale `Allow once` button left `/tmp/codex-im-live-allow-once-20260504-1100.txt` absent and audit recorded `approval.callback_not_bound` with `result=revoked` | green |
| Terminal approval card metadata | Fresh Telegram Web approval after reinstalling the patched daemon bundle created `/tmp/codex-im-live-terminal-card-20260504-1200.txt`; the resolved card now shows `Decision recorded: allow once`, original command summary, `Kind: command_execution`, `Risk: high`, and `Status: resolved` with buttons removed | fixed/green |
| UI driver availability | Computer Use / Chrome Accessibility timed out during this run, but macOS screenshots plus System Events clicks worked against real Telegram Web. Treat Computer Use timeout as a local UI automation issue, not daemon failure | workaround green |

Latest live-acceptance hardening gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/daemon/test/daemon.test.ts` | green: 1 file, 109 passing |
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/cli/test/daemon-run.test.ts` | green: 1 file, 4 passing |
| `pnpm typecheck` | green |
| `pnpm lint` | green: 332 files checked |
| `pnpm test` | green: 148 files, 1338 passing, 1 skipped |
| `pnpm protocol:check` | green |
| `pnpm bridge:build && pnpm bridge:install && pnpm launchd:install && launchctl kickstart -k gui/501/io.codex-im-bridge && pnpm launchd:status` | green with installed daemon pid `10065`; `launchd:install` still prints expected `Load failed: 5` because the LaunchAgent is already loaded, but exits 0 and `launchd:status` is green |

Latest terminal-card metadata gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/daemon/test/daemon.test.ts` | green: 1 file, 110 passing |
| `pnpm exec vitest run --config vitest.config.ts --project unit packages/cli/test/daemon-run.test.ts` | green: 1 file, 5 passing |
| `pnpm typecheck` | green |
| `pnpm lint` | green: 332 files checked |
| `pnpm test` | green: 148 files, 1340 passing, 1 skipped |
| `pnpm protocol:check` | green |
| `pnpm bridge:build && pnpm bridge:install && launchctl kickstart -k gui/501/io.codex-im-bridge && pnpm launchd:status` | green with installed daemon pid `21579`; fresh Telegram Web `Allow once` created `/tmp/codex-im-live-terminal-card-20260504-1200.txt` and resolved card preserved `command_execution/high` |

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
4. `fix(launchd): run installed app daemon with packaged runtime deps` (done)
5. `fix(daemon): clarify native prompt and Codex item help` (done)
6. `fix(daemon): avoid current-thread resume for empty /new threads` (done)
7. `fix(daemon): make no-rollout /fork actionable in IM` (done)
8. `fix(cli): keep production IM approval handlers pending beyond 30s` (done)
9. `fix(telegram): preserve approval kind/risk on resolved cards` (done)
10. Next: finish real Telegram Web approval button matrix for decline,
    abort, allow-session, and duplicate/stale-click coverage.

## 8. Compact / Resume

If resuming this work:

1. Read this file first.
2. Read `docs/superpowers/plans/2026-05-03-direct-use-completion-plan.md`.
3. Read `AGENTS.md`.
4. Run `git status --short` and `git log --oneline -8`.
5. Continue from the current block only when branch/HEAD/scope are clear.
