# Direct Use Completion Plan

Generated: 2026-05-03
Status: v2 - GPT Pro `APPROVE_WITH_CHANGES` absorbed; implementation may start
after this docs-only plan update
Branch at draft time: `codex/live-im-acceptance`
HEAD at draft time: `a641159`

## 1. Goal

Make Codex IM Rich Client directly usable as a local Mac mini daemon controlled
from IM, not just manually runnable from a foreground terminal.

Directly usable means:

- documented launchd startup works for a configured local Mac user account;
- release gates prove the installed deployment chain instead of reporting false
  green;
- Telegram has repeatable smoke coverage that truthfully separates injected
  daemon round-trip, operator-gated live Telegram, and launchd soak evidence;
- IM users can select projects, inspect status, start new Codex threads, and
  switch among known Codex threads without inventing an IM-only task model;
- Lark and DingTalk live checks can be run with the same acceptance language as
  Telegram when credentials are available.

## 2. Source Of Truth

This work is a new Direct Use Completion / Phase 8 production-usability
hardening effort. It must not silently mutate the already completed Phase 7
state.

Canonical anchors:

- Plan: `docs/internal/superpowers/plans/2026-05-03-direct-use-completion-plan.md`
- Live status: `docs/internal/handoffs/direct-use-live-status.md`
- Prior release candidate handoff:
  `docs/internal/handoffs/2026-05-03-production-readiness.md`
- Prior live IM acceptance status:
  `docs/internal/handoffs/live-im-acceptance-status.md`
- Linear: create a new parent/milestone named
  `Direct Use Completion / Phase 8 - Production usability hardening` before
  tracking implementation issues. Do not attach this work as hidden tail work
  under completed Phase 7.

## 3. Current Verified Baseline

Claude Code, Codex, and GPT Pro agree on the current state:

- `JAC-174` Telegram live acceptance can remain Done.
- Real Telegram Web exercised project selection, real Codex turns, approval
  buttons, stale-thread recovery, stale callback cleanup, and `/stop` idle UX.
- Full local gates at `a641159` passed: `pnpm typecheck`, `pnpm lint`,
  `pnpm protocol:check`, and `pnpm test` (`141` files, `1261` pass, `1` skip).
- The caveat is explicit: acceptance used an operator-driven foreground daemon,
  not a launchd-loaded `~/.codex-im-bridge/bin/daemon.mjs`.

The remaining blocker is not the Telegram adapter architecture. It is the
production deployment chain plus repeatable control-plane ergonomics.

## 4. Non-Goals

- Do not implement OpenClaw integration.
- Do not parse Codex CLI/TUI output as product protocol.
- Do not expose a public App Server listener.
- Do not store or paste IM tokens, private chat IDs, cookies, or Keychain output.
- Do not make Computer Use implicitly trigger from normal prompts.
- Do not create projects from IM in this pass. Project creation affects local
  paths, ACLs, and writable roots, so it remains config/admin controlled.
- Do not implement local-only thread close semantics unless Codex App Server has
  a matching thread close protocol method. Hidden/closed IM state would drift
  from Codex App semantics.
- Do not claim fully automated real Telegram inbound unless a real user/client
  automation path exists and has been reviewed separately.

## 5. Track A: Production Launch Chain

Track A must complete before Track B command expansion. It closes the direct-use
blocker: the installed daemon must run from `~/.codex-im-bridge`, not merely from
a foreground repo terminal.

### A1. Tighten `launchd:install --dry-run`

Files:

- `bin/install-launchd.mjs`
- `bin/install-launchd.test.mjs`

Change:

- Move `verifyLaunchdRuntimePaths(plan, ...)` before the dry-run early return.
- Dry-run must fail clearly when `daemonEntry`, `wrapperEntry`, or `nodeBin` is
  missing or not executable.
- Refuse symlinked install targets under `~/.codex-im-bridge`.
- Allow `nodeBin` to be a symlink only if `realpath` resolves to an executable.

Acceptance:

- Unit test proves dry-run calls runtime-path verification.
- Unit test proves `nodeBin` symlink handling is intentional.
- `pnpm release:check` may temporarily fail after this commit. That is expected
  because the gate becomes truthful before the bridge install chain exists.

### A2. Build a launchd-runnable daemon artifact

Files:

- `packages/cli/src/daemon-run-bundle-entry.ts`
- `scripts/build-daemon-bundle.mts`
- `scripts/build-daemon-bundle.test.mts`
- `package.json`

Change:

- Add a thin bundle entry that calls `daemon-run.ts` `run(argv)`.
- Use esbuild to produce `dist/codex-im-daemon.mjs`.
- Use `format: "esm"`, `platform: "node"`, `target: "node24"`, and a
  `#!/usr/bin/env node` banner.
- Keep `better-sqlite3` external because it contains a native binding.
- Add `pnpm bridge:build`.

Acceptance:

- Bundle builds.
- Output is a single `.mjs` entry with a node shebang and executable mode when
  installed.
- Bundle bytes do not contain token-shaped strings.
- Test pins the external list and the entry contract.

### A3. Add bridge install and uninstall

Files:

- `bin/install-bridge.mjs`
- `bin/uninstall-bridge.mjs`
- `bin/install-bridge.test.mjs`
- `package.json`

Change:

- `bridge:install` installs a runnable app layout under `~/.codex-im-bridge/`.
  The installer must not copy only `daemon.mjs`; it must install or reference
  runtime dependencies in a proven way.
- Preferred layout:

```text
~/.codex-im-bridge/
  app/
    daemon.mjs
    package.json
    node_modules/
    migrations/
  bin/
    load-and-run.sh
  data/
  logs/
```

- `app/daemon.mjs` mode `0755`.
- `bin/load-and-run.sh` mode `0755`.
- `app/migrations/` copied from `packages/storage-sqlite/src/migrations/`.
- `app`, `bin`, `data`, and `logs` created with mode `0700`.
- Refuse if `~/.codex-im-bridge/config.toml` is missing.
- Refuse symlink targets inside `~/.codex-im-bridge`.
- `--dry-run` emits a redacted plan and writes nothing.
- `bridge:uninstall` removes installed app/bin artifacts only. It must not
  delete `config.toml`, data, logs, backups, or Keychain entries.

Runtime dependency strategy:

- `better-sqlite3` remains external from the bundle.
- `bridge:install` must make `better-sqlite3` resolvable from the installed app
  without relying on the current repo cwd.
- Recommended first implementation: copy/prune production `node_modules` needed
  by the bundled entry into `~/.codex-im-bridge/app/node_modules`, then prove it
  with an installed-daemon preflight from a temp `HOME`.
- A dev-only wrapper that runs from the original repo root is not sufficient for
  this plan.

Acceptance:

- Install is idempotent.
- Missing config fails closed.
- Symlink guard works for install targets.
- File modes are pinned.
- Dry-run writes nothing and prints no secret-like material.
- Installed daemon preflight proves the artifact can reach config validation
  from a temp `HOME` without depending on the repo cwd.

### A4. Wire bridge into release readiness and CI

Files:

- `scripts/release-readiness-check.mts`
- `scripts/release-readiness-check.test.mts`
- `.github/workflows/ci.yml`
- `docs/ops/production-launch.md`

Change:

- Add `bridge-build`.
- Add `bridge-install-dry-run` using a temp `HOME`.
- Add `bridge-install` into the same temp `HOME`.
- Add installed daemon preflight through the installed wrapper/artifact.
- Add verified launchd dry-run after bridge install into the same temp `HOME`.
- Add redaction scan over plist, install output, wrapper output, and log output.
- Update CI non-live release gates to run the same chain.

Acceptance:

- `pnpm release:check` proves:

```text
bridge:build
-> bridge:install --dry-run in temp HOME
-> bridge:install in temp HOME
-> installed daemon preflight
-> launchd:install --dry-run against installed bridge
-> redaction scan
```

- CI proves the same non-live path on GitHub Actions.
- Production launch docs no longer imply launchd can work without bridge
  install.

### A5. Add repeatable smoke layers

Files:

- `packages/cli/src/smoke-daemon-roundtrip.ts`
- `packages/cli/test/smoke-daemon-roundtrip.test.ts`
- `packages/cli/src/smoke-telegram-live-roundtrip.ts`
- `packages/cli/test/smoke-telegram-live-roundtrip.test.ts`
- `package.json`
- `packages/cli/README.md`
- `docs/ops/production-launch.md`
- `docs/internal/ops-smoke/live-im-acceptance.md`

Change:

1. Add `pnpm smoke:daemon-roundtrip`.
   - Uses installed bridge artifact path.
   - Uses injected/fake inbound into the daemon path.
   - Proves config load, SQLite, project binding, thread start/resume,
     approval routing, callback resolution, final projection, and cleanup
     without requiring real Telegram inbound.
2. Rename current `smoke:telegram-real` to `smoke:telegram-side-by-side`, or keep
   a deprecated alias with truthful wording.
3. Add operator-gated `pnpm smoke:telegram-live-roundtrip`.
   - Env-gated by `TELEGRAM_LIVE=1`, `CODEX_REAL_SMOKE=1`,
     `IM_TELEGRAM_BOT_TOKEN`, and a target chat/user gate.
   - Requires a real operator/user message unless a separately reviewed
     Telegram user-client automation exists.
   - Script watches and records redacted evidence. It must not pretend the bot
     can self-generate real inbound.
4. Keep launchd Telegram soak as final direct-use acceptance, not default CI.

Acceptance:

- Default path skips live Telegram unless explicit live gates are set.
- `smoke:daemon-roundtrip` is repeatable and non-live.
- `smoke:telegram-live-roundtrip` produces redacted operator-gated evidence.
- No smoke output contains token-shaped or private identifier material.

### A6. Launchd Telegram soak

Files:

- `docs/internal/handoffs/YYYY-MM-DD-mac-mini-soak.md`
- `docs/internal/handoffs/live-im-acceptance-status.md`
- `docs/internal/handoffs/direct-use-live-status.md`
- Linear parent tracker

Change:

- Operator runs `bridge:build`, `bridge:install`, `launchd:install`.
- Verify `launchctl print "gui/$(id -u)/io.codex-im-bridge"`.
- Send a Telegram prompt at start, mid-soak, and after SIGTERM restart.
- Verify bindings persist, stale active turns are cleared, and the next inbound
  message routes to the intended Codex thread.
- Run redaction checks on plist and logs.

Acceptance:

- 24h daemon operation under launchd with redacted evidence.
- This can be started tonight, but completion requires wall-clock time and is
  not a blocker for starting implementation.

## 6. Track B: IM Control Plane

Track B starts only after Track A Block 1 is green.

### B0. Control-plane hard gates

The following commands must refuse when this IM target has either an active turn
or any pending approval:

- `/use`
- `/new`
- `/switch`
- `/fork`

Required tests:

- pending approval exists -> `/use` refused;
- pending approval exists -> `/new` refused;
- pending approval exists -> `/switch` refused;
- pending approval exists -> `/fork` refused;
- active turn exists -> `/use` refused;
- active turn exists -> `/new` refused;
- active turn exists -> `/switch` refused;
- active turn exists -> `/fork` refused.

Reason: an approval card belongs to a specific target/message/thread context.
Even with callback token and messageRef validation, the IM control plane should
not allow project/thread context changes while a decision is pending.

### B1. Complete existing command handlers

Current parser already recognizes:

- `/help`
- `/projects`
- `/new`
- `/use`
- `/status`
- `/stop`

Daemon currently handles only `/use` and `/stop`. Implement the remaining basic
handlers first, after adding the active-turn/pending-approval guard where
applicable.

#### `/help`

Shows only commands supported by the running daemon:

```text
/projects
/use <project>
/status
/new [title]
/threads [project]
/switch <thread>
/alias <title>
/stop
```

`/fork` appears only after it is implemented. No secrets, private IDs, or full
local paths are shown unless explicitly already visible to an authorized admin
command.

#### `/projects`

List configured projects the sender/target is allowed to access.

Data source:

- `config.projects`
- `SecurityPolicy.checkProjectAccess(projectId, target, sender)`

Output:

- project id;
- current marker for the bound project;
- optional default model;
- never show writable roots;
- omit cwd if admin status is unavailable or ambiguous.

#### `/status`

Shows the current IM target's Codex state:

- bound/unbound;
- current project id;
- current Codex thread id shortened;
- current thread title or local alias if present;
- active turn id shortened if present;
- pending approval count or blocked-control-plane indicator if available;
- adapter platform and target kind in redacted form;
- launch mode if the daemon can infer it later.

No token, private user id, full chat id, or raw local secret path.

#### `/new [title]`

Create a new Codex thread for the currently bound project.

Protocol mapping:

- Codex App Server `thread/start` through `CodexRuntime.threadStart(...)`.

Rules:

- Requires current `/use <project>` binding.
- Refuse if an active turn or pending approval exists.
- Call `runtime.threadStart({ cwd, model? })`.
- Persist the new Codex thread as a known thread for this IM target.
- Make it the current thread via `SessionRouter.bindThread`.
- Optional title is local display metadata only. It must not replace the Codex
  thread id as identity.

### B2. Add multi-thread persistence

Current `thread_bindings` stores one current binding per IM target. Keep it as
the current pointer. Add a new storage concept for known real Codex App threads
for an IM target.

Suggested table name:

```sql
CREATE TABLE thread_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  target_platform TEXT NOT NULL,
  target_chat_id TEXT NOT NULL,
  target_thread_key TEXT,
  target_topic_id TEXT,
  project_id TEXT NOT NULL,
  codex_thread_id TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
```

Constraints:

- unique target + `codex_thread_id`;
- index target + project + last used;
- `status` starts as `open`.

Important: this is not an IM-only task model. Each row represents a real Codex
App `thread`. `thread_bindings` remains the current project/thread pointer.

### B3. Thread management commands

#### `/threads [project]`

List known Codex threads for this IM target.

Output:

- short stable local selector, e.g. `1`, `2`, or `t_ab12`;
- current marker;
- project id;
- local alias/title if available;
- shortened Codex thread id;
- last used timestamp.

#### `/switch <thread>`

Switch current IM target to an existing known Codex thread.

Protocol mapping:

- Codex App Server `thread/resume({ threadId, cwd, model?, excludeTurns: true })`
  through `CodexRuntime.threadResume(...)`.

Rules:

- Verify selected thread belongs to the same IM target and an allowed project.
- Refuse if an active turn or pending approval exists.
- Call `thread/resume` before mutating binding state.
- If resume fails because the thread cannot be loaded, fail closed and keep the
  existing binding unchanged.
- If resume succeeds, update `thread_bindings.codex_thread_id` and
  `thread_sessions.last_used_at` in one transaction.
- Do not switch project implicitly unless the selected thread belongs to that
  project and policy still allows the target.

#### `/alias <title>`

Rename the current known thread for IM display only.

Rules:

- Does not mutate Codex App Server.
- Title is metadata for IM list ergonomics.
- Redact/control characters and keep length bounded.
- If the command is named `/rename` instead, every help/status/output string
  must say it only changes local IM display metadata.

#### `/fork [thread] [title]`

Deferred until `/new`, `/threads`, and `/switch` are stable.

Protocol mapping when implemented:

- `thread/fork({ threadId, cwd, model?, excludeTurns: true })` through
  `CodexRuntime.threadFork(...)`.

Rules when implemented:

- If omitted, fork current thread.
- Refuse if an active turn or pending approval exists.
- Persist forked Codex thread as a known thread and switch to it only after
  `thread/fork` succeeds.

### B4. Commands intentionally deferred

Do not implement `/close` unless GPT Pro confirms a Codex App Server close
method exists or the team accepts a clearly local-only "hide" semantics.

Reason:

- A local `/close` that only hides a row would not close the Codex App thread.
- That would break the rule that IM concepts should stay aligned with Codex App
  concepts.

## 7. Track C: Lark and DingTalk Live Acceptance

After Track A makes the production path truthful:

- run Lark live dry-run and live send with redacted evidence;
- run DingTalk live dry-run and bounded Stream smoke with redacted evidence;
- update `docs/internal/handoffs/live-im-acceptance-status.md`;
- update Linear parent tracker.

This work is credential-gated, not architecture-gated.

## 8. Implementation Order

### Block 0. Planning/source-of-truth

1. Create Linear parent/milestone:
   `Direct Use Completion / Phase 8 - Production usability hardening`.
2. Add `docs/internal/handoffs/direct-use-live-status.md`.
3. Apply GPT Pro P0 plan edits.
4. Commit docs-only plan v2.

### Block 1. Truthful production launch chain

1. `fix(launchd): verify runtime paths during dry-run`
2. `feat(bridge): build daemon bundle`
3. `feat(bridge): install runtime app artifacts and dependencies`
4. `test(bridge): prove installed daemon preflight from temp HOME`
5. `test(release): prove bridge install -> launchd dry-run chain`
6. `docs(ops): update production launch docs to remove false-green wording`

Block 1 must complete before command expansion.

### Block 2. IM command control plane

1. `feat(daemon): implement /help, /projects, /status`
2. `feat(storage): add thread_sessions migration and repository`
3. `feat(daemon): implement /new with durable thread session persistence`
4. `feat(daemon): implement /threads`
5. `feat(daemon): implement /switch with thread/resume-before-bind`
6. `feat(daemon): implement /alias`
7. Optional later: `feat(daemon): implement /fork after /switch is stable`

### Block 3. Repeatable smoke

1. Rename existing `smoke:telegram-real` to `smoke:telegram-side-by-side` or
   clarify wording.
2. Add `smoke:daemon-roundtrip` using installed artifact path.
3. Add operator-gated `smoke:telegram-live-roundtrip`.
4. Update live IM acceptance docs with redacted evidence format.

### Block 4. Real production acceptance

1. Run `bridge:build`.
2. Run `bridge:install`.
3. Run `launchd:install`.
4. Run operator Telegram prompt at start.
5. Run restart/SIGTERM check.
6. Begin 24h soak.
7. Update handoff and Linear with evidence.

Lark/DingTalk live acceptance should be after this, not before.

## 9. GPT Pro Review Summary

GPT Pro returned `APPROVE_WITH_CHANGES`.

P0 edits absorbed in this v2:

- This is a new Direct Use Completion / Phase 8 effort, not hidden Phase 7 tail
  work.
- `bridge:install` must install a runnable app artifact and proven runtime
  dependencies, especially `better-sqlite3`.
- `release:check` must prove build -> temp HOME install -> installed daemon
  preflight -> launchd dry-run -> redaction scan.
- Telegram smoke must be split into injected daemon round-trip,
  operator-gated live Telegram round-trip, and launchd soak.
- `/use`, `/new`, `/switch`, and `/fork` must refuse when active turn or pending
  approval exists.
- `/switch` must call `thread/resume` before mutating binding state.
- `thread_sessions` stores known real Codex threads; `thread_bindings` remains
  the current pointer.
- `/alias` is local-only metadata; `/fork` is deferred until basic thread
  commands are stable.

GPT Pro final implementation guidance:

```text
Implementation may begin after P0 plan edits.
Start with production launch chain, not IM thread commands.
```

## 10. Stop Conditions

Stop implementation and consult GPT Pro again if:

- a proposed command requires raw protocol method literals outside
  `packages/codex-runtime/src/runtime.ts`;
- switching threads can leave an approval card resolving against the wrong
  thread or target;
- any command can switch project/thread while an approval is pending;
- the installed daemon preflight fails for dependency resolution reasons;
- Telegram inbound automation is attempted without operator action or a
  separately reviewed user-client automation path;
- the bridge installer would need to write or print token material;
- `release:check` requires weakening a gate to stay green;
- live smoke output includes token-shaped or private identifier material.
