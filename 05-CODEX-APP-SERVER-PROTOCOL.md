# Codex App Server 协议接入设计

## 1. 协议原则

App Server 使用 JSON-RPC lite：请求/响应/通知形态类似 JSON-RPC 2.0，但 wire 上省略 `jsonrpc: "2.0"`，stdio 使用 JSONL framing。client 必须支持：

- client -> server request
- client -> server notification
- server -> client notification
- server -> client request，例如 approval
- request id correlation
- long-running event stream

## 2. 初始化流程

```text
spawn codex app-server
  -> send initialize
  <- initialize response
  -> send initialized notification
  -> account/read 或必要的 capability discovery
  -> ready
```

伪代码：

```ts
await client.start();
await client.request("initialize", {
  clientInfo: {
    name: "codex-im-bridge",
    version: pkg.version,
  },
});
client.notify("initialized");
```

## 3. Thread/Turn 生命周期

### 新 thread

```text
thread/start
  <- thread/started notification
turn/start
  <- turn/started
  <- item/started
  <- item/... deltas
  <- item/completed
  <- turn/completed
```

### 恢复 thread

```text
thread/resume
  -> RuntimeState hydrate
  -> bind target -> threadId
```

### active turn 中追加输入

```text
turn/steer
```

### 中断

```text
turn/interrupt
```

## 4. 事件归一化

### Raw -> Normalized

```ts
export type CodexRichEvent =
  | { type: "thread_started"; threadId: string; title?: string }
  | { type: "turn_started"; threadId: string; turnId: string }
  | { type: "assistant_delta"; threadId: string; turnId: string; itemId: string; text: string }
  | { type: "assistant_message_completed"; threadId: string; turnId: string; itemId: string; text: string }
  | { type: "command_started"; threadId: string; turnId: string; itemId: string; command: string; cwd?: string }
  | { type: "command_output"; threadId: string; turnId: string; itemId: string; stream: "stdout" | "stderr"; text: string }
  | { type: "command_completed"; threadId: string; turnId: string; itemId: string; exitCode?: number }
  | { type: "file_change"; threadId: string; turnId: string; itemId: string; files: string[]; summary?: string }
  | { type: "diff_updated"; threadId: string; turnId: string; files: string[]; summary?: string }
  | { type: "plan_updated"; threadId: string; turnId: string; steps: PlanStep[] }
  | { type: "review_updated"; threadId: string; reviewId: string; summary: string }
  | { type: "approval_requested"; approval: ApprovalRecord }
  | { type: "approval_resolved"; approvalId: string; decision: ApprovalDecision }
  | { type: "turn_completed"; threadId: string; turnId: string; status: TurnStatus; summary?: string }
  | { type: "unknown"; method: string; params: unknown };
```

## 5. Approval flow

App Server 可能以 server request 的形式请求审批。bridge 必须暂停对应 approval，渲染到 IM，并在用户按钮回调后对同一个 request id 返回结果。

### 数据流

```text
server request approval
  -> create approval record
  -> send approval card
  -> user click allow_once / allow_session / deny / cancel
  -> resolve approval
  -> client.respond(serverRequestId, decision)
```

### 决策枚举

```ts
type ApprovalDecision =
  | "allow_once"
  | "allow_session"
  | "deny"
  | "cancel";
```

### 超时策略

- 默认 30 分钟过期。
- 过期不自动 allow。
- 若 App Server 还在等待，返回 deny 或 cancel，具体取决于 request 类型。
- 在 IM 中提示“审批已过期，请重新发起任务或让 Codex 重试”。

## 6. Command execution 渲染

### 开始

```text
正在请求执行命令
cwd: /path/to/project
cmd: pnpm test
reason: 验证修复是否通过
```

### 运行中

- 显示 elapsed time。
- stdout/stderr 只显示 tail。
- full output 写入临时文件，P1 支持作为附件发送。

### 完成

```text
命令完成
exit code: 0
stdout tail: ...
```

## 7. File change 渲染

- P0：展示文件列表 + summary。
- P1：展示 diff summary + 可下载 full diff。
- P2：在支持的平台上展示 collapsible diff card。

## 8. Unknown event 策略

任何未知 event：

- 写入 event_log。
- 如果有关联 thread/turn，附加到 runtime timeline。
- 不导致进程崩溃。
- 在 debug 模式下可通过 `/debug last-events` 查看。

## 9. 协议生成策略

```bash
codex app-server generate-ts --out packages/codex-protocol/src/generated
codex app-server generate-json-schema --out packages/codex-protocol/schema
```

建议脚本：

```json
{
  "scripts": {
    "protocol:generate": "rm -rf packages/codex-protocol/src/generated packages/codex-protocol/schema && codex app-server generate-ts --out packages/codex-protocol/src/generated && codex app-server generate-json-schema --out packages/codex-protocol/schema",
    "protocol:check": "pnpm protocol:generate && git diff --exit-code packages/codex-protocol"
  }
}
```

## 10. App Server smoke test

P0 必须实现一个最小 smoke test：

```bash
pnpm smoke:app-server
```

流程：

1. spawn `codex app-server`。
2. initialize。
3. initialized。
4. account/read 或轻量 request。
5. thread/start。
6. turn/start 一个无害 prompt，例如“只回复 OK，不运行命令”。
7. 收到 turn/completed。
8. shutdown。

## 11. 防止协议漂移

- 生成类型与本地 Codex 版本绑定。
- 每次升级 Codex 后跑 contract tests。
- 不在业务里硬编码过多 raw event 字段；用 normalizer 集中处理。
- unknown event 要可观察。
- 对 approval request 保留 raw payload，便于升级适配。
