# Phase 2 → Phase 3 Handoff

> **目的**：让一个新 Claude Code session 用最小上下文启动 Phase 3。
> **入口**：从这一份开始，按 §"启动时必读" 顺序读最少 5 个文件就能进入工作状态。
> **不是**：Phase 3 plan 本身。Phase 3 plan 由 Phase 3 启动后 `/plan-eng-review` 流程产出。

---

## Phase 2 状态快照

- **Tag candidate**: `phase-2-approval-im-surface-complete` — apply after T24 Codex outside-voice integrated review returns GO.
- **Branch**: `phase-2-approval-im-surface`
- **Base tag**: `phase-1-runtime-complete` (`23cbca7`)
- **Total Phase 2 commits**: 26 (T2 → T22 + plan polish + Codex review fixes)
- **Test count**: 720 passing + 1 skipped (was 320 at Phase 1 close — Phase 2 added 400 tests across approval broker surface, render, channel-core, e2e, supervisor invariant)
- **Package count**: 9 (added `@codex-im/render` + `@codex-im/channel-core`; was 7)

### Gate matrix (Phase 2 close-out 全绿)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `pnpm typecheck` | exit 0 (9 packages strict + composite + verbatimModuleSyntax + exactOptionalPropertyTypes + noUncheckedIndexedAccess) |
| Tests | `pnpm test` | 720 passing + 1 skipped |
| Lint | `pnpm lint` | exit 0 (biome 143 files clean) |
| Method-name boundary (T9b + T20) | `packages/core/test/no-method-literals.test.ts` | 9/9 forbidden literals confined to `approval-broker.ts` + `approval-request-kind.ts` only |
| ClientRequest boundary (T20) | `packages/codex-runtime/test/no-raw-client-request.test.ts` | no raw `client.request("...")` outside `codex-runtime/src/runtime.ts` |
| F13 channel-core boundary | `packages/channel-core/test/no-broker-import.test.ts` + `no-protocol-import.test.ts` | no runtime import of @codex-im/core or @codex-im/codex-runtime; no protocol imports at all |

### Codex outside-voice review status

- T7-T12 (broker public surface + resolve): **GO** after fix arc (`231f653`)
- T13-T17 (render package): **GO** after fix arc (`7f6b6a1`)
- T18-T19 (channel-core), T20 (grep guard), T21 (e2e), T22 (supervisor invariant): **DEFERRED** — local codex CLI was hung in the implementer's environment when these landed. Internal gates (typecheck, lint, all tests) are green; T24 will run the integrated review across the entire `phase-1-runtime-complete..HEAD` range as the tag-gate.

---

## D5–D21 决策摘要 (Phase 1 + Phase 2 carry-forward)

Phase 1 D5-D10 carry forward unchanged (see `docs/internal/handoffs/2026-05-01-phase1-to-phase2.md`).

Phase 2 D11-D21:

| ID | 决定 | 落地 |
|---|---|---|
| **D11** | Per-`ApprovalRequestKind` wire mapping (NOT per-method); supports v2 `{decision:"accept"\|"acceptForSession"\|"decline"\|"cancel"}` + legacy `{decision:"approved"\|"approved_for_session"\|"denied"\|"abort"}` + non-decision shapes per kind | `packages/core/src/decision-mapper.ts` `mapDecisionForPending` (T10) |
| **D12** | Read-only public snapshot API + internal terminal-record lookup; lifecycle emitters at `#settleEntry` boundary | `packages/core/src/approval-broker.ts` `listPending` / `getPending` / `onPendingCreated` / `onPendingResolved` (T7) |
| **D13** | 12 enumerated `AuditEventKind` values | `packages/core/src/audit.ts` (T3) |
| **D14** | `ChannelAdapter` closed for Phase 2 (escape clause via plan amendment); capability matrix is the only in-interface escape | `packages/channel-core/src/adapter.ts` JSDoc (T19) |
| **D15** | Secondary `#pendingById` index lock-step with `#pending` | `packages/core/src/approval-broker.ts` (T7) + stress test `phase2-e2e-secondary-index.test.ts` (T21.4) |
| **D16** | Supervisor pre-attached-broker invariant at `#spawnFresh` head | `packages/daemon/src/supervisor.ts` (T22) + `broker.isAttached()` |
| **D17** | TelegramShapeFakeChannelAdapter is canonical Phase 2 adapter; real Telegram adapter (`@codex-im/im-telegram`) NOT shipped (Option A) | `packages/channel-core/src/fake.ts` (T19) |
| **D18** | Three-mode dispatcher: `default-reject` / `handler` / `pending`; `enablePendingMode<M>(method)` is the IM-driven bootstrap | `packages/core/src/approval-broker.ts` `enablePendingMode` (T8) |
| **D19** | Per-card actor binding via `bindActorPolicy(approvalId, {allowedActors, target, callbackNonce})`; idempotent on identical policy; resolve()-side validation fail-closes on wrong_actor / wrong_target / stale_callback / binding_required | `packages/core/src/approval-broker.ts` (T9 storage + T11 validation) |
| **D20** | Approval expiry checked inside `resolve()` (lazy-expire); `approvalTtlMs` constructor option | `packages/core/src/approval-broker.ts` (T11 in-resolve check + Codex review P2 fix `231f653`) |
| **D21** | `#settleEntry` is the SOLE settle-routing helper; `entry.settleOnce` body byte-for-byte unchanged from Phase 1 tag | `packages/core/src/approval-broker.ts` `#settleEntry` (T7) + `packages/core/test/approval-broker-t7-public-surface.test.ts` byte-identical guard |

---

## C-P1 alignment (Phase 2 redline)

Renderer-defensive unknown-snapshot path:
- **Broker `#handle`**: unknown ServerRequest method throws `JsonRpcResponseError(-32601)` + emits `approval.unsupported_method` audit + creates NO PendingEntry.
- **Renderer `projectAsRichBlock(snapshot)`**: if `classifyApprovalRequest(method) === "unknown"`, returns `{type: "approval", card}` with `kind: "unknown"`, `actions: [{kind: "decline"}]`, `target.riskLevel: "critical"`, default-decline summary.

Two different code paths, two different test paths. T21.2.14 (broker level) + T21.2.15 (renderer defensive) both pass.

---

## Phase 2 redlines (carry forward to Phase 3)

Persistent project redlines from CLAUDE.md remain. Phase 2 adds:

- ❌ **No first-actor-wins** — `bindActorPolicy` is the only way to grant approval permission; resolve() validates per-card.
- ❌ **No `expirePending()` as security boundary** — `expirePending` is a sweep utility for audit/metrics; `resolve()` MUST also lazy-check `Date.now() >= expiresAt` before settle (D20).
- ❌ **No `settleOnce` modification** — `entry.settleOnce` body is byte-for-byte locked at Phase 1 tag. All settle paths route through `#settleEntry` (D21). Byte-identical guard test exists in T7.
- ❌ **No `"approve"` wire decision** — v2 = `"accept"`; legacy = `"approved"`. Mapper switches per ApprovalRequestKind (D11).
- ❌ **Production = Supervisor; runtime-send = dev/operator only** (Codex Q6) — Supervisor's `#spawnFresh` head asserts `broker.isAttached()` (T22 / D16).
- ❌ **Method-literal boundary extended to render + channel-core** (F1 / T20) — only `approval-broker.ts` DispatchTable + `approval-request-kind.ts` METHOD_TO_KIND may contain ServerRequest method strings.
- ❌ **F13 channel-core boundary** — channel-core src has NO runtime import of @codex-im/core or @codex-im/codex-runtime; type-only via @codex-im/render only.

---

## 启动时必读 (5 files for new Phase 3 session)

1. **This file** (`docs/internal/handoffs/2026-05-02-phase2-to-phase3.md`) — start here.
2. **`CLAUDE.md`** — project-wide rules + redlines (updated for Phase 2).
3. **`docs/internal/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md`** — full Phase 2 plan v2.3 with all decisions, task bodies, decision rationale.
4. **`packages/core/src/approval-broker.ts`** — the single most important production source in the project. Phase 1 B-clean settleOnce body is byte-for-byte unchanged; Phase 2 added `#settleEntry`, `enablePendingMode`, `bindActorPolicy`, `resolve()`, `isAttached()`, `approvalTtlMs` constructor option.
5. **`packages/channel-core/src/adapter.ts`** + `fake.ts` — closed ChannelAdapter interface + canonical reference adapter. Future IM platform implementations conform to this without interface change OR submit a plan amendment.

---

## Recommended Phase 3 mission

Phase 2 delivered the approval public surface + platform-agnostic rendering + fake e2e proof. Phase 3 candidates (any subset; user picks):

1. **`@codex-im/im-telegram`** — real Telegram adapter implementing the closed ChannelAdapter interface. Uses `grammY` or native Bot API; respects `TelegramShapeFakeChannelAdapter`'s callback_data + deadline constraints (which were modeled on real Telegram limits).
2. **Real daemon wire-up** — replace the test-only `phase2-e2e-rig.ts`'s daemon-wireup function with a production module in `@codex-im/daemon` that subscribes broker.onPendingCreated → projectAsRichBlock → adapter.sendCard → bindActorPolicy. Phase 2 e2e proves the shape; Phase 3 makes it production-real.
3. **SecurityPolicy ACL** — Phase 2 left `SecurityPolicy` as a `phase1-noop` skeleton. Phase 3 fills in: per-target/actor allowlist enforced before `bindActorPolicy`; can re-validate platform-asserted user identity; integrates with deny-app/deny-command lists.
4. **Audit log SQLite migration** — Phase 2 ring buffer is in-memory only (in-process audit). Phase 3 adds durable SQLite-backed audit with ring-as-cache. Plus a prune sweep for terminal records (broker's #pendingById grows unbounded otherwise).
5. **launchd integration** — daemon as a macOS launchd service for Mac mini deployment. Includes log rotation, restart policy, env management.
6. **Synthesized turn_failed events** — when transport closes mid-turn, EventNormalizer should synthesize a `turn_failed` event for the IM layer to render. Currently nothing surfaces.
7. **Computer Use approval flow** — `tool_call` kind currently default-rejects. Phase 6 (per project README) ships the real CU approval flow.
8. **Supervisor reattach + stale request test** (T21.2.12 deferred) — full daemon-side test of "old approvalId resolve returns transport_lost across generation reattach". Phase 2 covered the broker side; Phase 3 wires the supervisor.

Phase 3 starts with `/plan-eng-review` against whichever subset the user picks as Phase 3 mission.

---

## Carry-forward TODOS

Phase 2 P2 deferrals (from round-3 polish + review fixes):

- **Lazy-prune sweep for terminal records** — `#pendingById` retains terminal records for audit lookup; Phase 3 should add a sweep (configurable max age, max count, OR external trigger) to prevent unbounded growth.
- **Structured secret detector** — current `redact.ts` is regex-based. Phase 3 may add structured detection for known credential prefixes (`AKIA*`, `ghp_*`, etc.) with parsed-context awareness.
- **Per-kind risk-level computation from params** — Phase 2 KIND_TABLE has fixed risk levels; Phase 3 may derive from params content (e.g. `command_execution` with rm -rf in argv → critical).
- **Localization for plain-text fallback** — Phase 2 ships English defaults (Codex Q1); Phase 3 + adapter scope owns i18n.
- **MaxListenersExceededWarning during stress test** — `phase2-e2e-secondary-index.test.ts` triggers 100 concurrent emitServerRequests; node EventEmitter warns at 10 listeners. Harmless but cosmetically noisy. Phase 3 may bump max listeners on the InMemoryTransport.

---

## Final commit ID at handoff

Run `git log --oneline phase-1-runtime-complete..HEAD | head -1` to see the most recent Phase 2 commit. As of this handoff doc commit:
- T22 supervisor invariant: `d452391`
- T21 full e2e: `0a121e2`
- T20 grep guard extension: `27c3c76`
- T19 ChannelAdapter + fake: `acea679`
- T18 channel-core skeleton: `a08cc81`
- T13-T17 render fixes: `7f6b6a1`
- T7-T12 broker fixes: `231f653`
- T6 type cascade: `4e95f50`
- T2 classifier: `89968ee`
