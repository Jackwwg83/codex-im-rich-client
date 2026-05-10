# Phase 4 Live Status

> Single source of truth for Phase 4. This file is now frozen at the Phase 4 tag gate.
> **Last updated:** 2026-05-02 — JAC-162 review/handoff/tag gate complete.
> **Handoff status:** Phase 4 is complete and ready to tag as `phase-4-lark-adapter-complete`. Continue with Phase 5 DingTalk planning.

---

## 1. Current phase / task

- **Phase:** Phase 4 — Feishu/Lark adapter.
- **Plan:** `docs/internal/superpowers/plans/2026-05-02-phase-4-lark-plan.md`.
- **Parent Linear issue:** JAC-9 — Phase 4 backlog / Feishu-Lark adapter.
- **Final Linear issue:** JAC-162 — Phase4-T12 review/handoff/tag.
- **Branch:** `codex/phase-4-planning`.
- **Base:** `phase-3-telegram-mvp-complete` (`83c6ef0` target commit).
- **Version:** `0.1.0-phase4`.
- **Next exact action:** tag Phase 4, mark Linear Phase 4 done, then start Phase 5 DingTalk plan review gate.

## 2. Completed decision state

- Phase 4 uses native `@larksuiteoapi/node-sdk`, not Vercel Chat SDK, Koishi/Satori, or a generic chat abstraction.
- Default connection mode is Lark/Feishu long connection (`WSClient`) so the Mac mini does not need a public webhook.
- Decision record: `docs/internal/phase-4/lark-action-transport-decision.md`.
- Target verification: `docs/internal/phase-4/lark-target-verification.md`.
- Selected action transport: newer `card.action.trigger` over long connection; legacy message-card callbacks rejected for Phase 4.
- Default target: `feishu`, enterprise custom app, long connection subscription, `card.action.trigger`.
- MessageRef source: `context.open_message_id` / `open_message_id` plus `context.open_chat_id` / `open_chat_id`; missing or ambiguous references fail closed.
- Live Lark smoke is documented and env-gated in `docs/internal/ops-smoke/lark-live-smoke.md`; default run skips with no network or credentials.

## 3. Active redlines carried forward

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
| Phase 4 final implementation review | REJECT at `f51c7c6`; 2 P1 + 2 P2 recorded in `docs/internal/phase-4/impl-final-codex-review.md` |
| Phase 4 final review fixes | `50a90c4` closed the 2 P1 blockers and prior P2s |
| Phase 4 final re-review | GO_WITH_LOW_NITS; no P0/P1, tag allowed; report in `docs/internal/phase-4/impl-final-codex-rereview.md` |
| Re-review low-nit closure | `c289a7a` fixed production `answerAction` ack strategy and malformed action primitive fail-closed coverage |

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
| JAC-161 | T11 env-gated live Lark smoke | done; not default CI |
| JAC-162 | T12 review/handoff/tag | done after tag-gate commit |

## 6. Gate status

Latest Phase 4 tag-gate verification:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green: 13 of 14 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 113 files, 1078 passing, 1 skipped |
| `pnpm lint` | green: 256 files checked |
| `pnpm protocol:check` | green: 234 schema files canonical |
| `pnpm smoke:lark-fake` | green: 1 file, 1 passing |
| `pnpm smoke:lark-live` | green default skip: no network without `LARK_LIVE=1` |

Note: `protocol:check` regenerates protocol files during verification, so do not run it concurrently with `typecheck`.

## 7. Compact / resume

If resuming after Phase 4:

1. Treat this file as frozen Phase 4 closeout evidence.
2. Read `docs/internal/handoffs/2026-05-02-phase4-to-phase5.md`.
3. Read the Phase 5 DingTalk plan once created.
4. Run `git status --short` and `git log --oneline -8`.
5. Continue from Phase 5 planning/Linear issue queue; do not reopen Phase 4 unless a regression appears.
