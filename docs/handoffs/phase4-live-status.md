# Phase 4 Live Status

> Single source of truth for Phase 4 planning/implementation. Read first on compact / resume / context loss after Phase 3 tag `phase-3-telegram-mvp-complete`.
> **Last updated:** 2026-05-02 — JAC-160 fake Lark smoke through daemon landed.
> **Handoff status:** Phase 3 is tagged and complete. Phase 4 implementation may proceed through the Linear queue; live Lark smoke remains env-gated.

---

## 1. Current phase / task

- **Phase:** Phase 4 — Feishu/Lark adapter.
- **Plan:** `docs/superpowers/plans/2026-05-02-phase-4-lark-plan.md`.
- **Active Linear issue:** JAC-161 — Phase4-T11 env-gated live Lark smoke.
- **Parent Linear issue:** JAC-9 — Phase 4 backlog / Feishu-Lark adapter.
- **Current branch:** `codex/phase-4-planning`.
- **Base:** `phase-3-telegram-mvp-complete` (`83c6ef0` target commit).
- **Next exact action:** implement JAC-161 with TDD: env-gated live Lark smoke harness that is skipped by default and never stores secrets.

## 2. Current decision state

- Phase 4 uses native `@larksuiteoapi/node-sdk`, not Vercel Chat SDK, Koishi/Satori, or a generic chat abstraction.
- Default connection mode is Lark/Feishu long connection (`WSClient`) so the Mac mini does not need a public webhook.
- Decision record: `docs/phase-4/lark-action-transport-decision.md`.
- Target verification: `docs/phase-4/lark-target-verification.md`.
- Current action-transport decision: use newer `card.action.trigger` over long connection; do not use legacy message-card callbacks; do not add public webhook by default.
- Default target: `feishu`, enterprise custom app, long connection subscription, `card.action.trigger`.
- MessageRef source: `context.open_message_id` / `open_message_id` plus `context.open_chat_id` / `open_chat_id`; missing or ambiguous references fail closed.

## 3. Active redlines

- No public Codex App Server listener.
- No public Lark webhook by default.
- No OpenClaw plugin path.
- No Codex CLI/TUI output parsing.
- No Computer Use production flow.
- `@codex-im/im-lark` may import `@codex-im/channel-core` only among Codex packages.
- Lark adapter must never call `ApprovalBroker`, `CodexRuntime`, `AppServerClient`, storage, daemon, or protocol directly.
- Lark action payload must carry only the Phase 3 opaque `wirePayload` (`v1:` + raw token); no raw approval id / actor / target / action tuple.
- Lark secrets (`app_secret`, verification token, encrypt key, tenant/access tokens) must not enter docs, fixtures, logs, SQLite, Linear, or plist.
- All malformed/stale/wrong-target/wrong-actor/expired/unauthorized action paths fail closed before `ApprovalBroker.resolve()`.

## 4. Review status

| Review | Status |
|---|---|
| Phase 4 plan v1 Codex review | v1 run aborted because it attempted network lookup and stalled; stderr left untracked |
| Phase 4 plan v1.1 Codex review | APPROVE_WITH_CHANGES, 0 P0 + 5 P1 + 3 P2 |
| Phase 4 plan v1.1 response | P1/P2 fixes absorbed in plan + decision record |
| Phase 4 plan v1.2 Codex review | GO_WITH_LOW_NITS, no P0/P1 blockers |
| GPT Pro review | browser automation unavailable in this environment so far; continue with Codex review + official docs, and consult with sanitized packet if new ambiguity appears |

## 5. Linear execution queue

| Issue | Scope | Status / gate |
|---|---|---|
| JAC-65 | T0 plan review gate | done |
| JAC-148 | T0a Lark `card.action.trigger` target verification | done |
| JAC-149 | T1 im-lark skeleton + boundary tests | done |
| JAC-150 | T2 Lark config schema extension | done |
| JAC-151 | T3 long connection lifecycle fake client | done |
| JAC-152 | T4 message receive fixtures | done |
| JAC-153 | T5 send/edit text/reply | done |
| JAC-154 | T6 sendCard/card rendering | done |
| JAC-155 | T7 updateCard/status streaming | done |
| JAC-156 | T8a callback payload codec/extraction | done |
| JAC-157 | T8b action to InboundAction mapping | done |
| JAC-158 | T8c ack/fail-closed behavior | done |
| JAC-159 | T9 adapter contract suite | done |
| JAC-160 | T10 fake Lark smoke | done |
| JAC-161 | T11 env-gated live Lark smoke | active next; not default CI |
| JAC-162 | T12 review/handoff/tag | blocked by JAC-160 |

## 6. Gate status

Latest Phase 4 implementation gates:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green: 13 of 14 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 111 files, 1061 passing, 1 skipped |
| `pnpm lint` | green: 252 files checked |
| `pnpm protocol:check` | green: 234 schema files canonical |

## 7. Compact / resume

If resuming Phase 4:

1. Read this file.
2. Read `docs/handoffs/2026-05-02-phase3-to-phase4.md`.
3. Read `docs/superpowers/plans/2026-05-02-phase-4-lark-plan.md`.
4. Read `docs/phase-4/lark-action-transport-decision.md`.
5. Fetch Linear JAC-65 and JAC-9.
6. Run `git status --short` and `git log --oneline -8`.
7. If JAC-65 is closed, continue the next Linear issue in dependency order without waiting for routine operator approval.
