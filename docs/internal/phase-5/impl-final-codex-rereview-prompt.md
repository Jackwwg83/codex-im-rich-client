# Phase 5 Final Re-review Prompt

You are an outside-voice reviewer for the Codex IM Rich Client repo.

Review scope:

- Base phase tag: `phase-4-lark-adapter-complete`
- Current HEAD: `4a308d2`
- Original final review report:
  `docs/internal/phase-5/impl-final-codex-review.md`
- Blocker fix commit: `4a308d2 fix(im-dingtalk): JAC-90 close final review blockers`

Source-of-truth docs:

- `AGENTS.md`
- `docs/internal/handoffs/phase5-live-status.md`
- `docs/internal/superpowers/plans/2026-05-02-phase-5-dingtalk-plan.md`
- `docs/internal/phase-5/dingtalk-target-verification.md`

Original review verdict:

- `APPROVE_WITH_CHANGES`
- P1-1: no production DingTalk Stream wrapper / no adapter-level Stream ack path.
- P1-2: duplicate DingTalk robot deliveries can duplicate Codex turns.
- P2-1: target/messageRef evidence doc stale.
- P2-2: adapter `raw` fields included real platform ids.

What changed in `4a308d2`:

- Added `createDingTalkStreamClient()` wrapping real `dingtalk-stream` `DWClient`.
- Added `DingTalkStreamClientLike.ackCallback()` and adapter-level Stream ack.
- Updated live smoke to exercise `DingTalkChannelAdapter` rather than directly
  registering callbacks on `DWClient`.
- Added adapter-level duplicate robot delivery suppression with bounded seen-key
  storage.
- Left card action replay handling above the adapter, through daemon
  callback-token/messageRef validation, because approval replay is not
  adapter-local state.
- Redacted platform ids from `InboundMessage.raw` and `InboundAction.raw`.
- Updated `docs/internal/phase-5/dingtalk-target-verification.md` with implemented target,
  messageRef, replay, ack, and raw-field evidence.

Fresh verification already run after the fix:

- `pnpm vitest run --config vitest.config.ts --project unit packages/im-dingtalk/test`
  -> 12 files / 102 tests passed.
- `pnpm smoke:dingtalk-fake` -> 1 file / 1 test passed.
- `pnpm smoke:dingtalk-live` -> default skip, no network.
- `pnpm typecheck` -> green across workspace packages.
- `pnpm typecheck:tests` -> green.
- `pnpm test` -> 126 files, 1186 pass + 1 skip.
- `pnpm lint` -> 288 files checked, no fixes.
- `pnpm protocol:check` -> codex 0.128.0, 234 schema files canonical.

Please re-review only the Phase 5 implementation and the original P1/P2
findings. Do not re-flag expected JAC-90 closeout paperwork (README/TODOS/live
status/version/tag) as a blocker unless the implementation is still unsafe; that
paperwork is the next step after this re-review.

Required output:

1. Verdict: `GO`, `GO_WITH_LOW_NITS`, `APPROVE_WITH_CHANGES`, or `REJECT`.
2. P0/P1/P2 findings, if any.
3. Whether the original P1 and P2 findings are closed.
4. Any required fixes before Phase 5 tag.
5. Tag recommendation after closeout paperwork and gates.
