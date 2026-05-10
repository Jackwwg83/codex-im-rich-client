# Phase 4 -> Phase 5 Handoff

Generated: 2026-05-02

## 1. Closeout

- **Closed phase:** Phase 4 — Feishu/Lark adapter.
- **Plan:** `docs/internal/superpowers/plans/2026-05-02-phase-4-lark-plan.md`.
- **Base tag:** `phase-3-telegram-mvp-complete`.
- **Release tag:** `phase-4-lark-adapter-complete`.
- **Version:** `0.1.0-phase4`.
- **Branch:** `codex/phase-4-planning`.
- **Linear parent:** JAC-9.
- **Final Linear issue:** JAC-162.

## 2. What shipped

- New `@codex-im/im-lark` package with native `@larksuiteoapi/node-sdk` integration surface.
- Lark/Feishu long-connection lifecycle using SDK `WSClient` / `EventDispatcher`, with no public webhook by default.
- Lark message receive normalization for private, group mention, and thread/root fixtures.
- Text send, reply, edit, approval card send, card update, action mapping, and action ack surfaces.
- Strict callback payload codec: only exact opaque `v1:<token>` strings are accepted.
- Action mapping requires original Lark message/chat references and fails closed on missing or ambiguous references.
- Adapter contract suite, boundary tests, fake daemon smoke, and env-gated live smoke harness.
- Live smoke docs: `docs/internal/ops-smoke/lark-live-smoke.md`.

## 3. Review / fixes

- Final implementation review initially rejected at `f51c7c6`.
- `50a90c4` closed the 2 P1 blockers and original P2 findings.
- Final re-review returned GO_WITH_LOW_NITS; report: `docs/internal/phase-4/impl-final-codex-rereview.md`.
- `c289a7a` closed the re-review P2 low nits before tag:
  - production SDK-created adapters now have explicit no-op action ack behavior;
  - malformed action primitives fail closed without throwing.

## 4. Gates

At Phase 4 tag gate:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green: 13 of 14 workspace projects |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 113 files, 1078 passing, 1 skipped |
| `pnpm lint` | green: 256 files checked |
| `pnpm protocol:check` | green: 234 schema files canonical |
| `pnpm smoke:lark-fake` | green |
| `pnpm smoke:lark-live` | green default skip; requires `LARK_LIVE=1` for real network |

`protocol:check` must run serially because it regenerates protocol files before diffing.

## 5. Carry-forward redlines

- No OpenClaw plugin.
- No Codex CLI/TUI output parsing as product protocol.
- No generic chat abstraction replacing Codex App Server rich semantics.
- No public App Server listener.
- No public Lark webhook by default.
- No approval bypass.
- No Computer Use production flow before Phase 6.
- IM adapters call only the `ChannelAdapter` boundary; they do not call broker/runtime/client/storage/daemon directly.
- Callback data remains opaque token only; raw callback tokens are not persisted or logged.
- `messageRef` validation remains required before `ApprovalBroker.resolve()`.
- Unknown, unauthorized, malformed, stale, expired, replayed, transport-lost, or security-uncertain paths fail closed.

## 6. Next Phase

Phase 5 should start with a DingTalk plan review gate before any implementation.

Recommended first task:

1. Open or create the Phase 5 Linear parent for DingTalk.
2. Create a Phase 5 plan under `docs/internal/superpowers/plans/`.
3. Review DingTalk Stream mode, card callbacks, messageRef availability, and live-smoke/operator-gate constraints before writing `packages/im-dingtalk`.
4. Split Phase 5 into small Linear children: plan gate, package skeleton, Stream lifecycle, receive fixtures, card send/update, callback mapping, messageRef validation, fake smoke, env-gated live smoke, final review/handoff/tag.

Do not start Computer Use, Satori/Koishi, Vercel Chat SDK, web console, or public listener work from this handoff.
