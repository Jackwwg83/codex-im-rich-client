# Codex IM Rich Client

基于 Codex App Server 的 IM rich client。Mac mini 上常驻 daemon，通过 Telegram/飞书/钉钉等 IM 远程控制 Codex，**保留 thread/turn、流式事件、命令执行、文件变更、review、approval、Computer Use 等结构化 rich event，不降维成普通 chat completion**。

**Phase 0 状态**：✅ 完成（2026-04-29）。bottom-up vertical slice 已端到端跑通真 codex 0.125.0。详见 `docs/superpowers/plans/2026-04-29-phase-0-bootstrap.md` + `docs/phase-0/`。

**Phase 1 状态**：✅ 完成（2026-05-01）。Codex Runtime Core — 无 IM 情况下完成 thread/turn/event/approval 内核。三个新包：
- `@codex-im/codex-runtime` — `CodexRuntime` typed wrappers + `EventNormalizer` (single-FIFO + class-aware walk-and-drop overflow)
- `@codex-im/core` — `ApprovalBroker` with B-clean single-completion-promise lifecycle (race-free across handler / expirePending / failPendingAsTransportLost)
- `@codex-im/daemon` — `Supervisor` with ONE-SHOT lifecycle, exponential-backoff recovery (500ms → 1s → 2s → 4s → 8s), halt-on-spawn-failure

10 codex outside-voice review reports under `docs/phase-1/` plus a tag-gate re-review. 测试数 73 → 320 (315 at T12 close + 5 from tag-gate fix arc: Supervisor cleanup + ClientRequest grep guard). 详见 `docs/superpowers/plans/2026-04-30-phase-1-runtime.md` + `docs/handoffs/2026-05-01-phase1-to-phase2.md`.

**Phase 3 状态**：✅ 完成（2026-05-02）。Telegram MVP + production daemon wire-up + SecurityPolicy ACL + persistent SessionRouter + launchd/ops/smoke slice 已通过 JAC-64 / T39-T40 tag gate。**当前 single source of truth：[`docs/handoffs/phase3-live-status.md`](docs/handoffs/phase3-live-status.md)，Phase 3 → Phase 4 交接见 [`docs/handoffs/2026-05-02-phase3-to-phase4.md`](docs/handoffs/2026-05-02-phase3-to-phase4.md)。**

**Phase 4 状态**：✅ 完成（2026-05-02）。Feishu/Lark native adapter 已通过 JAC-162 review/handoff/tag gate，包含 long-connection receive、text/card send/update、opaque callback action、fake smoke、env-gated live smoke。**Phase 4 closeout：[`docs/handoffs/phase4-live-status.md`](docs/handoffs/phase4-live-status.md)，Phase 4 → Phase 5 交接见 [`docs/handoffs/2026-05-02-phase4-to-phase5.md`](docs/handoffs/2026-05-02-phase4-to-phase5.md)。**

**Phase 5 状态**：✅ 完成（2026-05-02）。DingTalk Stream adapter 已通过 JAC-90 review/handoff/tag gate，包含 Stream receive、card send/update、opaque callback action、adapter-level Stream ack、duplicate robot delivery suppression、fake smoke、env-gated live smoke。**Phase 5 closeout：[`docs/handoffs/phase5-live-status.md`](docs/handoffs/phase5-live-status.md)，Phase 5 → Phase 6 交接见 [`docs/handoffs/2026-05-02-phase5-to-phase6.md`](docs/handoffs/2026-05-02-phase5-to-phase6.md)。**

**Phase 6 状态**：🟡 实现中（2026-05-03）。Computer Use 只允许显式 `/cu` / `/computer-use`；JAC-92–JAC-98 core safety/audit boundary 已完成，当前进入 JAC-99 fake/manual smoke docs。SOT：[`docs/handoffs/phase6-live-status.md`](docs/handoffs/phase6-live-status.md)，计划：[`docs/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md`](docs/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md)。

**Phase 2 状态**：✅ 实现完成（2026-05-02）。Approval & IM Surface — broker 公开面、平台无关渲染、fake e2e。两个新包 + Phase 1 包扩展：
- `@codex-im/render` — `RichBlock` (text/approval/unknown) + `ApprovalCard` + `projectAsRichBlock` (per-`ApprovalRequestKind`，零协议 method 字面量) + `formatPlainText` (capability fallback) + `truncate` + `redact` (re-export from core)
- `@codex-im/channel-core` — closed `ChannelAdapter` 接口 (D14) + `TelegramShapeFakeChannelAdapter` (callback_data ≤62B + 60s answerCallbackQuery deadline + parse_mode unsupported, all cited from Telegram Bot API)
- `@codex-im/core` 扩展：`enablePendingMode<M>` (D18 三模式 dispatcher) + `bindActorPolicy` (D19 per-card actor 绑定) + `resolve()` (happy + 9 `ResolveError` 分支 + lazy expiry + actor validation) + `actionToDecision` + `mapDecisionForPending` (D11 per-kind wire 映射) + `AuditEmitter` (D13 12 个枚举 kind) + `redact` 14 patterns + `isAttached()` + `approvalTtlMs` 构造函数选项

测试数 320 → 720 (+400 across approval surface + render + channel-core + e2e)。9 个包 (Phase 1 7 → +render +channel-core)。详见 `docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md` + `docs/handoffs/2026-05-02-phase2-to-phase3.md`. 后续实际 Phase 3 已合并 Telegram MVP + production daemon + SecurityPolicy ACL 并进入 tag gate。

> ⚠️ **Production = Supervisor; runtime-send = dev/operator only.** Daemon 生产入口必须先 `broker.attach()` 再交给 `Supervisor`。`runtime-send` smoke 是 dev/operator 工具，不是产品入口。Codex Q6 / D16 / T22 invariant fires at `Supervisor.#spawnFresh` head if broker isn't pre-attached.

## Phase 0 quick start

```bash
# 0. 装运行时（一次性，不在 repo 范围）
node --version    # need >=24 (Node 20 EOL 2026-04-30; bumped in chore/node-24-bump)
pnpm --version    # need >=10
codex --version   # need 0.128.0 (pinned in CODEX_VERSION)

# 1. 安装依赖 + 验证版本闸
pnpm install
pnpm check:codex-version       # OK: 0.128.0

# 2. 重新生成协议（已经 commit 过；只在 codex 升级时跑）
pnpm protocol:generate         # 488 TS + 227 schema 入 packages/codex-protocol/

# 3. 全量验证
pnpm typecheck                 # all 14 packages
pnpm test                      # 1204 tests pass + 1 skipped (unit + contract)
pnpm lint                      # biome check

# 4. 操作员手动 smoke (非默认测试)
CODEX_SMOKE=1 pnpm smoke:app-server      # initialize-only, 安全
CODEX_REAL_SMOKE=1 pnpm smoke:real-turn  # 真模型调用 ~$0.01，请先确认 codex login 与配额
CODEX_REAL_SMOKE=1 pnpm runtime:send -- --prompt 'Reply OK'   # Phase 1 runtime kernel smoke
pnpm smoke:dingtalk-fake       # Phase 5 fake DingTalk daemon smoke, no network / no credentials
pnpm smoke:dingtalk-live       # Phase 5 live harness default skip unless DINGTALK_LIVE=1
```

## Phase 0 安全边界

详见 `packages/cli/README.md`。要点：

- 默认 `pnpm test` 永不 spawn `codex app-server` 子进程
- `pnpm smoke:*` 全部 env-gated，明确开关后才跑
- `smoke:real-turn` 锁死 `sandbox=read-only` + `approval_policy=on-request` + 客户端 default-reject 所有 server request
- `pnpm check:codex-version` 在 codex 升级时 fail-stop，强制 review 生成产物 + 重新捕获 wire fixtures

## Repo 结构

```
packages/
  codex-protocol/      generated TS + JSON schema (codex 0.128 stable, no --experimental)
  app-server-client/   JSONL + JSON-RPC lite + Transport iface + StdioTransport + handshake + AppServerClient
  testkit/             InMemoryTransport + FakeAppServer + replayFixture + codex-0.125 wire fixtures
  cli/                 codex-im smoke / runtime / ops commands
  storage-sqlite/      SQLite migrations + repositories
  config/              TOML/zod config + env secret resolver
  render/              IM-rich projection and plain-text fallback
  channel-core/        platform-neutral ChannelAdapter contract
  im-telegram/         real Telegram adapter package
  im-lark/             real Feishu/Lark adapter package
  daemon/              production-shaped daemon / supervisor / status
docs/
  handoffs/            phase live-status + phase-to-phase handoffs
  phase-*/             review evidence and implementation reports
  superpowers/plans/   phase plans-of-record
scripts/
  check-codex-version.mjs  3-way version gate
  canonicalize-schema.mjs  deterministic JSON schema sort
```

## 文档蓝图（原始包）

### 推荐阅读顺序

1. `01-PRD.md`：产品目标、用户故事、范围与验收标准。
2. `02-TECHNICAL-DECISIONS.md`：关键技术选型，尤其是 Chat SDK、Koishi/Satori、native adapter 的取舍。
3. `03-ARCHITECTURE.md`：整体架构、部署拓扑、数据流、核心边界。
4. `04-MODULE-DESIGN.md`：分模块设计。
5. `05-CODEX-APP-SERVER-PROTOCOL.md`：App Server 协议接入策略、事件归一化、审批流。
6. `06-IM-ADAPTERS.md`：Telegram、飞书、钉钉、Satori/Koishi、Vercel Chat SDK 的接入方式。
7. `07-SECURITY-AND-COMPUTER-USE.md`：权限、审批、安全边界、Computer Use 风险控制。
8. `08-DATA-MODEL.md`：SQLite 表结构与状态模型。
9. `09-ROADMAP.md`：MVP 到可用版本的迭代计划。
10. `10-CLAUDE-CODE-CODEX-WORKFLOW.md`：如何使用 Claude Code + gstack + Superpowers + Codex CLI 完成本项目开发。
11. `11-TESTING-AND-QA.md`：测试矩阵、模拟 App Server、真实 smoke test。
12. `12-OPERATIONS.md`：Mac mini 常驻运行、launchd、日志、监控、备份。
13. `13-IMPLEMENTATION-SKELETON.md`：建议目录结构、接口、配置、脚本。
14. `CLAUDE.md`：可以直接复制到项目根目录的 Claude Code 项目说明。
15. `.claude/commands/*`：建议创建的 Claude Code 自定义命令草案。

## 一句话架构

```text
IM 平台
  -> 本地 codex-im-bridge daemon
  -> Codex App Server JSON-RPC client
  -> codex app-server / Codex App runtime / Computer Use
  -> Codex events, approval requests, diffs, status cards
  -> IM rich UI
```

## 核心原则

- App Server rich client 核心自研，不套普通 LLM chat 框架。
- IM 平台接入不完全从零写：Telegram 用 grammY 或原生 Bot API；飞书用官方 Node SDK；钉钉用官方 Stream SDK；Satori/Koishi 作为长尾平台兼容层；Vercel Chat SDK 作为 Slack/Discord/Teams 等后续适配候选。
- 默认 stdio 连接 `codex app-server`，不要公网暴露 App Server。
- 所有敏感操作必须走 approval broker，Computer Use 必须有更严格的二次安全策略。
- Claude Code 是主开发入口；Codex CLI 用于协议生成、独立 review、非交互验证和 App Server smoke test。

## 补充：第一次 AI 协作操作手册

本 v2 文档包新增：

- `14-OPERATION-GUIDE-AND-PROMPTS.md`：完整开发操作指南。
- `15-PHASE-BY-PHASE-PROMPTS.md`：Phase 0-8 的 Claude Code / Codex CLI 提示词。
- `16-CODEX-CLI-PROMPTS.md`：Codex CLI 独立验证、review、debug、测试生成提示词。
- `17-CLAUDE-CODE-RUNBOOK.md`：Claude Code 日常 session runbook。
- `18-HOOKS-AND-GUARDRAILS.md`：hooks 与安全 guardrails 建议。
- `prompts/`：可复制提示词库。
- `hooks/`：stop check 脚本草案。
- `.claude/commands/`：更完整的项目 slash commands。
