# Phase 1 → Phase 2 Handoff

> **目的**：让一个新 Claude Code session 用最小上下文启动 Phase 2。
> **入口**：从这一份开始，按 §"启动时必读" 顺序读最少 5 个文件就能进入工作状态。
> **不是**：Phase 2 plan 本身。Phase 2 plan 由 Phase 2 启动后 `/plan-eng-review` 流程产出。

---

## Phase 1 状态快照

- **Tag candidate**: `phase-1-runtime-complete` (apply after tag-gate fix arc + Codex re-review GO)
- **Branch**: `phase-1-runtime`
- **HEAD**: tag-gate fix arc complete (`a484014` + low-nit doc fixes); awaiting tag.
- **Total commits in branch**: 60+ (from `1b4a588` Pre-1 Node bump through T12 + 4 tag-gate fix commits + nit docs)
- **Test count**: 320 (was 73 at Phase 0 close; +242 across Phase 1 T1-T12 = 315; +5 from tag-gate fix arc — 4 Supervisor cleanup tests + 1 ClientRequest grep guard)

### Gate matrix（Phase 1 close-out 全绿）

| Gate | Command | Result |
|---|---|---|
| TypeScript | `pnpm typecheck` | exit 0 (7 packages strict + composite + verbatimModuleSyntax + exactOptionalPropertyTypes + noUncheckedIndexedAccess) |
| Type-only test assertions | `pnpm typecheck:tests` | exit 0 |
| Tests | `pnpm test` | 320 passing (31 unit + contract files; +5 from tag-gate fix arc) |
| CLI smoke (FakeAppServer-injected) | `pnpm test:cli-smoke` | 2 passing |
| Lint | `pnpm lint` | exit 0 (biome 90+ files clean) |
| Version pin | `pnpm check:codex-version` | `OK: 0.125.0` |
| Generation determinism | `pnpm protocol:check` | exit 0 (regenerate produces zero diff) |
| T4.5 fixture acceptance gate | `scripts/verify-phase1-fixtures.mts` | GATE PASS (1 server-request frames, 1 approval-capable) |
| Method-name boundary (T9b) | `packages/core/test/no-method-literals.test.ts` | 9/9 forbidden literals absent from runtime stack |
| App-server smoke | `CODEX_SMOKE=1 pnpm smoke:app-server` | passing locally; not run in CI |
| Real-turn smoke | `CODEX_REAL_SMOKE=1 pnpm smoke:real-turn` | passing locally; not run in CI |
| Runtime-send smoke | `CODEX_REAL_SMOKE=1 pnpm runtime:send -- --prompt 'Reply OK'` | new in T10; passing locally |

---

## D5–D10 决策摘要（Phase 1）

Each has a write-up in the plan §1 Decision Log. Carries forward as Phase 2 invariants.

| ID | 决定 | 落地 |
|---|---|---|
| **D5 final** | EventNormalizer single FIFO + class-aware walk-and-drop overflow | `packages/codex-runtime/src/event-normalizer.ts` (T7a/T7b) |
| **D6** | Transport-loss → pending approvals auto-fail as `denied / actor=system / reason=transport_lost`; idempotent | `packages/core/src/approval-broker.ts` `failPendingAsTransportLost()` (T9b) + `packages/daemon/src/supervisor.ts` `#onTransportClose` invocation (T11b) |
| **D7** | ApprovalBroker is sole owner of `client.setServerRequestHandler`; dispatch via exhaustive `Record<ServerRequest["method"], DispatcherSpec>` | `packages/core/src/approval-broker.ts` (T9a) + module-level `_attachedClients` WeakSet for cross-instance enforcement (T9a review) + build-time grep guard (T9b Step 9b.6) |
| **D8** | ts-rs `ServerNotification.method` is `string` at the wire-decoded level; narrow via `isServerNotificationMethod` derived from `Object.hasOwn(METHOD_CLASS, m)` | `packages/codex-runtime/src/method-names.ts` (T6) |
| **D9** | Two close paths for normalizer — `#cancelConsumer` (caller iterator.return → drop queue) vs `endOfStream` (source ended → drain queue, then close) | `packages/codex-runtime/src/event-normalizer.ts` (T7b) |
| **D10** | Server-request handlers may throw `JsonRpcResponseError` to signal explicit JSON-RPC error envelope; `AppServerClient.dispatchServerRequest` preserves code/message/data verbatim. Generic Error throws still collapse to -32603 | `packages/app-server-client/src/client.ts` (Pre-3); broker uses this for "method not in dispatch table" via -32601 |

### B-clean broker completion lifecycle (T9b blocker-fix, 2026-05-01)

The single most consequential design call in Phase 1. Codex review caught that the broker had two wire-response paths (`expirePending`/`failPendingAsTransportLost` directly calling `client.respond`, AND `#handle` returning the handler's result), which produced duplicate responses on late handler completion. User decided **B-clean** over **A** (AppServerClient idempotent respond/reject) because:

- A would mask broker bugs at the wire layer.
- B fixes the bug at the source — the broker's lifecycle.

Implementation: internal `PendingEntry` per pending request owns a `completion` Promise; `settleOnce(outcome)` is the only way to settle it. Three sources race (handler resolve/reject, expirePending, failPendingAsTransportLost); first wins; late settlers no-op. AppServerClient receives exactly one wire response per request id by construction. See `docs/internal/phase-1/codex-review-t9b-blocker-fix.md` for the full design + verdict.

---

## Phase 1 红线复核（**Phase 2 必须保持**）

Carried verbatim from Phase 0 + Phase 1 hardening:

- ❌ 不解析 codex CLI/TUI 输出
- ❌ 不把 Vercel AI SDK 当核心
- ❌ 不在生产代码 listen 非 stdio 接口
- ❌ 不自动 approve / 不绕过 approval (`ApprovalBroker.attach()` is the only authorized owner of `client.setServerRequestHandler`)
- ❌ 不隐式触发 Computer Use（必须 `/cu` 显式；Phase 6 anyway）
- ❌ 不公网暴露 codex app-server (Phase 8 only, behind explicit threat model)
- ❌ 不在 `@codex-im/{app-server-client,codex-runtime,daemon,cli}/src/**` 硬编码 ServerRequest method 字面量 (T9b grep guard enforces this; only `packages/core/src/approval-broker.ts` may carry them)
- ❌ 不在 `@codex-im/{app-server-client,codex-runtime,daemon,cli}/src/**` 硬编码 ClientRequest method 字面量 (similar boundary; only `packages/codex-runtime/src/runtime.ts` may carry them, and even there they're in a `REQUEST_METHODS` const validated `as const satisfies Record<string, ClientRequest["method"]>`)
- ❌ 不让 `ApprovalRecord` 包含 capability handles (T9b B-clean review medium-3: PendingEntry's resolve/reject closures are private to approval-broker.ts)
- ❌ 不让 `expirePending` / `failPendingAsTransportLost` 直接 `client.respond` / `client.reject` (T9b B-clean: route through `entry.settleOnce`)

---

## Phase 2 目标

**Telegram MVP** — 第一个真实 IM adapter，让用户可以从 Telegram 群组里发指令、看 turn 流、做 approval。

extend/build on Phase 1 stack：
- `@codex-im/protocol`（generated types）— Phase 2 消费，不重生成
- `@codex-im/app-server-client` — contract; 不改
- `@codex-im/codex-runtime`（CodexRuntime + EventNormalizer）— Phase 2 在其上加 Telegram 渲染
- `@codex-im/core`（ApprovalBroker + types）— Phase 2 通过 `ApprovalBroker.resolve()` / `registerHandler()` 接入 IM-driven approvals
- `@codex-im/daemon`（Supervisor）— Phase 2 在其上加 ChannelAdapter
- `@codex-im/cli` — Phase 2 也许加 `codex-im daemon serve` 命令

新建：
- `packages/im-telegram/` — Telegram bot 接入（grammY/native API per CLAUDE.md tech stack）
- `packages/channel/` — `ChannelAdapter` 抽象 + `SessionRouter` + `RenderScheduler`（per CLAUDE.md 必须坚持的架构）

## Phase 2 非目标（绝对不做）

- 任何其他 IM adapter（飞书 = Phase 4，钉钉 = Phase 5）
- Computer Use（= Phase 6）
- 公网暴露（= Phase 8）
- 重写 Phase 0/1 任何 contract 模块（**禁止**）
- 改 `ApprovalBroker` 内部 lifecycle（B-clean 已经验证；Phase 2 通过公共 API 接入即可）

---

## Phase 2 启动顺序

1. **Phase 2 plan**: `docs/internal/superpowers/plans/<DATE>-phase-2-telegram-mvp.md`，仿 Phase 1 plan 格式
2. **gstack `/plan-eng-review`** on Phase 2 plan
3. **Codex outside-voice** on Phase 2 plan
4. **Telegram bot quickstart spike** — 一个最小 bot，能收到消息就行；用来验证 grammY 选型 / 部署假设
5. 应用 P0/P1 fix
6. 派 subagent 或主会话执行（参考 Phase 1：T11a/T11b 这种 lifecycle-critical 必须 lead session；T1-T8 这种纯逻辑可以 subagent）

## Phase 1 已埋点的 Phase 2 hooks

Phase 1 完成的是 **lifecycle/dispatch/pending-state/timeout/transport-loss
foundations**，不是 full user approval resolution。Phase 2 接入 IM 时需要
设计/实现额外的 broker 公共接口（暴露 pending approvals 给 IM 渲染层、
把 user decision 映射成 per-method 的 wire response shape）。

- `ApprovalBroker.registerHandler<M>(method, handler)` — Phase 2 的 IM
  approval 流通过这里接入。Handler 收到 typed `req` (params 是 generated
  v2 type)，返回 typed response。Phase 1 的 default-reject 是 fallback；
  IM 接入后由 handler 决定每条 approval 的处理。**注意：Phase 2 还需要
  一个机制让 IM 渲染层"看到"pending approvals 并触发 user-side resolution
  — registerHandler 本身只是注册回调，不解决 pending state observability。**
- `ApprovalBroker.resolve(approvalId, decision, actor)` — **目前是 throwing
  stub** (`Error("ApprovalBroker.resolve: deferred to Phase 2 IM
  integration ...")`). Phase 2 必须设计并实现：
    1. The lookup-by-approvalId path (currently no callers; T9b's
       `#pending` map is keyed by `appServerRequestId`, not the
       `approval-${id}` synthetic id).
    2. The `ApprovalDecision → per-method response shape` mapping
       (per plan §1750, v2 responses are NOT all `{decision: ReviewDecision}`;
       the mapper must be method-aware).
    3. The "expose pending approvals to the IM rendering surface" API
       — `_pendingRecordsForTest()` is test-only; Phase 2 needs a
       proper public read API or callback hook.
- `ApprovalRecord.actor: ApprovalActor` — Phase 2 callers pass
  `{kind: "im", platform: "telegram", userId, chatId?}` instead of
  `null`. T5 type widening was forward-compat for exactly this.
- `Supervisor` constructor takes a `runtimeFactory` — Phase 2 wraps
  with rendering hooks (or accepts a pre-built runtime).
- `runtime.events.events()` — single AsyncIterable consumer per
  generation. Phase 2's renderer iterates this; T11b's `endOfStream()`
  is called by the supervisor on transport-close.

### Phase 2 integration risk: runtime-send vs Supervisor

`packages/cli/src/runtime-send.ts` (T10) currently builds the
`{client, broker, runtime}` quartet directly and does NOT exercise
`Supervisor`. The pre-attached-broker contract for Supervisor is
documented in `SupervisorOptions.broker` JSDoc but not type-enforced.
Phase 2 should either:

- route a production smoke path through Supervisor, OR
- add a dedicated integration test that enforces the pre-attached-
  broker contract end-to-end.

Until Phase 2 wires it, the broker pre-attach contract has no
production callsite. This is recorded as M3 from the Phase 1 integrated
review — Phase 2 risk, not a Phase 1 blocker.

---

## Phase 1 风险（Phase 2 应该意识到）

### 协议风险

1. **codex 0.126 升级路径**: T4.5 acceptance gate (verify-phase1-fixtures.mts) catches generated-type drift. Phase 2 should keep this gate; updating the fixture means re-running T4's capture flow with the richer prompt.
2. **新 ServerRequest method 添加**: T9b's exhaustive `Record<ServerRequest["method"], DispatcherSpec>` will fail-to-compile when codex 0.126+ adds a 10th method. dispatch-coverage.test.ts's runtime check + grep guard fire alongside. The fix is mechanical: extend `DispatchTable` + add a default-reject value per generated `*Response.ts`.
3. **Wire-shape changes in v2 approval responses**: T9a's per-method default-reject + T9b's expirePending response-mapping are generated-type-validated via `_v2_*` declarations in `dispatch-coverage.test.ts`. If a v2 response shape widens or narrows, those compile-time assertions fire.

### 工程风险

4. **Broker pending Map memory growth**: Terminal records stay in `#pending` after expirePending/failPendingAsTransportLost. T11b prune sweep is deferred. Long-running sessions could accumulate. Phase 2's IM adapter typically sees session lifetimes ≤ hours, so unlikely to bite Phase 2; Phase 3 production daemon should add the prune.
5. **Supervisor halt-on-spawn-failure**: T11b chose "halt fast" over "tolerate transient failures". Production observation may suggest a retry-with-jitter for transient subprocess spawn failures (e.g. system load). Defer to Phase 3 ops hardening.
6. **Synthetic turn_failed per pending turn on transport-loss**: T11b deferred. The `endOfStream()` contract is "the iterator returns done:true after the queue drains". Phase 2 IM adapter consumers seeing a hung turn (no terminal event) should interpret iterator-end as failure. If Phase 2 needs explicit per-turn fail events, that's a small extension to `EventNormalizer` (synthesize from a tracked-turn-set).
7. **AppServerClient idempotent respond/reject**: declined as Pre-4 (T9b blocker fix went through B-clean instead). Recorded in TODOS.md as future defensive guardrail. Ship only when a second case beyond ApprovalBroker produces server-request responses.

### 流程风险

8. **不要复辩 D5–D10**: 6 个决策有 evidence trail (codex reviews + plan + this handoff). 新 session 不要因为忘记上下文重新质疑。
9. **不要重写 Phase 0/1**: Phase 0 + Phase 1 modules are contract. Phase 2 only extends. ApprovalBroker / Supervisor / EventNormalizer are particularly load-bearing — surgical fixes (像 Pre-3 那样) only.
10. **新 session 上下文炸**: Phase 1 plan 是 ~2200 行；不要让新 session 把它整个塞进 context. 优先读本 handoff + 最新 phase1-live-status.md + 关键 src 文件，按需 grep.

---

## 启动时必读（Phase 2 新 session 第一件事）

按这个顺序读，不要跳：

1. **本文件**（`docs/internal/handoffs/2026-05-01-phase1-to-phase2.md`）— 你在这
2. `CLAUDE.md`（项目硬规则 + Compact / Resume Instructions）
3. `TODOS.md`（Phase 2 backlog 单一来源；Phase 1 items moved to Done）
4. `09-ROADMAP.md` 的 Phase 2 章节
5. `05-CODEX-APP-SERVER-PROTOCOL.md`（协议事实，Phase 0/1 close-out 已 audit）

按需查（**不要预读**，省 context）：

- `docs/internal/superpowers/plans/2026-04-30-phase-1-runtime.md` — Phase 1 plan 全本（仅在需要 Phase 1 决策细节时查）
- `docs/internal/phase-1/codex-review-*.md` — 10 个 codex outside-voice review 报告
- `packages/codex-runtime/src/event-normalizer.ts` 头部 JSDoc — D5/D9 决策 + walk-and-drop 算法
- `packages/core/src/approval-broker.ts` 头部 JSDoc — D7 + B-clean lifecycle + per-method default-reject 表
- `packages/daemon/src/supervisor.ts` 头部 JSDoc — Codex B7 + close-handling lifecycle + halt-on-spawn-failure
- `packages/app-server-client/src/client.ts` "Lifecycle policy: ONE-SHOT" 头部 JSDoc — Phase 0 contract preserved through Phase 1

**不要读** `packages/codex-protocol/src/generated/` 全量（500+ 文件）和 `schema/`（230+ 文件）—— grep / 按需 read 单文件。

---

## Phase 2 启动 prompt 草稿

```
进入 Phase 2：Telegram MVP。

请先读：
1. docs/internal/handoffs/2026-05-01-phase1-to-phase2.md
2. CLAUDE.md
3. TODOS.md
4. 09-ROADMAP.md（仅 Phase 2 章节）
5. 05-CODEX-APP-SERVER-PROTOCOL.md（仅 §1, §3, §4, §11）

不要重写 Phase 0/1 任何模块。所有 Phase 0/1 stack
(@codex-im/{protocol,app-server-client,testkit,codex-runtime,core,daemon,cli})
是 contract，Phase 2 只 extend。

不要立刻写代码。

第一步：用 Superpowers writing-plans 风格写 Phase 2 plan，落到
docs/internal/superpowers/plans/<DATE>-phase-2-telegram-mvp.md。计划必须含：
- Decision Log（仿 Phase 1，从 D11 开始）
- File Structure（packages/im-telegram + packages/channel 两个新包）
- Tasks（2-5 min 粒度，TDD）
- Failure Modes
- 一个明确的 Telegram bot quickstart spike（在 ChannelAdapter 之前）
- Worktree Parallelization Strategy
- GSTACK REVIEW REPORT

完成后等我批准，再跑 /plan-eng-review + Codex outside voice。
```

---

**Status: HANDOFF READY**. Phase 2 可以从这一点新开 session 启动。
