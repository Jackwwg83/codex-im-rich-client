# 架构文档

## 1. 总体拓扑

```text
Telegram / 飞书 / 钉钉 / 其他 IM
          |
          v
+-------------------------------+
| codex-im-bridge daemon        |
|                               |
|  Channel Adapters             |
|    - telegram                 |
|    - lark                     |
|    - dingtalk                 |
|    - satori (P2)              |
|    - chat-sdk (P2)            |
|                               |
|  Channel Core                 |
|    - inbound normalizer       |
|    - outbound renderer        |
|    - card/button manager      |
|                               |
|  Product Core                 |
|    - session router           |
|    - command router           |
|    - approval broker          |
|    - security policy          |
|    - audit log                |
|                               |
|  Codex Runtime                |
|    - app-server client        |
|    - event normalizer         |
|    - turn state machine       |
|    - diff/plan cache          |
+-------------------------------+
          |
          | stdio JSONL
          v
+-------------------------------+
| codex app-server              |
|  - thread manager             |
|  - Codex core sessions        |
|  - tool/runtime integration   |
+-------------------------------+
          |
          v
Codex App / local workspace / MCP / Computer Use
```

## 2. 部署方式

P0 部署在 Mac mini 本机：

```text
Mac mini
  - Codex App installed and authenticated
  - codex CLI available in PATH
  - codex-im-bridge launchd daemon
  - SQLite db under ~/.codex-im-bridge/state.db
  - config under ~/.codex-im-bridge/config.toml
```

默认不开放任何 Codex 端口。IM adapter 主动连接 IM 平台，或通过平台 webhook/long polling/stream 获取消息。

## 3. 进程模型

### 推荐 P0

```text
codex-im-bridge parent process
  -> spawn child: codex app-server --listen stdio://
```

bridge 持有 child process 的 stdin/stdout，用 JSONL framing 通信。

### 可选 P1/P2

```text
codex-im-bridge
  -> connect ws://127.0.0.1:4500
```

仅用于本地调试或受控隧道。

## 4. 关键数据流

### 4.1 用户发起任务

```text
IM message
  -> ChannelAdapter.onMessage
  -> InboundNormalizer
  -> Authz.checkUserAndChat
  -> CommandRouter
  -> SessionRouter.resolve(project/thread)
  -> CodexRuntime.startTurn / steerTurn
  -> AppServerClient.request("turn/start")
```

### 4.2 Codex 流式输出

```text
app-server notification
  -> JsonRpcTransport
  -> CodexEventNormalizer
  -> RuntimeState.update
  -> RenderScheduler.coalesce
  -> ChannelRenderer.render
  -> ChannelAdapter.editMessage/sendCard
```

### 4.3 审批请求

```text
app-server server request
  -> ApprovalBroker.createPendingApproval
  -> SecurityPolicy.enrichDecisionOptions
  -> ChannelRenderer.renderApprovalCard
  -> IM buttons
  -> ChannelAdapter.onAction
  -> ApprovalBroker.resolve
  -> AppServerClient.respond(requestId, decision)
```

### 4.4 中断任务

```text
/stop
  -> CommandRouter
  -> SessionRouter.getActiveTurn
  -> AppServerClient.request("turn/interrupt")
  -> RuntimeState.markInterrupted
  -> ChannelRenderer.renderStatus
```

## 5. 边界划分

### Codex App Server Client 层

负责：

- JSONL framing
- request id correlation
- server notification dispatch
- server-initiated request handling
- reconnect/restart
- protocol type binding

不负责：

- IM 渲染
- 安全策略
- session 绑定

### Runtime 层

负责：

- thread/turn state
- active item map
- diff/plan/token usage cache
- pending approvals
- event log

不负责：

- app-server transport 细节
- 平台卡片格式

### Product Core 层

负责：

- ACL
- project binding
- command parsing
- approval policy
- Computer Use safety
- audit log

### Channel 层

负责：

- 平台收消息
- 平台发消息/编辑消息/卡片/按钮
- 平台 callback ack
- 文件上传下载
- markdown/plain text 转换

## 6. Rich render model

Codex rich event 先归一化为平台无关模型：

```ts
type RichBlock =
  | { type: "text"; text: string; markdown?: boolean }
  | { type: "status"; title: string; fields: Record<string, string> }
  | { type: "approval"; approvalId: string; title: string; body: string; actions: ApprovalAction[] }
  | { type: "diffSummary"; files: string[]; summary: string }
  | { type: "command"; cwd?: string; command: string; status: "pending" | "running" | "done" | "failed" }
  | { type: "plan"; steps: PlanStep[] };
```

Renderer 根据平台能力降级：

| 能力 | Telegram | 飞书 | 钉钉 | Satori/Koishi |
|---|---|---|---|---|
| 编辑消息 | 支持 | 支持 | 视卡片能力 | 视平台 |
| 按钮 | inline keyboard | interactive card | interactive card | 视平台 |
| 富卡片 | 基础 | 强 | 强 | 中 |
| 长文本 | 需切分 | 较好 | 需切分 | 视平台 |
| 文件附件 | 支持 | 支持 | 支持 | 视平台 |

## 7. 可靠性设计

- App Server child 退出：记录原因，指数退避重启。
- IM adapter 断线：adapter 自己 reconnect，Core 不丢 pending state。
- SQLite WAL：减少 daemon 崩溃后的数据损坏。
- Event log：所有 raw events 和 normalized events 可采样记录。
- At-least-once message handling：IM 重复事件用 platform message id 去重。
- Approval timeout：超时后默认 decline 或 require re-request，禁止自动 allow。

## 8. Backpressure

- agentMessage delta 做 coalescing：1-2 秒更新一次。
- stdout/stderr 做 ring buffer：默认保留最后 N KB，完整日志可写文件。
- 同一 chat 同时只允许一个 active turn，除非明确 `/new` 或 `/fork`。
- Codex App Server overload 错误走 retry with jitter。

## 9. 扩展架构

### P2 Web Console

```text
Browser -> local web console -> Core API -> SQLite + RuntimeState
```

功能：

- pending approvals dashboard
- recent threads
- logs
- project config editor
- smoke test runner

### P2 Multi Runtime

```text
RuntimeManager
  - local-macmini
  - remote-devbox-1
  - remote-devbox-2
```

每个 runtime 有独立 AppServerClient、config、project root、security policy。
