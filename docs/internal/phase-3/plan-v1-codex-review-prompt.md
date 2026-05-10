# Codex outside-voice review — Phase 3 plan v1

You are the outside-voice reviewer for the Phase 3 plan v1.

## Project context

**Codex App Server IM Rich Client** — a Mac mini daemon that lets users
control codex via IM (Telegram first), preserving thread/turn/item,
streaming, approvals, diffs, review, Computer Use as structured rich
events (NOT compressed to plain chat).

Phase 1 tag: `phase-1-runtime-complete` (`23cbca7`) — Codex runtime
core (no IM): CodexRuntime + EventNormalizer + ApprovalBroker +
Supervisor.

Phase 2 tag: `phase-2-approval-im-surface-complete` (`4ec2c51`) +
`phase-2-codex-reviewed` (`0d4dfc3`) — approval public surface +
platform-agnostic rendering + fake e2e. New packages
`@codex-im/render` + `@codex-im/channel-core`. Codex backfill review
returned GO_WITH_LOW_NITS after applying P0+P1 fixes (see
`docs/internal/phase-2/codex-review-t18-t22.md` and
`docs/internal/phase-2/codex-review-t24-integrated.md`).

Codex 0.128 upgrade landed on `chore/codex-upgrade-0.128` (`d999af5`).
ServerRequest method names UNCHANGED 0.125 → 0.128 (broker untouched);
3 new ServerNotifications + 2 new ClientRequests added; 2
ThreadStartParams fields removed.

## Plan to review

`docs/internal/superpowers/plans/2026-05-02-phase-3-plan.md` (1202 lines, v1)

Mission: Telegram MVP, end-to-end, production-shaped. Bundles five
slivers — production daemon wire-up, SecurityPolicy ACL, real
Telegram adapter (`@codex-im/im-telegram` via grammY), persistent
SessionRouter (SQLite), launchd integration.

## Also read for context (cite line numbers from working tree)

- `CLAUDE.md` — project-wide redlines
- `docs/internal/handoffs/2026-05-02-phase2-to-phase3.md` — Phase 2 → 3 handoff
- `docs/internal/phase-2/codex-review-t18-t22.md` + `codex-review-t24-integrated.md`
- `01-PRD.md`, `02-TECHNICAL-DECISIONS.md`, `03-ARCHITECTURE.md`,
  `04-MODULE-DESIGN.md`, `06-IM-ADAPTERS.md`,
  `07-SECURITY-AND-COMPUTER-USE.md`, `08-DATA-MODEL.md`, `09-ROADMAP.md`
- `packages/core/src/approval-broker.ts` — Phase 2 broker the plan
  builds on
- `packages/channel-core/src/{adapter.ts,fake.ts}` — closed
  ChannelAdapter interface + canonical reference adapter
- `packages/core/test/phase2-e2e-rig.ts` — the test rig the plan will
  productionize as `Daemon`

## Review goals (look hard for these)

### P0 (would block Phase 3 implementation start)

1. **Mission scope**: is bundling correct, or should one sliver come
   first (e.g. SecurityPolicy alone, or production daemon wire-up
   alone)? Does the plan over-scope vs Phase 4 (Lark) prep?
2. **Architecture redlines**:
   - Real IM adapter MUST NOT call `AppServerClient` directly.
   - ChannelAdapter MUST NOT see raw App Server JSON-RPC.
   - Approval decisions MUST go through `ApprovalBroker.resolve()`.
   - Method-literal boundary MUST hold across new packages.
   - No Codex CLI/TUI wrapper, no terminal-output parsing.
3. **Security must-haves** (Phase 3 redlines §6):
   - Telegram bot token only from env/config.
   - No tokens in logs, fixtures, audit, errors.
   - Callback action MUST bind {approvalId, target, message, actor, nonce}.
   - Wrong actor / stale callback / duplicate decision / expired /
     transport-lost all fail closed.
   - No public TCP/UDP listener on the daemon.
   - No Computer Use production flow.
4. **D29 init order** (§7): is "broker.attach BEFORE supervisor receives
   broker" load-bearing in EVERY code path including SIGHUP reload and
   error-path teardown?
5. **D30 callback_data encoding** (§7): does `${approvalId}|${kind}|${nonce}`
   leave enough headroom under real Telegram's 64B limit for ANY
   plausible approvalId distribution? Phase 2 e2e showed 6-digit
   numeric ids fit at 62B; what about UUIDs, short-form turn-id-prefix
   schemes, or auth-refresh ids that codex generates server-side?
6. **§10 attack table T-Sec-1..10**: is anything missing?
   - Replay across daemon restart (token survives, nonce survives, but
     broker `#pendingById` was reset → broker says unknown_approval_id
     → user sees decline-only synth).
   - Race between expire sweep and inbound action.
   - Race between actor binding and inbound action ("click before
     bind") — T24 P1 already flagged this in the test rig; does the
     plan's D29 productionize it correctly?
   - Renderer-defensive C-P1 path: unknown method snapshot reaches the
     daemon → must render decline-only critical card (defense in depth
     on top of broker's `-32601` reject).

### P1 (composition issues per-sliver review might miss)

- §11 P3.T8 transport-lost test must exercise the daemon-wire-up path,
  not just the broker.
- §11 P3.T19 SIGTERM teardown order: any pending broker entry left
  unsettled? `failPendingAsTransportLost` should fire on intentional
  daemon stop, not just on transport close.
- §16 task TDD sizing: are T1–T40 small enough that each is one
  failing test + minimum impl?
- Storage choice (`better-sqlite3`): native build risk on Node 24 / Mac
  mini. Plan §A4 + R5 already note this; is mitigation strategy real?
- `grammY` API surprises (R4): are the contract tests in §16 T28
  enough to surface real-Telegram divergence?
- Phase 2 backfill review's deferred P1s correctly recorded as
  Phase 3 D29/D30 informants (NOT regressions in Phase 2 production
  code)?

### P2 (style, doc cross-refs, smoke gating defaults)

## Out of scope

- Phase 2 broker / render / channel-core source code (already reviewed
  and GO; only the plan's USE of them is in scope).
- Phase 4+ work (Lark / DingTalk / CU / Web Console).
- The Phase 2 review-nits + codex-upgrade commits — those are already
  committed on separate branches and don't block Phase 3 plan approval.

## Output format (strict)

```
VERDICT: APPROVE | APPROVE_WITH_CHANGES | REJECT
SUMMARY: <one sentence>

P0 (blocks Phase 3 implementation start):
  - [section / file:line] <issue> — <why P0> — <suggested fix>
  (or "none")

P1 (required changes before T1):
  - [section / file:line] <issue> — <why P1> — <suggested fix>
  (or "none")

P2 (nice-to-have):
  - [section / file:line] <issue> — <suggested fix>
  (or "none")

NOTES:
  - <anything notable about scope, risk, mission alignment, or
    composition with Phase 2 surface>
```

Read on disk; cite section + line numbers from the plan and from
referenced source files.
