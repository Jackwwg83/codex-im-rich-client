# Phase 5 -> Phase 6 Handoff

Generated: 2026-05-02

## 1. Closeout

- **Closed phase:** Phase 5 - DingTalk adapter.
- **Plan:** `docs/superpowers/plans/2026-05-02-phase-5-dingtalk-plan.md`.
- **Base tag:** `phase-4-lark-adapter-complete`.
- **Release tag:** `phase-5-dingtalk-adapter-complete`.
- **Version:** `0.1.0-phase5`.
- **Branch:** `codex/phase-5-dingtalk`.
- **Linear parent:** JAC-10.
- **Final Linear issue:** JAC-90.

## 2. What shipped

- New `@codex-im/im-dingtalk` package with native `dingtalk-stream@^2.1.5` integration surface.
- DingTalk Stream lifecycle with no public webhook by default.
- Production `DWClient` wrapper via `createDingTalkStreamClient()`.
- Adapter-level Stream callback ack using `EventAck.SUCCESS` as platform receipt only.
- Robot message receive normalization for private/group fixtures.
- Approval card send/update, callback codec, action mapping, action ack, and fake round-trip surfaces.
- Strict callback payload codec: only exact opaque `v1:<token>` strings are accepted.
- Action mapping requires original DingTalk card/message references and fails closed on missing or ambiguous references.
- Duplicate robot delivery suppression; card replay remains enforced by daemon callback-token CAS and messageRef validation.
- Redacted adapter `raw` fields for platform ids.
- Adapter contract suite, boundary tests, fake daemon smoke, and env-gated live smoke harness.
- Live smoke docs: `docs/ops/dingtalk-live-smoke.md`.

## 3. Review / fixes

- Phase 5 plan v1 returned APPROVE_WITH_CHANGES; fixes were absorbed into the plan, live status, and target verification.
- Phase 5 plan v1.1 returned GO.
- Final implementation review returned APPROVE_WITH_CHANGES at `9b3f395`.
- `4a308d2` closed the 2 P1 blockers and 2 P2 findings:
  - production `DWClient` wrapper and adapter-level Stream ack;
  - duplicate robot delivery suppression;
  - implemented target/messageRef evidence;
  - redacted platform ids from adapter `raw`.
- Final re-review returned GO with no P0/P1/P2 findings; report: `docs/phase-5/impl-final-codex-rereview.md`.

## 4. Gates

At Phase 5 tag gate:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green: 14 of 15 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 126 files, 1186 passing, 1 skipped |
| `pnpm lint` | green: 288 files checked |
| `pnpm protocol:check` | green: 234 schema files canonical |
| `pnpm smoke:dingtalk-fake` | green |
| `pnpm smoke:dingtalk-live` | green default skip; requires `DINGTALK_LIVE=1` for real network |

`protocol:check` must run serially because it regenerates protocol files before diffing.

## 5. Carry-forward redlines

- No OpenClaw plugin.
- No Codex CLI/TUI output parsing as product protocol.
- No generic chat abstraction replacing Codex App Server rich semantics.
- No public App Server listener.
- No public IM webhook by default.
- No approval bypass.
- No Computer Use production flow before Phase 6 plan approval.
- IM adapters call only the `ChannelAdapter` boundary; they do not call broker/runtime/client/storage/daemon directly.
- Callback data remains opaque token only; raw callback tokens are not persisted or logged.
- `messageRef` validation remains required before `ApprovalBroker.resolve()`.
- Unknown, unauthorized, malformed, stale, expired, replayed, transport-lost, or security-uncertain paths fail closed.

## 6. Next Phase

Phase 6 should start with a Computer Use plan review gate before any implementation.

Recommended first task:

1. Open or create the Phase 6 Linear parent for Computer Use.
2. Create a Phase 6 plan under `docs/superpowers/plans/`.
3. Define the explicit `/cu` trigger, ComputerUsePolicy schema, allow/deny app rules, sensitive-step approval model, audit events, and operator-gated live/manual smoke.
4. Split Phase 6 into small Linear children: plan gate, parser-only slice, policy schema, allow/deny config, prompt wrapper, normal-prompt-does-not-trigger test, sensitive-step approval, audit, fake/manual smoke docs, final review/handoff/tag.

Do not start Satori/Koishi, Vercel Chat SDK, web console, public listener, or live Computer Use actions from this handoff.
