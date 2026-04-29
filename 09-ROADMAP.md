# 项目进度与里程碑

## 总体策略

先完成 App Server rich client 内核，再接 IM；先 Telegram 跑通端到端，再做飞书/钉钉；Computer Use 放在基础审批稳定之后。

## Phase 0：项目初始化与协议验证

### 目标

建立 monorepo、协议生成、app-server smoke test。

### 任务

- [ ] 初始化 pnpm workspace。
- [ ] 创建 packages skeleton。
- [ ] 添加 TypeScript、Vitest、ESLint/Prettier 或 Biome。
- [ ] 实现 `protocol:generate`。
- [ ] 实现 JSONL transport 最小版本。
- [ ] 实现 `smoke:app-server`。

### 验收

- [ ] `codex app-server generate-ts` 产物进入 repo。
- [ ] smoke test 可以 initialize 并完成一个无害 turn。
- [ ] CI/local `pnpm test typecheck lint` 可运行。

## Phase 1：Codex Runtime Core

### 目标

无 IM 情况下完成 thread/turn/event/approval 内核。

### 任务

- [ ] AppServerClient 完整 request/notification/server request。
- [ ] CodexRuntime 状态机。
- [ ] EventNormalizer。
- [ ] ApprovalBroker。
- [ ] FakeAppServer testkit。
- [ ] CLI 命令：`codex-im smoke app-server`、`codex-im runtime send`。

### 验收

- [ ] 单元测试覆盖 request correlation。
- [ ] fake server 能模拟 approval。
- [ ] unknown event 不崩溃。

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
