## 1. Verdict

**APPROVE_WITH_CHANGES**

No P0 architecture/security breach found, but I would not tag yet. There are P1 gaps around real Stream adapter behavior and duplicate delivery handling.

## 2. Findings

### P0

None found.

### P1

- **No production DingTalk Stream wrapper or adapter-level Stream ack path.**  
  Phase 5’s runtime shape requires `DingTalk Stream DWClient -> DingTalkChannelAdapter` and adapter callback ack as platform receipt. The package only defines `DingTalkStreamClientLike` in [client.ts](<repo>/packages/im-dingtalk/src/client.ts:14), while [adapter.ts](<repo>/packages/im-dingtalk/src/adapter.ts:203) registers callbacks but has no `socketCallBackResponse` / `EventAck` surface. The only real `DWClient` / `EventAck` use is in the standalone live smoke harness at [live-smoke.mts](<repo>/packages/im-dingtalk/scripts/live-smoke.mts:51), so the live smoke does not validate the actual adapter path. This also leaves send/update behind injected fakes only at [adapter.ts](<repo>/packages/im-dingtalk/src/adapter.ts:113).

- **Duplicate DingTalk robot deliveries can still duplicate Codex turns.**  
  The plan explicitly requires proving duplicate robot callbacks do not duplicate turns ([plan](<repo>/docs/internal/superpowers/plans/2026-05-02-phase-5-dingtalk-plan.md:305)). Current code emits every valid robot callback in [adapter.ts](<repo>/packages/im-dingtalk/src/adapter.ts:212). `idempotencyKey` is an extra DingTalk-specific field in [message.ts](<repo>/packages/im-dingtalk/src/message.ts:27), but daemon normalization ignores it in [daemon.ts](<repo>/packages/daemon/src/daemon.ts:1509). The reconnect test currently asserts duplicate emissions with identical keys rather than suppression at [reconnect.test.ts](<repo>/packages/im-dingtalk/test/reconnect.test.ts:102).

### P2

- **Target/messageRef evidence doc is still at pre-implementation state.**  
  [dingtalk-target-verification.md](<repo>/docs/internal/phase-5/dingtalk-target-verification.md:3) still says initial JAC-78 verification and lists callback field evidence that must be recorded before broker resolution at [line 54](<repo>/docs/internal/phase-5/dingtalk-target-verification.md:54). The code now assumes `spaceId` prefix mapping and `outTrackId` as approval-card `messageRef` in [action.ts](<repo>/packages/im-dingtalk/src/action.ts:40), so the final tag needs the evidence record updated or the assumption explicitly downgraded.

- **`raw` sanitization does not meet the written raw-field standard.**  
  The plan says no real platform ID should appear in `InboundMessage.raw` / `InboundAction.raw` ([plan](<repo>/docs/internal/superpowers/plans/2026-05-02-phase-5-dingtalk-plan.md:199)). Current raw debug fields include `conversationId`, `robotMsgId`, `streamMessageId`, `outTrackId`, and `spaceId` in [message.ts](<repo>/packages/im-dingtalk/src/message.ts:73) and [action.ts](<repo>/packages/im-dingtalk/src/action.ts:76). They are bounded, but still real platform identifiers in production.

### P3

- **Closeout paperwork is expected but not done in this scope.**  
  `JAC-90` remains unchecked in [TODOS.md](<repo>/TODOS.md:255), live status still says JAC-90 is next in [phase5-live-status.md](<repo>/docs/internal/handoffs/phase5-live-status.md:117), and README still marks Phase 5 in progress at [README.md](<repo>/README.md:18).

## 3. Positive Checks

- `packages/im-dingtalk/src/**` imports only `@codex-im/channel-core` among Codex packages.
- Callback payload parsing is exact `v1:<opaque-token>` and rejects raw approval/action/object shapes.
- Daemon fake smoke validates hash lookup, messageRef mismatch fail-closed, successful broker resolve, and no raw callback token in ack payloads.
- Live smoke is env-gated and defaults to skip without `DINGTALK_LIVE=1`.
- Method-literal guard was extended to `im-lark` and `im-dingtalk`.

## 4. Required Fixes Before Tag

Fix the two P1s: add the real DingTalk Stream wrapper/ack path exercised through the adapter, and implement actual duplicate-delivery suppression or daemon-level idempotency for DingTalk robot events. Then close the P2 evidence/raw-sanitization gaps or explicitly amend the plan.

## 5. Tag Recommendation

**Do not tag `phase-5-dingtalk-adapter-complete` yet.** Re-review after P1 fixes and JAC-90 closeout.