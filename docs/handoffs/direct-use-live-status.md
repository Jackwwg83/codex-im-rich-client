# Direct Use Live Status

> Single source of truth for Direct Use Completion / Phase 8 production
> usability hardening.
> **Last updated:** 2026-05-06 - Block 4 real Telegram acceptance remains
> green. Launchd soak remains healthy at the latest heartbeat, and the latest
> built daemon artifact is now installed and running under launchd with
> `pendingApprovals=0`. Feishu/Lark direct-use acceptance now proves launchd
> daemon inbound
> routing, `/status`, `/use codex-im`, real Codex prompt/reply, and live card
> schema delivery, real `Allow once` / `Decline` / `Abort` /
> `Allow session` reuse callbacks, and Feishu CardKit terminal-card refresh.
> A fresh Feishu Web regression on 2026-05-05 returned an exact Codex reply
> after stale-thread recovery.
> DingTalk Stream, OpenAPI card send/update, installed readiness, real desktop
> inbound prompt/status, approval card delivery, and the explicit
> `DINGTALK_LIVE_CARD_CALLBACK=1` live callback probe are now green. The passing
> 2026-05-06 probe used the current DingTalk thread binding, delivered a fresh
> card in DingTalk Desktop, and a real `同意` click produced
> `rawCardCallbacks=1`, `normalizedCardActions=1`, `cardEvents=1`,
> `callbackMessageRef=present`, and `callbackAction=present` with redacted
> output only. The fix accepts DingTalk's real private callback shape
> (`cardPrivateData.params.action`, `spaceType=IM`, `userId`) while keeping
> callback-token/messageRef validation fail-closed. DingTalk text refs still
> append via session reply rather than true in-place edit. JAC-237 added
> `pnpm im:doctor` / `pnpm channels:doctor` as the unified no-live-network
> readiness surface; callback_click is now informational, while DingTalk still
> reports `attention` for edit-vs-append semantics.

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
  - `deb0151` - daemon inbound message audit for allowed/denied/invalid/failure
    paths; no IM message body is persisted.
  - `be41071` - Feishu/Lark approval cards now render Card JSON 2.0
    `body.elements` with callback button behaviors carrying only opaque v1
    tokens.
  - latest patch - Feishu/Lark terminal approval-card refresh now uses CardKit
    `idConvert` + full-card `update`, with sanitized SDK error handling and a
    redacted `LARK_LIVE_CARD_UPDATE` smoke path.
  - latest patch - DingTalk production `daemon run` now wires a real OpenAPI
    card client when `card_template_id` is configured, derives robot code from
    client id unless `robot_code` overrides it, and private robot chats now use
    `senderStaffId` targets so card callbacks can satisfy target/messageRef
    validation.
  - latest patch - `smoke:dingtalk-live` now has an explicit
    `DINGTALK_LIVE_CARD=1` OpenAPI card send/update gate with redacted
    presence-only status, a no-network missing-env block, and AppKey-derived
    robot-code fallback when `DINGTALK_ROBOT_CODE` is omitted.
  - latest patch - DingTalk card live smoke can capture the target from one
    real inbound robot message via `DINGTALK_LIVE_CAPTURE_TARGET=1`, avoiding
    manual staff/group id scraping while keeping the captured id out of output.
  - latest patch - Read-only DingTalk developer-console check originally found
    `Card.Instance.Write` was not open; a redacted OpenAPI probe reached live
    access-token auth and failed at `createAndDeliver` with HTTP 403.
  - latest evidence - 2026-05-04 20:55 SGT: Feishu/Lark direct-use approval
    matrix now matches Telegram for the same acceptance language. Real Feishu
    Web clicks covered `Decline`, `Abort`, fresh `Allow once`, and
    `Allow session`; session reuse was verified by sending the exact same
    command twice and observing the output file grow from 13 to 26 bytes without
    a new Lark callback token. Terminal cards rendered `Status: resolved` with
    no remaining action buttons, and launchd stayed healthy with
    `pendingApprovals=0`.
  - latest evidence - 2026-05-04 20:55 SGT: DingTalk `Card.Instance.Write` was
    opened in the test app. A saved card-builder URL template id failed
    `createAndDeliver` with redacted `param.templateNotExist`; the subsequent
    personal `.schema` template was still `new` / not published for OpenAPI
    delivery and failed with redacted `param.empty`. `im.dingtalk.com` opened a
    maintenance page on this machine, so no real DingTalk inbound target could
    be captured without a working DingTalk client/session.
  - latest evidence - 2026-05-04 21:18 SGT: DingTalk OpenAPI card client now
    includes DingTalk `userIdType=1` for advanced interactive-card delivery and
    reports redacted DingTalk `code` fields on non-2xx OpenAPI failures.
    Targeted DingTalk package tests passed (12 files, 109 passing), `pnpm lint`
    passed, and launchd remained healthy with `pendingApprovals=0`.
    Redacted live card probes reached OpenAPI with app auth, target presence,
    and template presence: the org card-builder saved template id and an
    official preset `.schema` id returned `param.templateNotExist`, while the
    personal `.schema` template returned `param.empty`. Browser-side
    build/publish attempts showed the available personal templates remain
    unpublished / not OpenAPI-deliverable.
  - latest evidence - DingTalk Stream live smoke re-ran with live page
    credentials held only in process environment; Stream connected for 5
    seconds with redacted output and no inbound events.
  - latest evidence - 2026-05-04 21:30 SGT: DingTalk IM_ROBOT OpenAPI card
    delivery now sends top-level `userId` from the same private target used in
    `dtv1.card//IM_ROBOT.<id>` while preserving group delivery. Targeted tests
    passed (1 file, 6 passing). A redacted personal-template live probe still
    returned `param.empty`, keeping the remaining gap at DingTalk template /
    target lifecycle rather than a missing local request field.
  - latest patch - DingTalk OpenAPI card send now fails closed on
    `success=false` and failed `deliverResults[]` entries instead of treating
    HTTP 200 as sufficient delivery evidence. Targeted tests passed (1 file, 8
    passing).
  - latest evidence - DingTalk app-bound card template management advanced but
    did not clear direct-use acceptance. The card platform accepted creation of
    an app-bound template for the test robot app, but follow-up save/build still
    returned redacted platform validation errors and the template remained `new`
    without `templateSchema`. A redacted live OpenAPI probe using the robot
    page's template field still returned `param.templateNotExist`.
  - latest evidence - DingTalk OpenAPI card send/update gate is green with
    `DINGTALK_LIVE_DISCOVER_USER=1`. The smoke used the test app to discover one
    enterprise `userid` through contact APIs without printing it, then completed
    create/update and printed redacted `card_updated` evidence. This proves the
    OpenAPI card path, but not real installed inbound routing or card callback
    clicks.
  - latest evidence - 2026-05-05 16:02 SGT: DingTalk desktop direct-use inbound
    is now green under launchd. A real DingTalk prompt returned exactly
    `DINGTALK-FRESH-1557`, and a real `/status` command returned `target:
    dingtalk chat`, `binding: bound`, `project: codex-im`, and `pending
    approvals: 0`. A real write-command prompt rendered an approval card and
    SQLite bound four callback tokens to the DingTalk card `messageRef`.
    Automated macOS/Computer Use clicks on the visible `同意` button did not
    produce a Stream card callback; the adapter was patched to accept the
    official public-template callback shape where `cardPrivateData.params.action`
    carries `accept` / `reject`, and daemon fallback lookup is now scoped by
    `messageRef + action`. The adapter now also accepts exact
    `cardPrivateData.params.token = "v1:<opaque>"` callbacks and rejects token
    callbacks that carry companion approval/action metadata. Remaining DingTalk
    acceptance gap: one real user/client CardKit click reaching
    `/v1.0/card/instances/callback`.
  - latest evidence - Installed DingTalk direct-use configuration is now present
    and locally ready. The installed config enables DingTalk, points at a
    present client id / Keychain secret / card template id, and includes
    DingTalk global + project allowlist entries without printing their values.
    After `bridge:build`, `bridge:install`, and `launchctl kickstart -k`, the
    daemon restarted under launchd with `pendingApprovals=0`; installed bridge
    redaction scan passed.
  - latest evidence - Installed bridge redaction scan passed for app bundle,
    wrapper, config, launchd plist rendering, and daemon logs; `launchd:status`
    remains green with `pendingApprovals=0`.
  - latest heartbeat - 2026-05-04 22:31 SGT: `git status --short` was clean at
    `13f9fdd`; `pnpm launchd:status` reported pid `3294`, startedAt
    `2026-05-04T13:57:43.488Z`, `codexThreads=0`, and `pendingApprovals=0`.
    `launchctl print` reported `state = running`; daemon stdout path is
    `daemon.log`, with latest pid `3294` startup showing redacted Telegram,
    Lark, and DingTalk secret resolution, DingTalk Stream `connect success`,
    and `codex-im daemon started`. Stderr contained only Node deprecation
    warnings. `pnpm dingtalk:readiness` remained ready.
  - latest heartbeat - 2026-05-04 23:05 SGT: `git status --short` was clean at
    `55060c3`; `pnpm launchd:status` still reported pid `3294`, startedAt
    `2026-05-04T13:57:43.488Z`, `codexThreads=0`, and `pendingApprovals=0`.
    `launchctl print` still reported `state = running`; the latest current-pid
    stdout evidence remains redacted secret resolution, DingTalk Stream
    `connect success`, and `codex-im daemon started`. Stderr still contained
    only Node deprecation warnings. `pnpm dingtalk:readiness` remained ready
    when run outside the sandboxed IPC restriction.
  - `720c586` - launchd heartbeat soak evidence recorded.
  - latest heartbeat - 2026-05-04 18:59 SGT: `git status --short` was clean,
    `pnpm launchd:status` reported pid `27377` with `pendingApprovals=0`, the
    daemon stdout tail had no new entries after pid `27377` startup, and stderr
    contained only Node deprecation warnings. Installed daemon hash
    `82c2641dc818` still differs from built daemon hash `0c3304e77d52`.
  - latest evidence - 2026-05-04 19:19 SGT: rebuilt and installed the latest
    bridge bundle, restarted launchd to pid `62312`, verified installed daemon
    hash `0c3304e77d52` matches `dist/codex-im-daemon.mjs`, ran installed
    bridge redaction scan, and re-ran `release:check -- --skip-full-gates`
    green.
  - latest patch - Added `pnpm dingtalk:readiness`, a local no-network,
    no-secret diagnostic that reads installed config plus env/Keychain presence
    and reports whether DingTalk direct-use can start.
  - latest evidence - 2026-05-04 19:28 SGT: browser-derived DingTalk AppKey
    plus Keychain-backed secret passed `DINGTALK_LIVE=1
    DINGTALK_LIVE_DRY_RUN=1 pnpm smoke:dingtalk-live` with redacted
    `ready_dry_run`, then passed a bounded 5-second Stream connection with
    `robotEvents=0` and `cardEvents=0`. `pnpm dingtalk:readiness` correctly
    reports blocked because local installed config still has DingTalk disabled,
    missing client id, missing card template, and no DingTalk allowlist entries.
  - latest heartbeat - 2026-05-04 20:09 SGT: `git status --short` was clean,
    `pnpm launchd:status` reported pid `62312` with `pendingApprovals=0`,
    installed daemon hash still matched `dist/codex-im-daemon.mjs`
    (`0c3304e77d52`), installed bridge redaction scan passed, stdout showed no
    new pid `62312` errors, and stderr contained only Node deprecation warnings.
  - latest heartbeat - 2026-05-05 16:40 SGT: `git status --short` was clean at
    `4feca87`; `pnpm launchd:status` reported pid `3567`, startedAt
    `2026-05-05T08:08:24.081Z`, `codexThreads=0`, and
    `pendingApprovals=0`. `daemon-status.json` had `lastFatal=null` and
    `supervisorFailureCount=0`. The latest stdout evidence shows redacted
    Telegram/Lark/DingTalk secret resolution, DingTalk Stream `connect
    success`, and `codex-im daemon started`; stderr still contains only Node
    deprecation warnings. SQLite audit since restart shows only startup
    revocation of old DingTalk callback tokens, with no new IM send performed
    during this heartbeat.
  - latest heartbeat - 2026-05-05 17:14 SGT: `git status --short` was clean at
    `e85f97e`; `pnpm launchd:status` still reported pid `3567`, startedAt
    `2026-05-05T08:08:24.081Z`, `codexThreads=0`, and
    `pendingApprovals=0`. `daemon-status.json` still had `lastFatal=null` and
    `supervisorFailureCount=0`. `pnpm dingtalk:readiness` remained `ready`
    with enabled adapter, present Keychain-backed client secret, present card
    template, and DingTalk allowlist entries; stdout/stderr tails showed no new
    regression after pid `3567` startup, and SQLite audit had no events after
    the restart timestamp.
  - latest heartbeat - 2026-05-05 17:45 SGT: `git status --short` was clean at
    `367ecef`; `pnpm launchd:status` still reported the same pid `3567` and
    `pendingApprovals=0`. `daemon-status.json` still had `lastFatal=null`,
    `supervisorFailureCount=0`, and no active Codex threads. `pnpm
    dingtalk:readiness` remained `ready`; stdout/stderr tails showed no new
    regression beyond the existing startup logs and Node deprecation warnings,
    and SQLite audit still had no events after the pid `3567` restart
    timestamp.
  - latest heartbeat - 2026-05-05 18:17 SGT: `git status --short` was clean at
    `a1dc65e`; `pnpm launchd:status` still reported pid `3567`, startedAt
    `2026-05-05T08:08:24.081Z`, `codexThreads=0`, and
    `pendingApprovals=0`. `daemon-status.json` still had `lastFatal=null`,
    `supervisorFailureCount=0`, and no active Codex threads. `pnpm
    dingtalk:readiness` remained `ready`; daemon stdout/stderr tails showed no
    new regression after pid `3567` startup, and SQLite audit still had no
    events after the restart timestamp.
  - latest evidence - 2026-05-05 19:05 SGT: A fresh real DingTalk write prompt
    under launchd rendered the approval card and bound four callback tokens to
    the DingTalk card `messageRef`; the target file remained absent after
    synthetic macOS/Computer Use clicks on `同意`, and SQLite audit recorded no
    card callback. A temporary local `callback_route_key = "codex_im"`
    experiment was rolled back because the current DingTalk app did not emit a
    new delivered card and left four `issued` / unbound tokens. The daemon now
    revokes both `issued` and `bound` callback tokens on startup before adapter
    input, so failed send/bind residue fails closed instead of surviving a
    restart until expiry. Targeted callback-token and daemon tests passed, then
    `pnpm test`, `pnpm lint`, `pnpm protocol:check`, and sequential `pnpm
    typecheck` passed. The patched bundle was rebuilt/installed, launchd
    restarted to pid `21702`, and the previously issued/unbound DingTalk tokens
    were observed as `revoked` with fresh startup-revocation audit rows.
  - latest heartbeat - 2026-05-05 21:00 SGT: `git status --short --branch`
    was clean at `4432414` and synced to
    `origin/codex/live-im-acceptance`. `pnpm launchd:status` reported pid
    `44722`, startedAt `2026-05-05T11:59:46.040Z`, `codexThreads=0`, and
    `pendingApprovals=0`; `pnpm dingtalk:readiness` remained `ready` with
    `approval_callback_roundtrip` explicitly marked info-only. The current-pid
    daemon stdout tail had only redacted secret resolution, DingTalk Stream
    `connect success`, and daemon startup; stderr had only Node/SDK
    deprecation warnings. SQLite showed no callback audit rows after the
    current pid startup and no `used` DingTalk callback token from a real
    click. DingTalk Desktop launched a process but exposed zero accessible
    windows and the screen remained empty; Chrome still had only the DingTalk
    card editor and the DingTalk Web maintenance page. No real DingTalk client
    click path was available, so JAC-225 stays open.
  - latest evidence - 2026-05-06 21:50 SGT: DingTalk real CardKit callback
    acceptance passed. The first callback-gate rerun used a stale configured
    target and produced no visible new card; the passing rerun used the current
    DingTalk `thread_bindings` target, delivered a fresh card in DingTalk
    Desktop, and a real `同意` click produced redacted `card_callback_seen`
    evidence: `rawCardCallbacks=1`, `normalizedCardActions=1`, `cardEvents=1`,
    `callbackMessageRef=present`, and `callbackAction=present`. The rebuilt
    bridge was restored under launchd afterward, with `pendingApprovals=0`, and
    `pnpm dingtalk:readiness` remained ready.
- **Next exact action:** Keep DingTalk on launchd soak, then close the
  remaining direct-use parity gap: true in-place text edit or an explicitly
  accepted append/progress projection for long DingTalk turns.

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
| Block 3 | repeatable smoke layers | complete through C4 plus real Telegram Web and Feishu Web direct-use acceptance evidence |
| Block 4 | real production acceptance + 24h soak | in progress: latest bridge daemon is installed and running under launchd; Telegram and Feishu/Lark direct-use are green; DingTalk installed readiness, OpenAPI card send/update, real inbound prompt/status, approval-card delivery, and real CardKit callback click are green; remaining DingTalk parity gap is append-style text refs vs true in-place edit |

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
| 2026-05-04 18:59 SGT | Heartbeat check on branch `codex/live-im-acceptance` at `5f9895d`: `git status --short` clean; `pnpm launchd:status` green with pid `27377`, startedAt `2026-05-04T09:20:47.698Z`, `codexThreads=0`, `pendingApprovals=0`; daemon stdout had no new entries after pid `27377` startup and stderr contained only Node deprecation warnings. Installed daemon hash `82c2641dc818` still differs from built `dist/codex-im-daemon.mjs` hash `0c3304e77d52`, so latest bundle install/restart remains the next local non-external readiness gap. |
| 2026-05-04 19:19 SGT | Rebuilt, installed, and `launchctl kickstart -k` restarted the latest bridge bundle. `pnpm launchd:status` is green with pid `62312`, startedAt `2026-05-04T11:19:27.726Z`, `codexThreads=0`, `pendingApprovals=0`; installed daemon hash matches `dist/codex-im-daemon.mjs` (`0c3304e77d52`). Installed bridge redaction scan passed, daemon stdout shows redacted secret-resolution plus startup only for pid `62312`, stderr has Node deprecation warnings only, and `pnpm release:check -- --skip-full-gates` passed. |
| 2026-05-04 20:09 SGT | Heartbeat check on branch `codex/live-im-acceptance` at `f48eaad`: `git status --short` clean; `pnpm launchd:status` green with pid `62312`, startedAt `2026-05-04T11:19:27.726Z`, `codexThreads=0`, `pendingApprovals=0`; installed daemon hash still matches `dist/codex-im-daemon.mjs` (`0c3304e77d52`); installed bridge redaction scan passed. Daemon stdout had no new errors for pid `62312`; stderr contained only Node deprecation warnings. |

Latest DingTalk direct-use readiness evidence:

| Check | Result |
|---|---|
| `DINGTALK_LIVE=1 DINGTALK_LIVE_DRY_RUN=1 pnpm smoke:dingtalk-live` | green with browser-derived AppKey and Keychain-backed secret; output was redacted and reported `ready_dry_run` |
| `DINGTALK_LIVE=1 pnpm smoke:dingtalk-live` | green bounded 5-second Stream connection; `robotEvents=0`, `cardEvents=0`, no secret bytes printed |
| `DINGTALK_LIVE=1 DINGTALK_LIVE_CARD=1 DINGTALK_LIVE_DISCOVER_USER=1 pnpm smoke:dingtalk-live` | green redacted `card_updated`; target source was contact-discovered and no user/chat id was printed. Re-run on 2026-05-05 remained green after published-template parameter alignment |
| `DINGTALK_LIVE=1 DINGTALK_LIVE_CARD=1 DINGTALK_LIVE_CARD_CALLBACK=1 pnpm smoke:dingtalk-live` | green on 2026-05-06 with a real DingTalk Desktop click against the current thread binding target: redacted `card_callback_seen`, `rawCardCallbacks=1`, `normalizedCardActions=1`, `cardEvents=1`, `callbackMessageRef=present`, and `callbackAction=present`; no secret/user/chat/message id bytes printed |
| DingTalk developer-console / OpenAPI card check | `Card.Instance.Write` is open; live OpenAPI card probe with contact-discovered enterprise `userid` now reaches redacted `card_updated`; app-bound template creation succeeds, but save/build/publish is still rejected by the card platform, so installed direct-use should keep using explicit configured template evidence until a project-owned template is published |
| `pnpm dingtalk:readiness` | ready for installed config: adapter enabled, client id present, Keychain secret present, card template id present, and DingTalk global/project allowlist entries present; output now explicitly reports `approval_callback_roundtrip` as info-only and not checked without the live callback gate |
| 2026-05-04 20:09 SGT local readiness check | still expected blocked with the same local config gaps; no additional launchd/local regression was found |
| 2026-05-04 21:58 SGT installed readiness check | ready after redacted config update; latest bundle installed and launchd restarted to pid `3294` with `pendingApprovals=0`; installed bridge redaction scan passed |
| 2026-05-04 22:31 SGT heartbeat check | launchd still green for pid `3294` with `pendingApprovals=0`; `launchctl print` still reports `state = running`; `pnpm dingtalk:readiness` remains ready; latest daemon stdout has redacted startup plus DingTalk Stream `connect success`, and stderr has only Node deprecation warnings |
| 2026-05-04 23:05 SGT heartbeat check | launchd still green for pid `3294` with `pendingApprovals=0`; `launchctl print` still reports `state = running`; `pnpm dingtalk:readiness` remains ready; no new current-pid daemon errors were found in stdout/stderr tails |
| 2026-05-05 12:15 SGT live gate check | `pnpm dingtalk:readiness` ready, launchd green with `pendingApprovals=0`, redacted OpenAPI card smoke returned `card_updated`, `pnpm smoke:dingtalk-fake` passed, and the DingTalk card parameter map now supplies the published template's content/status/action slot keys. Real desktop send/click remains blocked by macOS Accessibility permission; DingTalk Web redirects to maintenance |
| 2026-05-05 12:55 SGT heartbeat check | `git status --short` clean at `e8f70e8`; `pnpm launchd:status` green with pid `59693`, startedAt `2026-05-05T03:54:50.886Z`, `codexThreads=0`, and `pendingApprovals=0`; `launchctl print` reports `state = running`; current-pid stdout tail contains redacted Telegram/Lark/DingTalk secret resolution, DingTalk Stream `connect success`, and daemon startup only. Current-pid stderr contains only Node deprecation warnings. Next local non-external gap remains DingTalk desktop send/click automation behind macOS Accessibility permission |
| 2026-05-05 13:28 SGT heartbeat check | `git status --short` clean at `2204a17`; `pnpm launchd:status` green with the same pid `59693`, startedAt `2026-05-05T03:54:50.886Z`, `codexThreads=0`, and `pendingApprovals=0`; `launchctl print` still reports `state = running`, `runs = 16`, and pid `59693`; current-pid stdout remains redacted startup + DingTalk Stream `connect success` only, and current-pid stderr has only Node deprecation warnings. Next local non-external gap is unchanged: DingTalk real desktop send/click needs an Accessibility-unblocked path |
| 2026-05-05 14:00 SGT heartbeat check | `git status --short` clean at `9a6a29a`; `pnpm launchd:status` green with the same pid `59693`, startedAt `2026-05-05T03:54:50.886Z`, `codexThreads=0`, and `pendingApprovals=0`; `launchctl print` still reports `state = running`, `runs = 16`, and pid `59693`. `daemon.log` and `daemon.err.log` mtimes remain at the current-pid startup time, so no new daemon output appeared during this interval. `pnpm dingtalk:readiness` remains ready. Next local non-external gap remains DingTalk desktop send/click behind macOS Accessibility permission |
| 2026-05-05 19:05 SGT real callback follow-up | Fresh real DingTalk write prompt rendered the approval card and bound callback tokens, but synthetic clicks still produced no Stream callback and the target file stayed absent. A local `callback_route_key = "codex_im"` experiment was rolled back after it produced no delivered card and left `issued` / unbound tokens. Startup cleanup now revokes both `issued` and `bound` callback tokens before adapter input; targeted tests plus full gates passed, the patched bundle was installed, and launchd pid `21702` revoked the live residue on startup. |
| 2026-05-05 19:33 SGT explicit callback probe | New `DINGTALK_LIVE_CARD_CALLBACK=1` gate sent a real card, remained connected, and failed with `cardEvents=0`; GPT Pro review says do not modify broker/security/token/messageRef logic and keep DingTalk blocked until callback-capable template plus real client click emits Stream `/v1.0/card/instances/callback`. |
| 2026-05-05 20:00 SGT DingTalk text output fallback | Fixed DingTalk terminal text output: `sendText` now returns explicit `dingtalk-text:*` refs, and `editText` on those refs appends via DingTalk session reply instead of calling Card OpenAPI and failing with `param.cardNotExist`. This is append semantics, not true in-place text editing, so long streaming turns may produce multiple DingTalk chat messages while Telegram/Lark keep in-place edits. Targeted DingTalk/daemon tests passed, `pnpm typecheck` passed, and the rebuilt bridge bundle is installed under launchd pid `44722`; DingTalk Desktop is currently a background process with zero windows, so a fresh real client prompt/click remains blocked by client UI availability, not bridge startup. |
| 2026-05-06 19:05 SGT DingTalk callback follow-up | Found a production daemon crash source in the DingTalk SDK client-side WebSocket ping timer (`WebSocket.ping()` while `CONNECTING`) and changed `daemon run` to pass `keepAlive: false`, matching the live-smoke Stream path. Targeted CLI/DingTalk tests and package typechecks passed; the rebuilt bridge is installed and launchd is healthy under pid `34173`. A fresh explicit callback gate delivered a visible `codex` card-list item in DingTalk Desktop, but the conversation stayed in a loading state and the gate still ended redacted with `messageId=present`, `targetSource=env`, and `cardEvents=0`; SQLite callback-token `used` count did not increase. JAC-225 remains open on one real client click that emits the Stream card callback. |
| 2026-05-06 19:26 SGT unified IM doctor | JAC-237 added `pnpm im:doctor` with alias `pnpm channels:doctor`. Default output is no-live-network and redacted: installed bridge plist/status, per-platform secret-source presence via env/Keychain, allowlists, capabilities, adapter-start/live-gate status, inbound/outbound/card/callback status, edit-vs-append semantics, and file support. After the real callback pass, callback_click is informational; on the current machine the overall report remains `attention` because DingTalk text refs are append semantics rather than true in-place edit. |
| 2026-05-06 21:50 SGT DingTalk callback acceptance | Compared the local parser with DingTalk/OpenClaw callback behavior, then reran the explicit callback gate against the current DingTalk `thread_bindings` target. A fresh card appeared in DingTalk Desktop, a real `同意` click removed the buttons, and the gate exited 0 with redacted `card_callback_seen`: `rawCardCallbacks=1`, `normalizedCardActions=1`, `cardEvents=1`, `callbackMessageRef=present`, and `callbackAction=present`. The observed callback shape uses `content.cardPrivateData.params.action` and private `spaceType=IM` / `userId` fields; no secret/user/chat/message id bytes were recorded. Launchd was restored afterward and `pnpm dingtalk:readiness` remained ready. |

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
| Decline button | Fresh Telegram Web `Decline` for `/tmp/codex-im-live-decline-20260504-1207.txt` left the file absent, returned "The command was not run because the escalation request was rejected", emitted a `commandExecution declined` item, and resolved the card as `Decision recorded: decline` with `command_execution/high` | green |
| Abort button | Fresh Telegram Web `Abort` for `/tmp/codex-im-live-abort-20260504-1212.txt` left the file absent, returned `Codex turn interrupted`, emitted a `commandExecution declined` item, and resolved the card as `Decision recorded: abort` with `command_execution/high` | green |
| Allow-session button | Fresh Telegram Web `Allow session` for `/tmp/codex-im-live-allow-session-20260504-1223.txt` created the file, returned `Ran`, emitted a `commandExecution completed` item, and resolved the card as `Decision recorded: allow session` with `command_execution/high` | green |
| Callback sibling revocation | SQLite `callback_tokens` after the live matrix shows exactly one `used` token per approval (`approval-1` decline, `approval-2` abort, `approval-3` allow_session) and all sibling action tokens `revoked`; raw callback tokens are not persisted | green |
| UI driver availability | Computer Use / Chrome Accessibility timed out during this run, but macOS screenshots plus System Events clicks worked against real Telegram Web. Treat Computer Use timeout as a local UI automation issue, not daemon failure | workaround green |

Latest live Feishu/Lark direct-use evidence:

| Area | Evidence | Status |
|---|---|---|
| launchd multi-platform start | Installed bridge bundle started under launchd pid `13136`; daemon log resolved Telegram and Lark secrets with `***REDACTED***` values and Lark WS reached `ws client ready` | green |
| inbound observability | `deb0151` adds daemon audit for `inbound.message_allowed`, `inbound.message_denied`, `inbound.message_invalid`, and `inbound.message_handler_failed`; audit metadata records actor key, route kind, and text length only, never message body | green |
| Lark `/status` | Feishu Web sent `/status`; SQLite recorded `inbound.message_allowed` with `routeKind=command`; bot replied `Status: target: lark chat`, `binding: unbound`, `pending approvals: 0` | green |
| Lark `/use codex-im` | Feishu Web sent `/use codex-im`; SQLite `thread_bindings` gained a Lark row for `codex-im`; bot replied `Using project codex-im` | green |
| Lark prompt -> Codex | Feishu Web prompt `Reply exactly: LARK-CODEX-OK` created a real Codex thread and bot replied `LARK-CODEX-OK` | green |
| Lark regression after stale-thread recovery | Feishu Web prompt returned exactly `FEISHU-CODEX-REGRESSION-1207` after the daemon recovered from an old missing Codex thread by rebinding a fresh thread | green |
| Lark card schema + CardKit update | First real approval attempt exposed Feishu error `230099` / unknown root property `elements`; `be41071` moved card content under `body.elements`. The later callback fix sends Card JSON 2.0 button `behaviors` with only `{ token: "v1:..." }` and no approval id / action kind. CardKit `idConvert` + `update` is now covered by `LARK_LIVE=1 LARK_LIVE_CARD=1 LARK_LIVE_CARD_UPDATE=1 pnpm smoke:lark-live` with redacted message-id evidence | fixed/green |
| Lark approval callback | Fresh Feishu Web write approval was accepted as inbound prompt, rendered a real approval card, and a keyboard-driven click on `Allow once` reached the launchd daemon. SQLite recorded `allow_once=used` with sibling tokens `revoked`, the target `/tmp` file was created, and Codex replied `Ran ...` | fixed/green |
| Lark terminal approval card visual refresh | After bridge rebuild/install and launchd restart, a fresh Feishu Web write approval resolved through `Allow once`; the target `/tmp` file existed, latest SQLite callback tokens showed `allow_once=used` with siblings `revoked`, `pnpm launchd:status` reported `pendingApprovals=0`, and a Feishu Web reload preserved `Status: resolved` with zero visible `Allow once` buttons | fixed/green |
| DingTalk production card client | `createDingTalkOpenApiCardClient` now obtains an OpenAPI token, calls card `createAndDeliver`, updates by `outTrackId`, maps group/private targets to `IM_GROUP` / `IM_ROBOT` spaces, includes top-level IM_ROBOT `userId`, and fails closed on HTTP/code/success=false/deliverResults failures with sanitized diagnostics; production `daemon run` injects it when `card_template_id` is configured and derives robot code from client id unless `robot_code` overrides it | fixed/green locally |

Latest Lark hardening gates:

| Gate | Result |
|---|---|
| `pnpm exec vitest run packages/daemon/test/daemon.test.ts` | green: 111 passing |
| `pnpm exec vitest run packages/im-lark/test` | green: 13 files, 113 passing |
| `LARK_LIVE=1 LARK_LIVE_CARD=1 LARK_LIVE_CARD_UPDATE=1 pnpm smoke:lark-live` | green: redacted live card schema + CardKit update smoke sent |
| `pnpm typecheck` | green |
| `pnpm lint` | green: 332 files checked |
| `pnpm test` | green: 148 files, 1355 passing, 1 skipped |
| `pnpm protocol:check` | green |
| `pnpm release:check -- --skip-full-gates` | green: bridge build/install, launchd dry-run, redaction scan, daemon roundtrip, fake smokes, and default live gates/skips passed |
| `pnpm bridge:build && pnpm bridge:install && launchctl kickstart -k gui/501/io.codex-im-bridge && pnpm launchd:status` | green with installed daemon running and `pendingApprovals=0` |

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

Latest live Telegram approval matrix:

| Case | Result |
|---|---|
| `Allow once` | green; `/tmp/codex-im-live-terminal-card-20260504-1200.txt` created; card resolved as `allow once`, `command_execution/high` |
| `Decline` | green; `/tmp/codex-im-live-decline-20260504-1207.txt` absent; card resolved as `decline`, `command_execution/high` |
| `Abort` | green; `/tmp/codex-im-live-abort-20260504-1212.txt` absent; card resolved as `abort`, `command_execution/high` |
| `Allow session` | green; `/tmp/codex-im-live-allow-session-20260504-1223.txt` created; card resolved as `allow session`, `command_execution/high` |
| stale/revoked click | green; pre-restart stale click left `/tmp/codex-im-live-allow-once-20260504-1100.txt` absent and recorded `approval.callback_not_bound` with `result=revoked` |
| callback token state | green; SQLite shows one `used` action token per approval and revoked siblings for the other actions |

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
10. Real Telegram Web approval button matrix for allow once, decline, abort,
    allow-session, and stale/revoked click behavior (done)
11. Feishu/Lark direct-use inbound, `/status`, `/use`, prompt/reply, and card
    schema live acceptance (done)
12. Lark full approval callback live acceptance (done for `Allow once`,
    `Decline`, `Abort`, `Allow session` reuse, and terminal CardKit refresh).
13. DingTalk real inbound direct-use acceptance is green for prompt/reply and
    `/status`; approval card delivery is green through token binding. Next:
    one real DingTalk CardKit callback click from a client path that produces a
    Stream `/v1.0/card/instances/callback` event; synthetic macOS/Computer Use
    clicks did not trigger the current desktop client.

## 8. Compact / Resume

If resuming this work:

1. Read this file first.
2. Read `docs/superpowers/plans/2026-05-03-direct-use-completion-plan.md`.
3. Read `AGENTS.md`.
4. Run `git status --short` and `git log --oneline -8`.
5. Continue from the current block only when branch/HEAD/scope are clear.
