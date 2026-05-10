# Phase 0 → Phase 1 Handoff

> **目的**：让一个新 Claude Code session（或刚 `/clear` 后的 session）用最小上下文启动 Phase 1。  
> **入口**：从这一份开始，按 §"启动时必读" 顺序读最少 5 个文件就能进入工作状态。  
> **不是**：Phase 1 plan 本身。Phase 1 plan 由 Phase 1 启动后 `/plan-eng-review` 流程产出。

---

## Phase 0 状态快照

- **Tag**: `phase0-bootstrap-complete`
- **Branch**: `phase-0-bootstrap`
- **HEAD commit**: `864400d phase0(K): record pnpm audit clean run (193 deps, 0 vulnerabilities)`
- **Tag commit**: `864400d`（同 HEAD）
- **Total commits in branch**: 39（从基线 `9372944` 到 tag）
- **Test count**: 79（73 unit + 6 contract）

### Gate matrix（最后一次全量验证全绿）

| Gate | Command | Result |
|---|---|---|
| TypeScript | `pnpm typecheck` | exit 0（5 packages strict + composite + verbatimModuleSyntax + exactOptionalPropertyTypes + noUncheckedIndexedAccess） |
| Tests | `pnpm test` | 73 unit + 6 contract = 79 pass |
| Lint | `pnpm lint` | exit 0（biome 47+ files clean） |
| Version pin | `pnpm check:codex-version` | `OK: 0.125.0` |
| Generation determinism | `pnpm protocol:check` | exit 0（regenerate produces zero diff） |
| App-server smoke | `CODEX_SMOKE=1 pnpm smoke:app-server` | PASSED 真 codex 0.125 initialize round-trip |
| Real-turn smoke | `CODEX_REAL_SMOKE=1 pnpm smoke:real-turn` | PASSED full lifecycle 真 turn ~5s |
| Security baseline | `pnpm audit` | 0 vulnerabilities / 193 deps |

---

## D1–D4 决策摘要（不要回头辩论这些）

| ID | 决定 | 落地 |
|---|---|---|
| **D1** | `performInitializeHandshake` 是独立模块，不烤进 `AppServerClient` | `packages/app-server-client/src/handshake.ts` 共享给 smoke + Phase 1 `CodexRuntime.initialize` |
| **D2** | `InMemoryTransport` 在 `@codex-im/testkit`，不在 production client 包 | `packages/testkit/src/in-memory-transport.ts` |
| **D3** | Codex CLI 是本项目的 outside voice，**早期且持续使用** | Phase 0 跑了 4 轮（plan / Section B / 整 diff / backlog triage），均落在 `docs/phase-0/codex-review.md` 等 |
| **D4** | Phase 0 smoke 必须包含真 turn（不只是 initialize） | `smoke:real-turn` `CODEX_REAL_SMOKE=1` gated，`sandbox=read-only` + `approval_policy=on-request` + 客户端 default-reject + 固定 harmless prompt |

### Phase 0 empirical 反转（Phase 1 不要复辩）

- `--experimental` flag → **stable**（empirical diff 证明 +29 文件全在 Phase 7+ scope；详见 `docs/phase-0/codex-gen-diff.md`）
- `vitest@^2` → `vitest@^4` + `vite@^6`（v4 的 `test.projects` 原生语法）
- `@types/node@^22` → `^20`（与 `engines.node>=20.10` 对齐）

---

## Phase 0 红线复核（**Phase 1 必须保持**）

- ❌ 不解析 codex CLI/TUI 输出（任何 ANSI/prompt-text 匹配）
- ❌ 不把 Vercel AI SDK 当核心
- ❌ 不在生产代码 listen 非 stdio 接口
- ❌ 不自动 approve / 不绕过 approval
- ❌ 不隐式触发 Computer Use（必须 `/cu` 显式）
- ❌ 不公网暴露 codex app-server
- ❌ 不在 `@codex-im/app-server-client` 层硬编码 approval / server-request method 字面量

最后一条是 Phase 1 ApprovalBroker 设计的硬约束，详见 §"Phase 1 必须先做的 spike / review"。

---

## Phase 1 目标

**无 IM 情况下完成 thread/turn/event/approval 内核**。

extend/build on Phase 0 stack：
- `@codex-im/protocol`（generated types） — Phase 1 消费，不重生成
- `@codex-im/app-server-client`（JSONL + JSON-RPC + Transport + Client + Handshake + StdioTransport） — Phase 1 在其上加业务层
- `@codex-im/testkit`（InMemoryTransport + FakeAppServer + replayFixture + 7 wire fixtures） — Phase 1 扩展 fixture
- `@codex-im/cli`（smoke commands） — Phase 1 新增 `runtime send` 和 `--capture` 抓 fixture

新建（按 plan v2 §13 implementation skeleton 命名）：
- `packages/codex-runtime/`：thread/turn/item 状态机 + typed request wrappers + EventNormalizer
- `packages/core/`：ApprovalBroker（拥有单一 server-request handler 槽，内部 dispatch）+ SecurityPolicy 占位（Phase 3 才完整）
- `packages/daemon/`：supervisor（codex restart 重建 client）

## Phase 1 非目标（绝对不做）

- 任何 IM adapter（Telegram/飞书/钉钉 = Phase 2+）
- Computer Use（= Phase 6）
- SQLite storage（= Phase 2）
- Telegram bot token / 任何 IM secret 处理
- launchd / 监控 / CI（= Phase 3）
- ChannelAdapter 抽象、CommandRouter、SessionRouter（= Phase 2）
- 重写 Phase 0 的 `AppServerClient` / `StdioTransport` / `JsonlDecoder`（**禁止**——它们是 contract，只能 extend）
- 把 `AppServerClient` 改成可重启（违背 ONE-SHOT policy，`client.ts` JSDoc 已明文禁止）

---

## Phase 1 backlog（active TODO，按依赖顺序）

| ID | 项 | 落地路径 | 依赖 |
|---|---|---|---|
| **P1.1** | `CodexRuntime` typed wrappers over `client.request("thread/start", ...)` | `packages/codex-runtime/` 新建 | `@codex-im/protocol` `@codex-im/app-server-client` |
| **P1.5** | `categorizeJsonRpcError(err)` helper（区分 unknown-method / invalid-params / invalid-request / internal-error；malformed JSON 走 stderr 单独说明） | `packages/app-server-client/src/errors.ts` 扩展 | independent |
| **P1.3** | `EventNormalizer` ordered async iterator + terminal-state recognition + unknown-event fallthrough | `packages/codex-runtime/src/event-normalizer.ts` | P1.1 |
| **P1.2** | `ApprovalBroker` single server-request handler + 内部 method dispatch | `packages/core/src/approval-broker.ts` | P1.3（消费 approval 相关 normalized event）|
| **P1.6** | richer wire fixtures（替换 `harmless-turn-event-stream.jsonl` placeholder，含 server-initiated approval request） | `packages/testkit/fixtures/codex-0.125.0/` 扩展 + `packages/cli/src/smoke-real-turn.ts` `--capture` flag | P1.3 P1.2 验证用 |
| **P1.4** | Daemon supervisor 实施 ONE-SHOT lifecycle | `packages/daemon/src/supervisor.ts` 新建 | 全部上面 |

详见 `TODOS.md`（每条都有 Why / What / Where to start / Source 链接）。

### Phase 0 已埋点的 Phase 1 hooks

- `AppServerClient.setServerRequestHandler(handler | null)` — Phase 1 ApprovalBroker 注册到这个槽
- `AppServerClient.onNotification(handler)` — Phase 1 EventNormalizer 注册到这个槽
- `client.ts` 头部 JSDoc "Lifecycle policy: ONE-SHOT" — Phase 1 supervisor 必须 follow 7 步重建协议
- `FakeAppServer.emitServerRequest(method, params, id, { timeoutMs })` — Phase 1 ApprovalBroker round-trip 测试用，已含 5s default timeout
- `FakeAppServer.replayFixture(version, name)` — Phase 1 contract test 加新 fixture 后自动跑

---

## Phase 1 风险

### 协议风险

1. **`-32600` 重载**：codex 0.125 把 unknown-method 和 invalid-params 都返这个码（wire spike case 3+4）。Phase 1 `categorizeJsonRpcError` 必须做关键字匹配。任何依赖 code 区分错误类别的代码会出 bug。
2. **server-request method 名稳定性**：当前观察到 `item/{commandExecution,fileChange,permissions,tool}/{requestApproval,requestUserInput}` + `applyPatchApproval`/`execCommandApproval` legacy。**禁止硬编码字符串**——只能从生成 `ServerRequest.ts` union 读。codex 升级时新方法出现就 default-reject 不能静默 fallthrough（05-PROTOCOL §4 强约束）。
3. **`thread/closed` / `error` / `warning` notification**：Phase 0 `smoke:real-turn` 实测会收到 `warning`（chronicle 警告）。Phase 1 EventNormalizer 必须处理这些非 turn lifecycle 通知。
4. **JSON schema 非确定性**：`scripts/canonicalize-schema.mjs` 兜底，但 codex 升级可能改变这个 workaround 的有效性。Phase 1 任何 codex 升级流程必须保留 canonicalize 步骤。

### 工程风险

5. **EventNormalizer 顺序性**：从 callback `client.onNotification` 转 async iterator 涉及 FIFO 队列 + backpressure。如果 turn 高速产 delta 而消费慢，需要决定 drop 策略 vs unbounded buffer。Phase 1 plan 必须明确。
6. **ApprovalBroker single-slot 设计**：`AppServerClient.setServerRequestHandler` 只接受一个 handler。多模块（如 `/cu` Phase 6）想注册自己 handler 会冲突。Phase 1 设计必须把 ApprovalBroker 设为唯一注册者，所有 dispatch 走它。
7. **supervisor 重建过程中事件丢失窗口**：从 codex crash 到 new client ready 之间，turn state 怎么处理？两种选择：（a）pending turn 视为失败，IM 端通知；（b）尝试 `thread/resume`。Phase 1 plan 拍板。
8. **richer fixture 需要真模型调用**：抓 fixture 的 prompt 必须设计成会触发 file edit / shell exec / approval，但又不能造成 side effect。需要一个完全 sandboxed 的项目目录做"白噪音 workspace"。

### 流程风险

9. **不要复辩 D1–D4**：4 个决策有 evidence trail，新 session 不要因为忘记上下文重新质疑。
10. **不要重写 Phase 0**：所有 Phase 0 模块都是 contract。Phase 1 只能 extend。如果发现 Phase 0 有 bug，应该 surgical fix（像 `1c81023` 那样修 4 个 P1）而不是重写。
11. **新 session 上下文炸**：Phase 0 plan v2 是 92KB；不要让新 session 把它整个塞进 context。优先读本 handoff + `TODOS.md` + 关键 src 文件，按需 grep。

---

## Phase 1 必须先做的 spike / review

按这个顺序，**别跳步**：

1. **新 Phase 1 plan**：`docs/superpowers/plans/YYYY-MM-DD-phase-1-runtime.md`，仿 plan v2（Phase 0）的格式：File Structure、Decision Log、Tasks（2–5 min 粒度）、Worktree Parallelization、Failure Modes、GSTACK REVIEW REPORT。
2. **richer-prompt fixture spike**：写 plan 之前先做。设计一个 prompt 触发：
   - 1+ `item/agentMessage/delta`
   - 1+ shell command exec → `item/commandExecution/outputDelta` + 终态
   - 1+ file edit → `item/fileChange/patchUpdated`
   - 1+ approval（最易触发：让模型尝试运行命令；codex 在 approval_policy=on-request 下会发 `item/commandExecution/requestApproval`）
   
   把抓到的事件流 commit 到 `packages/testkit/fixtures/codex-0.125.0/`。这一步给 Phase 1 EventNormalizer + ApprovalBroker 提供真实 wire shape，没它别写代码。
3. **`gstack /plan-eng-review`** on Phase 1 plan
4. **Codex outside voice** on Phase 1 plan（`codex exec` with read-only sandbox + high reasoning effort）
5. 应用 P1 + 必要 P2 fix
6. 派 subagent 或主会话执行（参考 Phase 0 经验：harness 在 batched tool calls + 长 session 上不稳，单步推进更稳）

---

## 启动时必读（Phase 1 新 session 第一件事）

按这个顺序读，不要跳：

1. **本文件**（`docs/handoffs/2026-04-30-phase0-to-phase1.md`）— 你在这
2. `CLAUDE.md`（项目硬规则）
3. `TODOS.md`（Phase 1 backlog 单一来源）
4. `09-ROADMAP.md` 的 Phase 1 章节（任务+验收清单）
5. `05-CODEX-APP-SERVER-PROTOCOL.md`（协议事实，Phase 0 close-out 已 audit）

按需查（**不要预读**，省 context）：

- `docs/phase-0/host-environment.md` — wire spike 5 cases 实测数据
- `docs/phase-0/codex-gen-diff.md` — `--experimental` 决策证据
- `docs/phase-0/codex-review.md` — Phase 0 final review 战果
- `docs/phase-0/decision-log.md` — D1–D4 完整 rationale
- `packages/app-server-client/src/client.ts` — 阅读头部 JSDoc 即可（lifecycle policy）
- `packages/codex-protocol/src/generated/{ServerRequest,ServerNotification,ClientRequest}.ts` — 真实 method names
- `docs/superpowers/plans/2026-04-29-phase-0-bootstrap.md` — 仅在需要 Phase 0 详细决策时查

**不要读** `packages/codex-protocol/src/generated/` 全量（488 文件）和 `schema/`（227 文件）—— grep / 按需 read 单文件。

---

## Phase 1 启动 prompt 草稿

```
进入 Phase 1：Codex Runtime Core。

请先读：
1. docs/handoffs/2026-04-30-phase0-to-phase1.md
2. CLAUDE.md
3. TODOS.md
4. 09-ROADMAP.md（仅 Phase 1 章节）
5. 05-CODEX-APP-SERVER-PROTOCOL.md（仅 §1, §3, §4, §11）

不要重写 Phase 0 任何模块。Phase 0 stack（@codex-im/protocol +
app-server-client + testkit + cli）是 contract，Phase 1 只 extend。

不要立刻写代码。

第一步：用 Superpowers writing-plans 风格写 Phase 1 plan，落到
docs/superpowers/plans/YYYY-MM-DD-phase-1-runtime.md。计划必须含：
- Decision Log（仿 Phase 0）
- File Structure（codex-runtime/core/daemon 三个新包）
- Tasks（2-5 min 粒度，TDD）
- Failure Modes
- 一个明确的 fixture spike 任务（在 EventNormalizer 之前）
- Worktree Parallelization Strategy
- GSTACK REVIEW REPORT

完成后等我批准，再跑 /plan-eng-review + Codex outside voice。
```

---

## 此 handoff 之外仍未沉淀的 backlog

经过本次 handoff 整理，**所有提到的 backlog 项都已在 TODOS.md 中**。

未沉淀的（来自 plan v2 NOT-in-scope，未来 phase 才需要，不属于 Phase 1 backlog）：
- launchd / Mac mini ops（= Phase 3）
- CI on GitHub Actions（= Phase 1 hygiene，可以跟 Phase 1 plan 一起做）
- Telegram/Lark/DingTalk adapter（= Phase 2/4/5）
- Computer Use 安全策略（= Phase 6）
- Web Console（= Phase 8）

这些都已在 `09-ROADMAP.md` Phase 2–8 里有占位章节，无需重复登记。

---

**Status: HANDOFF READY**. Phase 1 可以从这一点新开 session 启动。
