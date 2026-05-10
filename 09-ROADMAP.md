# 项目进度与里程碑

> ⚠️ **Historical roadmap.** 本文件中 Phase 编号（Phase 2 = Telegram MVP / Phase 3 = 安全与审计 / Phase 4 = Lark / …）是 v0 计划的 **历史快照**，已被各 phase 单独的 plan-of-record **superseded**。
>
> 实际执行后 Phase 编号已合并/位移：actual Phase 2 = "Approval & IM Surface"（broker 公开面 + 渲染 + fake e2e），actual Phase 3 = 本文 v0 Phase 2 + Phase 3 的合并体（Telegram MVP + production daemon + SecurityPolicy ACL + 持久化 SessionRouter + launchd）。后续 Phase 4+ 也会以实际 plan 为准而非本文。
>
> 当前 phase 状态请看：
>
> - **Per-phase 实施计划：** `docs/internal/superpowers/plans/`（最新 `2026-05-02-phase-3-plan.md` v2.4）
> - **当前 live status：** `docs/internal/handoffs/phase3-live-status.md`
> - **历史 phase live status：** `docs/internal/handoffs/phase{1,2}-live-status.md`（FROZEN）
> - **Phase 间 handoff：** `docs/internal/handoffs/<date>-phase{N}-to-phase{N+1}.md`
>
> 本文以下 Phase 0 / Phase 1 章节由后续 plan 实时回填为最终事实；Phase 2+ 章节保留作为 v0 历史 backlog 而非可执行 roadmap。

## 总体策略

先完成 App Server rich client 内核，再接 IM；先 Telegram 跑通端到端，再做飞书/钉钉；Computer Use 放在基础审批稳定之后。

## Phase 0：项目初始化与协议验证 ✅ 完成 2026-04-29

### 目标

建立 monorepo、协议生成、app-server smoke test。

### 任务

- [x] 初始化 pnpm workspace（commit `0629659`）
- [x] 创建 packages skeleton（codex-protocol/app-server-client/testkit/cli — Sections C–J）
- [x] 添加 TypeScript（5.9.3 strict + composite + verbatimModuleSyntax + exactOptionalPropertyTypes）、Vitest（4.1.5 with unit/contract projects）、Biome（1.9.4，commits `cbd44c7` `34119a0` `df05488`）
- [x] 实现 `protocol:generate` —— stable mode 不带 `--experimental`（empirical 决策见 `docs/internal/phase-0/codex-gen-diff.md`，commits `c1a1a08` `67d7928` `d9b61c5`）
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

- 实施计划：`docs/internal/superpowers/plans/2026-04-29-phase-0-bootstrap.md`
- 协议决策证据：`docs/internal/phase-0/host-environment.md`、`docs/internal/phase-0/codex-gen-diff.md`
- Codex outside-voice review 结果：见 plan v2 Decision Log + commit `dacbb29` `719a859` `380a988`

## Phase 1：Codex Runtime Core ✅ 完成 2026-05-01

> **入口文档**：`docs/internal/handoffs/2026-04-30-phase0-to-phase1.md` 是 Phase 1 启动的 single source of truth。Phase 1→2 交接见 `docs/internal/handoffs/2026-05-01-phase1-to-phase2.md`。

### 目标

无 IM 情况下完成 thread/turn/event/approval 内核。**extend/build on** Phase 0 stack（`@codex-im/protocol` + `@codex-im/app-server-client` + `@codex-im/testkit` + `@codex-im/cli`），不重写也不绕过。

### 任务

#### Phase 0 已完成的底层（Phase 1 在其上加层）

- [x] ~~AppServerClient 完整 request/notification/server request~~ — Phase 0 commits `2518692` `440467b`；Phase 1 加 typed wrappers (`f59205f` T8) + supervisor 重建 client (`e950613` T11a / `43223e8` T11b)
- [x] ~~FakeAppServer testkit + replayFixture~~ — commit `380a988` + `022c075` (含 `emitServerRequest.timeoutMs`)；Phase 1 扩展 ApprovalBroker round-trip 测试 (`e8d5c1a` T9a) + 真实 fixture 抓取 (`a4187fc` T4 + `8f0603d` T4.5)
- [x] ~~CLI `codex-im smoke app-server` / `smoke real-turn`~~ — commit `72d328f` + `fa05a5e`；Phase 1 新增 `codex-im runtime send` (`107af4a` T10) + `--capture` flag 用于 fixture 抓取

#### Phase 1 新建（all done）

- [x] ~~**`CodexRuntime` typed wrappers** over `client.request<R>(method, params)`~~ — `f59205f` T8 + `585235e` review fixes
- [x] ~~**`EventNormalizer`** ordered async iterator + terminal-state recognition + unknown-event fallthrough~~ — `649d631` T7a + `040b861` T7b-1 + `c4239c7` T7b-2 + `85cd22a` + `908d640` review fixes
- [x] ~~**`ApprovalBroker`** single server-request handler + 内部 method dispatch~~ — `f274aae` T9a skeleton + `e8d5c1a` per-method dispatch + `7a05598` coverage + `7fe48c6` review fix; `1ecb394` T9b reattach + `4798c02` timeout/throw + `decb570` D6 transport-loss + `bf97a49` grep guard + `e814880` B-clean blocker fix + `429fc2c` review fix
- [x] ~~**Daemon supervisor** ONE-SHOT lifecycle~~ — `e950613` T11a skeleton + `185b5e8` review fix; `43223e8` T11b close-handling edges + `a4e1bc4` review fix
- [x] ~~**`categorizeJsonRpcError(err)` helper**~~ — Phase 1 T1 commits (early on this branch)
- [x] ~~**richer wire fixtures**~~ — `a4187fc` T4 captured + `8f0603d` T4.5 acceptance gate ensures any future bump preserves the capture

#### Pre-prerequisites (mid-Phase-1 retrofits)

- [x] ~~Pre-1: Node 22→24 bump~~ — landed before Phase 1 implementation (Codex outside-voice triggered: Node 20 EOL 2026-04-30)
- [x] ~~Pre-2: `@codex-im/protocol` facade expansion~~ — landed before Phase 1 (Codex blocker B3)
- [x] ~~Pre-3: `AppServerClient` JsonRpcResponseError propagation~~ — `c96d36d` docs + `44e2623` code (mid-Phase-1; T9a's "method not in dispatch table" → -32601 needs the catch-arm extension)

### 验收

- [x] ~~单元测试覆盖 request correlation~~ — Phase 0 已覆盖
- [x] ~~unknown event 不崩溃~~ — Phase 0 + Phase 1 EventNormalizer reinforces (`unknown` arm in `CodexRichEvent` discriminated union)
- [x] ~~**Phase 1**: fake server 能模拟 approval round-trip~~ — `e8d5c1a` 9 per-method dispatch tests + `decb570` 6 pending-lifecycle tests
- [x] ~~**Phase 1**: `EventNormalizer` 单测覆盖所有相关 `ServerNotification` union arm~~ — T7a/T7b coverage + grep guard ensures method literals stay in packages/codex-runtime/
- [x] ~~**Phase 1**: `ApprovalBroker` 单测覆盖每个真实 server request method~~ — 9 happy-path + 9 default-reject + 2 dispatch-coverage + 4 reattach + 4 timeout/throw + 6 pending-lifecycle = 34+ broker tests
- [x] ~~**Phase 1**: `categorizeJsonRpcError` 单测覆盖 4 个关键字 + 默认 fallthrough~~ — T1 commit
- [x] ~~**Phase 1**: richer wire fixture replay 进 contract test~~ — T4 / T4.5 + dispatch test replays the captured fileChange request
- [x] ~~**Phase 1**: `smoke:real-turn` 用 richer prompt 跑通~~ — `--prompt-file packages/cli/src/prompts/richer-turn.txt --cwd /tmp/codex-fixture-spike` flow exercised in T4

### Phase 1 验收快照

- **Tag candidate:** `phase-1-runtime-complete` (to apply after this commit)
- **Branch:** `phase-1-runtime`
- **Test count:** 315 / 315 passing
- **Gates:** `bash scripts/ci-check.sh` 8/8 green
- **Codex outside-voice reviews captured (one per task):** docs/internal/phase-1/codex-review-{t5,t6,t7b,t8,t9a,t9b,t9b-blocker-fix,t10,t11a,t11b}.md — 10 review docs total. T9b's blocker-fix arc included a B-clean lifecycle redesign of ApprovalBroker after the first review found 2 blockers; the redesign is the load-bearing correctness work for Phase 1.
- **Plan-amendment retrofit count:** 3 mid-phase prerequisites (Pre-1 Node 24, Pre-2 protocol facade, Pre-3 AppServerClient JsonRpcResponseError) + 1 mid-phase blocker fix (T9b broker completion race). Each was triggered by a codex review finding and recorded in plan + TODOS.

### Phase 1 后续 deferred items（recorded in TODOS.md backlog）

- AppServerClient idempotent respond/reject (Pre-4-eligible defensive guardrail; declined as primary fix for T9b blocker per user 2026-05-01).
- T9b broker prune sweep for terminal records (memory hygiene under prolonged sessions).
- T11b synthetic per-pending-turn `turn_failed` events on transport-loss (T9b's `endOfStream` is the minimum-viable Phase 1 contract; per-turn synthesis is Phase 2 IM adapter scope).
- T11b grep-guard catches untracked files (currently uses `git grep` which only sees tracked content; bug discovered during T10 review).

### Phase 1 禁止事项（沿用 CLAUDE.md 红线）

- ❌ 不要做任何 IM adapter（Telegram/飞书/钉钉 = Phase 2+）
- ❌ 不要做 Computer Use（= Phase 6）
- ❌ 不要把项目变成 Codex CLI/TUI 输出 wrapper
- ❌ 不要默认绕过 approvals（client 层 default-reject 已强制；ApprovalBroker 必须显式 dispatch）
- ❌ 不要在 `@codex-im/app-server-client` 层硬编码 approval/server-request method 名
- ❌ 不要把 `AppServerClient` 改成可重启（违背 ONE-SHOT policy，client.ts JSDoc 已禁）

### Phase 1 必须先做的 spike / review

1. **新 plan**：`docs/internal/superpowers/plans/YYYY-MM-DD-phase-1-runtime.md`（按 Phase 0 plan v2 同样格式）
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
