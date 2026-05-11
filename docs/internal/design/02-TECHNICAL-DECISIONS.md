# 技术决策文档

## 1. 总体结论

采用“核心自研 + 平台 adapter 可替换”的方案。

```text
自研：Codex App Server client、runtime state、event normalizer、approval broker、security、session router、render model。
复用：各 IM 平台官方 SDK 或成熟 adapter。
不采用：把 Vercel AI SDK / 普通 chat completion abstraction 作为核心。
```

## 2. App Server 连接方式

### 决策

P0 使用 stdio 方式启动 `codex app-server`：

```text
bridge daemon -> spawn("codex", ["app-server", "--listen", "stdio://"])
```

### 原因

- stdio 是默认、最稳定的本地 rich client 连接方式。
- App Server 的 WebSocket transport 当前适合实验或受控远程，不建议 P0 生产依赖。
- daemon 与 App Server 同机运行，外部只连接 IM 平台，不需要暴露本地端口。

### 后续

P2 可以支持：

- `stdio`：默认。
- `ws://127.0.0.1:<port>`：本机调试。
- SSH tunnel / Tailscale / VPN：远程 workspace。

## 3. 语言与运行时

### 决策

使用 TypeScript + Node.js + pnpm workspace。

### 原因

- Codex App Server 可生成 TypeScript schema。
- Telegram、飞书、钉钉 SDK 都有 Node.js 生态。
- Claude Code 和 Codex CLI 都很适合维护 TypeScript monorepo。

## 4. 数据存储

### 决策

P0 使用 SQLite + WAL。

### 原因

- Mac mini 本地 daemon，不需要一开始上 PostgreSQL。
- session/thread/approval/audit 都适合关系型表。
- SQLite 便于备份、迁移和测试。

### 后续

P2 可以抽象 `Storage` interface，支持 PostgreSQL。

## 5. IM 接入框架选择

### 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 完全从头写 | 最可控，高保真 | 重复造轮子，IM API 维护成本高 | 不推荐作为全部策略 |
| Vercel Chat SDK | Slack/Discord/Teams/Telegram 等通用 bot 抽象强，状态和 adapter 机制完整 | 对飞书/钉钉支持不足；较新；抽象可能压扁 Codex rich events | 作为后续 Slack/Discord/Teams adapter 候选 |
| Koishi/Satori | 中文 IM 和长尾平台覆盖强，DingTalk/Lark/Telegram/WeCom/QQ 等生态完整 | rich card/approval 高保真可能被统一协议限制；多一层运行时 | 作为 P2 兼容层，不作为 P0 核心 |
| Native SDK | 飞书/钉钉/Telegram 能最大化保留平台能力 | 需要自己维护 adapter abstraction | P0/P1 推荐 |

### 最终决策

- P0：Telegram 使用 grammY 或原生 Bot API adapter。
- P1：飞书使用 `@larksuiteoapi/node-sdk` 的 WSClient/Channel 能力。
- P1：钉钉使用官方 Stream SDK。
- P2：Satori/Koishi adapter 用来覆盖长尾平台。
- P2：Vercel Chat SDK 可用于 Slack/Discord/Teams/GitHub/Linear/WhatsApp 等平台。

## 6. 为什么核心不能交给 Chat SDK / Koishi / Satori

Codex App Server 的核心事件是 thread/turn/item/diff/approval，不是普通 chat message。

需要保留：

- turn lifecycle
- item lifecycle
- agent message delta
- command execution item
- file change item
- mcp tool call item
- diff update
- plan update
- review result
- server-initiated approval request
- interrupt / steer

普通 bot abstraction 更适合收发消息和卡片，不适合作为 Codex runtime 的状态机。因此核心必须自研，只把 IM 平台作为 I/O adapter。

## 7. Computer Use 策略

### 决策

Computer Use 只通过显式命令触发：

```text
/cu <task>
/computer-use <task>
```

默认拒绝普通自然语言隐式触发。

### 原因

Computer Use 能操作桌面和已登录的浏览器/应用，风险显著高于 shell/file edit。必须单独做：

- app allowlist
- denylist
- explicit prefix
- sensitive step approval
- audit log

## 8. Codex CLI 在本项目里的角色

目标产品不依赖 Codex CLI/TUI 输出。但开发流程可以使用 Codex CLI：

- `codex app-server generate-ts` 生成协议类型。
- `codex debug app-server ...` 做本地协议观察。
- Codex Exec / CLI 用于独立 code review、测试设计、bug 定位。
- 不把 Codex CLI/TUI 作为运行时 UI。

## 9. 版本与兼容性策略

- 每次升级本机 Codex 后，运行 `codex app-server generate-ts --out packages/codex-protocol/src/generated`。
- 提交生成后的 protocol artifacts。
- 对 unknown event 做结构化日志，不 panic。
- 加 contract tests，确保关键字段和 event mapping 未破坏。

## 10. 最小可用技术栈

```text
Runtime: Node.js 24+ (Active LTS; Node 20 EOL 2026-04-30)
Language: TypeScript
Package: pnpm workspace
DB: SQLite + better-sqlite3 or libsql
Logger: pino
Config: zod + TOML/YAML
Telegram: grammY
Lark/Feishu: @larksuiteoapi/node-sdk
DingTalk: dingtalk-stream (Phase 5 plan pins stable `^2.1.5`; older
`dingtalk-stream-sdk-nodejs` references describe the upstream SDK repository
lineage, not the preferred npm package name)
Testing: vitest + tsx + nock/mock server
Process: launchd on macOS
```
