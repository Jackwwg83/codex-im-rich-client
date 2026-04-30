# 项目进度与里程碑

## 总体策略

先完成 App Server rich client 内核，再接 IM；先 Telegram 跑通端到端，再做飞书/钉钉；Computer Use 放在基础审批稳定之后。

## Phase 0：项目初始化与协议验证 ✅ 完成 2026-04-29

### 目标

建立 monorepo、协议生成、app-server smoke test。

### 任务

- [x] 初始化 pnpm workspace（commit `0629659`）
- [x] 创建 packages skeleton（codex-protocol/app-server-client/testkit/cli — Sections C–J）
- [x] 添加 TypeScript（5.9.3 strict + composite + verbatimModuleSyntax + exactOptionalPropertyTypes）、Vitest（4.1.5 with unit/contract projects）、Biome（1.9.4，commits `cbd44c7` `34119a0` `df05488`）
- [x] 实现 `protocol:generate` —— stable mode 不带 `--experimental`（empirical 决策见 `docs/phase-0/codex-gen-diff.md`，commits `c1a1a08` `67d7928` `d9b61c5`）
- [x] 实现 JSONL transport 最小版本（JsonlDecoder + perf 1MB/4KB/<100ms + UTF-8 split，commit `9b74163`）
- [x] 实现 `smoke:app-server`（CODEX_SMOKE=1 gated，初始化握手 + 干净 shutdown，commit `72d328f`）

### 额外完成（Plan v2 / Codex outside-voice 加项）

- [x] CODEX_VERSION 三方版本 gate（CODEX_VERSION 文件 / package.json#codexIm.codexVersion / `codex --version`，commit `df56519`）
- [x] StdioTransport 完整签名（command/args/cwd?/env?/configOverrides?/shutdownGraceMs?/logger?；ENOENT/SIGKILL grace；commit `e23cda2`）
- [x] AppServerClient 完整：request timeout（per-call 覆盖）+ default-reject server request（4 cases）+ transport-close-pending reject + 类型化 errors + 并发 correlation
- [x] FakeAppServer + replayFixture（commit `380a988`）+ 7 wire fixtures（codex-0.125.0 case 1–5 + server-request placeholder + metadata，commit `f525cb0`）
- [x] performInitializeHandshake 返回 typed `InitializeResponse`（commit `2d4b149`）
- [x] `smoke:real-turn` 真模型 turn 验证（CODEX_REAL_SMOKE=1 gated，sandbox=read-only + approval_policy=on-request + client default-reject，commit `72d328f`）
- [x] JSON schema canonicalization（解 codex 0.125 generate-json-schema 非确定性，commit `d9b61c5`）

### 验收

- [x] `codex app-server generate-ts` 产物进入 repo（488 TS + 227 schema canonical）
- [x] smoke test 可以 initialize（`CODEX_SMOKE=1` 已运行通过）并完成一个无害 turn（`CODEX_REAL_SMOKE=1` 已运行通过 2026-04-29，~5s elapsed）
- [x] CI/local `pnpm test typecheck lint` 可运行（67 tests pass，typecheck 5 packages 全过，biome check 47 文件 clean）

### 产出引用

- 实施计划：`docs/superpowers/plans/2026-04-29-phase-0-bootstrap.md`
- 协议决策证据：`docs/phase-0/host-environment.md`、`docs/phase-0/codex-gen-diff.md`
- Codex outside-voice review 结果：见 plan v2 Decision Log + commit `dacbb29` `719a859` `380a988`

## Phase 1：Codex Runtime Core

> **入口文档**：`docs/handoffs/2026-04-30-phase0-to-phase1.md` 是 Phase 1 启动的 single source of truth。新 session 先读它，再读本节。

### 目标

无 IM 情况下完成 thread/turn/event/approval 内核。**extend/build on** Phase 0 stack（`@codex-im/protocol` + `@codex-im/app-server-client` + `@codex-im/testkit` + `@codex-im/cli`），不重写也不绕过。

### 任务

#### Phase 0 已完成的底层（Phase 1 在其上加层）

- [x] ~~AppServerClient 完整 request/notification/server request~~ — Phase 0 commits `2518692` `440467b`；Phase 1 加 typed wrappers (TODOS `P1.1`) + supervisor 重建 client (TODOS `P1.4`)
- [x] ~~FakeAppServer testkit + replayFixture~~ — commit `380a988` + `022c075` (含 `emitServerRequest.timeoutMs`)；Phase 1 扩展 ApprovalBroker round-trip 测试 + 真实 fixture 抓取 (TODOS `P1.6`)
- [x] ~~CLI `codex-im smoke app-server` / `smoke real-turn`~~ — commit `72d328f` + `fa05a5e`；Phase 1 新增 `codex-im runtime send`（手动发 turn 用）+ `--capture` flag 用于 fixture 抓取

#### Phase 1 新建

- [ ] **`CodexRuntime` 状态机** + typed request wrappers over `client.request<R>(method, params)` — TODOS `P1.1`
- [ ] **`EventNormalizer`** ordered async iterator + terminal-state recognition + unknown-event fallthrough — TODOS `P1.3`
- [ ] **`ApprovalBroker`** 拥有 single server-request handler，**内部按 method dispatch**，method 名只能从生成 `ServerRequest.ts` union 读，**禁止硬编码字面量**（05-PROTOCOL §4 强约束）— TODOS `P1.2`
- [ ] **Daemon supervisor** 实施 ONE-SHOT lifecycle：codex 子进程退出后构造 NEW `AppServerClient`（不复用），重跑 `performInitializeHandshake`，重 attach 处理器 — TODOS `P1.4`
- [ ] **`categorizeJsonRpcError(err)` helper** 区分 -32600 重载（unknown method / invalid params / invalid request） + 文档化 malformed JSON 走 stderr 不走 JSON-RPC error — TODOS `P1.5`
- [ ] **richer wire fixtures** 替换 Phase 0 的 `harmless-turn-event-stream.jsonl` placeholder（Phase 1 用富 prompt 重抓，含 server-initiated approval request）— TODOS `P1.6`

### 验收

- [x] ~~单元测试覆盖 request correlation~~ — Phase 0 已覆盖（`client.test.ts` + `client-timeout` + `client-default-reject` + `client-transport-close` + `client-codex-final-review` 共 5 个 test 文件）
- [x] ~~unknown event 不崩溃~~ — Phase 0 已覆盖
- [ ] **Phase 1**: fake server 能模拟 approval round-trip（基于 Phase 0 `FakeAppServer.emitServerRequest`）
- [ ] **Phase 1**: `EventNormalizer` 单测覆盖所有相关 `ServerNotification` union arm
- [ ] **Phase 1**: `ApprovalBroker` 单测覆盖每个真实 server request method（不是 placeholder）
- [ ] **Phase 1**: `categorizeJsonRpcError` 单测覆盖 `unknown variant` / `missing field` / `invalid type` / `unknown field` 关键字 + 默认 fallthrough
- [ ] **Phase 1**: richer wire fixture replay 进 contract test
- [ ] **Phase 1**: `smoke:real-turn` 用 richer prompt 跑通（不光是 "Reply OK"）

### Phase 1 禁止事项（沿用 CLAUDE.md 红线）

- ❌ 不要做任何 IM adapter（Telegram/飞书/钉钉 = Phase 2+）
- ❌ 不要做 Computer Use（= Phase 6）
- ❌ 不要把项目变成 Codex CLI/TUI 输出 wrapper
- ❌ 不要默认绕过 approvals（client 层 default-reject 已强制；ApprovalBroker 必须显式 dispatch）
- ❌ 不要在 `@codex-im/app-server-client` 层硬编码 approval/server-request method 名
- ❌ 不要把 `AppServerClient` 改成可重启（违背 ONE-SHOT policy，client.ts JSDoc 已禁）

### Phase 1 必须先做的 spike / review

1. **新 plan**：`docs/superpowers/plans/YYYY-MM-DD-phase-1-runtime.md`（按 Phase 0 plan v2 同样格式）
2. **gstack `/plan-eng-review`** on Phase 1 plan
3. **Codex outside voice** on Phase 1 plan
4. **richer-prompt fixture spike**：在写 EventNormalizer 之前，先抓 1–2 个 scenario 的真实事件流

## Phase 2：Telegram MVP

### 目标

Telegram 私聊/群聊完成端到端。

### 任务

- [ ] Telegram adapter。
- [ ] ChannelAdapter abstraction。
- [ ] CommandRouter。
- [ ] SessionRouter。
- [ ] SQLite storage。
- [ ] RenderScheduler。
- [ ] Approval inline keyboard。

### 验收

- [ ] `/start`、`/projects`、`/new`、`/status`、`/stop` 可用。
- [ ] 普通消息启动 turn。
- [ ] streaming 通过 edit message 展示。
- [ ] approval 按钮可用。
- [ ] daemon 重启后绑定仍在。

## Phase 3：安全与审计

### 目标

形成可安心长期运行的本地服务。

### 任务

- [ ] 用户白名单/群白名单。
- [ ] project ACL。
- [ ] command deny patterns。
- [ ] audit log。
- [ ] secret redaction。
- [ ] approval timeout。
- [ ] launchd 安装脚本。

### 验收

- [ ] 非授权用户不能触发任务。
- [ ] deny pattern 无法绕过。
- [ ] 所有 approval 有 audit log。
- [ ] launchd 启停可用。

## Phase 4：飞书/Lark

### 目标

飞书长连接 + interactive card。

### 任务

- [ ] Lark adapter。
- [ ] message receive。
- [ ] send/reply text。
- [ ] interactive card render。
- [ ] card action callback -> ApprovalBroker。
- [ ] 卡片更新策略。

### 验收

- [ ] 群聊 mention bot 能触发 Codex。
- [ ] approval card 可 allow/deny。
- [ ] streaming/status card 可更新。

## Phase 5：钉钉

### 目标

钉钉 Stream 模式 + card callback。

### 任务

- [ ] DingTalk Stream client。
- [ ] bot receive message。
- [ ] card full update。
- [ ] approval buttons。
- [ ] reconnect。

### 验收

- [ ] 钉钉私聊/群聊至少一种可用。
- [ ] approval roundtrip 可用。
- [ ] 卡片全量更新频率受控。

## Phase 6：Computer Use

### 目标

通过 IM 安全触发 Codex App Computer Use。

### 任务

- [ ] `/cu` 命令。
- [ ] ComputerUsePolicy。
- [ ] prompt wrapping。
- [ ] app allowlist/denylist。
- [ ] sensitive step approval。
- [ ] 手动 smoke test 文档。

### 验收

- [ ] 无 `/cu` 不触发。
- [ ] `/cu` Chrome-only 测试成功。
- [ ] 敏感行为会停下来请求确认。
- [ ] audit log 记录 Computer Use 触发。

## Phase 7：扩展平台

### 目标

Satori/Koishi 或 Vercel Chat SDK 兼容层。

### 任务

- [ ] Satori adapter POC。
- [ ] Chat SDK adapter POC。
- [ ] 能力矩阵测试。
- [ ] fallback renderer。

### 验收

- [ ] 至少一个 Satori 平台能收发消息。
- [ ] 至少一个 Chat SDK 平台可运行。
- [ ] approval fallback 可用。

## Phase 8：Web Console 与团队能力

### 目标

可观察性和管理后台。

### 任务

- [ ] local web console。
- [ ] pending approvals dashboard。
- [ ] project/bindings 管理。
- [ ] logs/audit 浏览。
- [ ] health endpoints。

## 建议开发节奏

每个 phase 不超过一个开发分支。每个分支结束必须：

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- smoke test
- 更新文档
- Codex CLI 做一次独立 review
- Claude Code/gstack 做一次 release/doc review
