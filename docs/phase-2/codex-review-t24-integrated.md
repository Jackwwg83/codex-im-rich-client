VERDICT: NO_GO
SUMMARY: The main runtime invariants mostly hold, but the mandatory test typecheck gate is currently red.

P0 (blocks 0.1.0-phase2-draft → 0.1.0-phase2 promotion):
  - [packages/core/test/phase2-e2e-rig.ts:91] Phase 2 tests pass `clientInfo` into `new AppServerClient(...)`, but `AppServerClientOptions` has no such field — `pnpm typecheck:tests` fails with TS2353 across these helper/test constructors, and `scripts/ci-check.sh` makes that gate mandatory — remove the unused option or add a real typed option if the client is meant to own clientInfo.
  - [packages/core/test/phase2-e2e-rig.ts:42] `E2eRig.adapter` is typed as `ChannelAdapter`, but the rig/tests call fake-only methods (`injectAction`, `_acksForTest`) — `pnpm typecheck:tests` fails with TS2339 — type the test rig adapter as `TelegramShapeFakeChannelAdapter` or add a separate fake-adapter test field.

P1 (fix on a phase-2-review-nits branch before promotion):
  - [packages/core/test/phase2-e2e-rig.ts:121] The reference daemon wire-up can only call `bindActorPolicy` after `await adapter.sendCard(...)` returns the callback nonce — this violates the intended “binding exists before the card can be clicked” ordering and can turn a fast legitimate click into `binding_required` — generate the nonce before send and pass it into the adapter, or split prepare/send so bind happens before remote card delivery.
  - [packages/channel-core/src/fake.ts:83] Callback data embeds the raw `approvalId`, which is derived from unbounded JSON-RPC ids; the bounds test already proves 8-digit ids overflow the 62-byte Telegram-shaped limit — long sessions or string ids can strand approvals before card delivery — use a short adapter-local callback token mapped to approvalId/action/nonce.
  - [packages/channel-core/src/fake.ts:66] `_messageIdSeq` is module-scoped, so fake adapter instances share message-id state across tests — this weakens test isolation for the canonical adapter — make the sequence an instance private field.

P2 (nice-to-have):
  - [packages/core/src/audit.ts:223] `recent()` returns a shallow array copy while the comments describe a defensive copy; callers can still mutate returned event objects, metadata, or Dates and corrupt the ring — deep-clone/freeze events on read or narrow the comment.

NOTES:
  - Verified: `pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false` fails with the P0 errors above.
  - Source no-emit typechecks passed for `packages/core`, `packages/render`, `packages/channel-core`, and `packages/daemon`.
  - P0 checklist items otherwise looked clean: method literals are confined to the two approved core homes, `decision-mapper.ts` is method-literal-free, channel-core has no forbidden runtime imports, no production `"approve"` wire decision surfaced, snapshots clone Dates/params, `resolve()` checks expiry before settling, and `settleOnce` body is unchanged from Phase 1.
