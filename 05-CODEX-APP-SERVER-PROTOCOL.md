# Codex App Server 协议接入设计

> **Phase 0 status**: pinned to `codex-cli 0.125.0` (stable surface, no `--experimental`). All wire facts in this doc were verified by Phase 0 wire spike — see `docs/phase-0/host-environment.md`. When codex upgrades, `pnpm check:codex-version` fails until this doc + `packages/codex-protocol` regeneration are reviewed in lockstep.

## 1. 协议原则

App Server 使用 JSON-RPC lite：请求/响应/通知形态类似 JSON-RPC 2.0，但 wire 上**省略 `jsonrpc: "2.0"` 字段**（Phase 0 wire spike case 1 验证），stdio 使用 JSONL framing。client 必须支持：

- client -> server request
- client -> server notification
- server -> client notification
- server -> client request — approvals / tool calls / elicitation / chatgpt-token-refresh
- request id correlation（id 类型为 `number | string`，server 原样回显，wire spike case 1+2 验证）
- long-running event stream

### 1.1 错误形态（codex 0.125 实测）

```text
{ "id": <id>, "error": { "code": <int>, "message": <string> } }
```

- **`error.data` 字段在 0.125 上不存在**。client 类型把它定义为 `data?: unknown` 做向前兼容防御。
- **`error.code = -32600` 是重载值**：codex 同时用它表示 `unknown method` 和 `invalid params`（wire spike case 3+4 验证）。client 必须读 `error.message` 关键字才能区分：
  - `"unknown variant"` → 方法名不存在
  - `"missing field"` / `"invalid type"` / `"unknown field"` → 参数 shape 错
  - 其他 → 暂归 `"unknown"`
  - **Phase 1**：实现 `categorizeJsonRpcError(err)` helper（TODOS.md）。

### 1.2 stderr 处理

`codex app-server` 子进程会向 **stderr** 写带 ANSI 色码的 tracing log。malformed JSON 输入也只走 stderr，不返回 JSON-RPC error response（wire spike case 5）。client `StdioTransport` 必须把 stderr 当 plaintext，**永远不要尝试 JSON 解析**。

## 2. 初始化流程

```text
spawn codex app-server --listen stdio://
  -> client.request("initialize", { clientInfo })
  <- { id, result: InitializeResponse }
  -> client.notify("initialized")
  -> ready
```

**`ClientInfo` 真实 shape**（`packages/codex-protocol/src/generated/ClientInfo.ts`）：

```ts
type ClientInfo = {
  name: string,
  title: string | null,    // 必填，nullable，非 optional
  version: string,
};
```

**`InitializeResponse` 真实 shape**（生成自 ts-rs，不是 `InitializeResult`！）：

```ts
type InitializeResponse = {
  userAgent: string,         // 富信息：name/version/OS/arch/terminal
  codexHome: AbsolutePathBuf, // alias for `string`，server 的 $CODEX_HOME 绝对路径
  platformFamily: string,    // "unix" | "windows"
  platformOs: string,        // "macos" | "linux" | "windows"
};
```

> **注意**：旧文档可能写 `platform`（单字段）。实际是 `platformFamily` + `platformOs` 拆分。

伪代码（Phase 0 实际就这么写）：

```ts
import { performInitializeHandshake } from "@codex-im/app-server-client";
import type { ClientInfo } from "@codex-im/protocol";

await client.start();
const init: InitializeResponse = await performInitializeHandshake(client, {
  name: "codex-im-bridge",
  title: null,
  version: pkg.version,
});
// performInitializeHandshake 内部 await client.request("initialize", { clientInfo })
// 然后 client.notify("initialized")，最后返回 typed result。
```

## 3. Thread/Turn 生命周期

### 客户端方法（`ClientRequest` 摘录，0.125 stable）

| 方法 | 用途 |
|---|---|
| `thread/start` | 新 thread。`ThreadStartParams` 全可选；空对象 `{}` 接受 |
| `thread/resume` | 恢复 thread |
| `thread/fork` | 从某个 thread 分叉 |
| `thread/archive` / `thread/unarchive` | 归档 |
| `thread/list` / `thread/loaded/list` / `thread/read` | 查询 |
| `thread/turns/list` | 列 thread 的 turn 历史 |
| `thread/inject_items` | 注入历史 item |
| `thread/compact/start` | 压缩 |
| `thread/shellCommand` | 直接发 shell 命令（非 turn） |
| `thread/approveGuardianDeniedAction` | 解除 guardian 阻止 |
| `thread/rollback` | 回滚 |
| `turn/start` | 启动 turn。需要 `threadId` + `input: Array<UserInput>` |
| `turn/steer` | 给 active turn 追加输入 |
| `turn/interrupt` | 中断 active turn |
| `review/start` | 启动代码 review |

### `UserInput` shape（tagged union）

```ts
type UserInput =
  | { type: "text", text: string, text_elements: Array<TextElement> }  // text_elements 是必填空数组
  | { type: "image", url: string }
  | { type: "localImage", path: string }
  | { type: "skill", name: string, path: string }
  | { type: "mention", name: string, path: string };
```

### 典型 turn 流（事件序列，从 `ServerNotification` 摘录）

```text
client.request("turn/start", { threadId, input: [{ type:"text", text, text_elements:[] }] })
  <- response: { id, result: { turn: Turn } }

# server side notifications stream:
  <- "turn/started"                                    TurnStartedNotification
  <- "item/started"                                    ItemStartedNotification
  <- "item/agentMessage/delta"                         AgentMessageDeltaNotification (流式)
  <- "item/reasoning/textDelta" (可能)                 ReasoningTextDeltaNotification
  <- "item/commandExecution/outputDelta" (可能)        CommandExecutionOutputDeltaNotification
  <- "item/fileChange/outputDelta" (可能)              FileChangeOutputDeltaNotification
  <- "item/fileChange/patchUpdated"                    FileChangePatchUpdatedNotification
  <- "item/completed"                                  ItemCompletedNotification
  <- "turn/completed"                                  TurnCompletedNotification (terminal)

# 同时可能出现的特殊通知:
  "turn/diff/updated"               TurnDiffUpdatedNotification
  "turn/plan/updated"               TurnPlanUpdatedNotification
  "thread/tokenUsage/updated"       ThreadTokenUsageUpdatedNotification
  "warning"                         WarningNotification (例如 chronicle 警告)
  "error"                           ErrorNotification
  "guardianWarning"                 GuardianWarningNotification
```

完整 notification 列表见 `packages/codex-protocol/src/generated/ServerNotification.ts`（44 种 notification method）。

### 中断

```text
client.request("turn/interrupt", { threadId, turnId? })
```

## 4. Server-initiated requests（approvals / tool calls / elicitation）

`codex app-server` 可以从 server 端发起 request。**真实 method 名**（见 `packages/codex-protocol/src/generated/ServerRequest.ts`）：

| Method | Params type | 用途 |
|---|---|---|
| `item/commandExecution/requestApproval` | CommandExecutionRequestApprovalParams | shell 命令执行审批（v2，新形态）|
| `item/fileChange/requestApproval` | FileChangeRequestApprovalParams | 文件变更审批（v2）|
| `item/permissions/requestApproval` | PermissionsRequestApprovalParams | 权限策略审批（v2）|
| `item/tool/requestUserInput` | ToolRequestUserInputParams | tool 要求用户输入 |
| `item/tool/call` | DynamicToolCallParams | 动态 tool call |
| `mcpServer/elicitation/request` | McpServerElicitationRequestParams | MCP server 询问 |
| `applyPatchApproval` | ApplyPatchApprovalParams | apply-patch 审批（legacy） |
| `execCommandApproval` | ExecCommandApprovalParams | shell 命令审批（legacy）|
| `account/chatgptAuthTokens/refresh` | ChatgptAuthTokensRefreshParams | ChatGPT auth token 刷新 |

> **历史教训**：Phase 0 之前的草稿用过 `"approval/request"` / `"commandApproval/request"` 等假设性 method 名。**这些都不存在**。
>
> **Phase 0 客户端代码 (`packages/app-server-client/src/client.ts`) 不硬编码任何 method 名** —— 它把 server request 当 opaque dispatch。Phase 1 的 `ApprovalBroker` 才内部 dispatch by method name，从生成的 `ServerRequest.ts` union 读 method 名（见 TODOS.md `P2.2`）。

### 4.1 `ApplyPatchApprovalResponse` / `ExecCommandApprovalResponse` 的 `decision` 字段

实际生成的类型是：

```ts
type ApplyPatchApprovalResponse = { decision: ReviewDecision };
type ExecCommandApprovalResponse = { decision: ReviewDecision };

type ReviewDecision =
  | "approved"
  | "approved_for_session"
  | "denied"
  | "timed_out"          // server 端使用，client 不发
  | "abort"
  | { approved_execpolicy_amendment: { ... } }
  | { network_policy_amendment: { ... } };
```

> **历史教训**：Phase 0 早期草稿写过 `ApprovalDecision = "allow_once" | "allow_session" | "deny" | "cancel"`。这些是**展示层语义**，不是 wire 真实值。
>
> **Phase 1 `ApprovalBroker` 必须做映射**：
> - IM "允许一次" → `"approved"`
> - IM "本会话允许" → `"approved_for_session"`
> - IM "拒绝" → `"denied"`
> - IM "取消任务" → `"abort"`
>
> v2 的 4 个 `item/*/requestApproval` 系列可能用不同的 response shape（不是 `ReviewDecision` 直接复用），Phase 1 实施时按 `packages/codex-protocol/src/generated/v2/*RequestApprovalResponse.ts` 为准。

### 4.2 数据流

```text
codex app-server -> client.onServerRequest(req)
  -> ApprovalBroker.dispatchByMethod(req.method)
  -> SecurityPolicy.checkUserPermissions(req)
  -> ChannelRenderer.renderApprovalCard(req)
  -> IM 用户点按钮
  -> ApprovalBroker.resolve(requestId, ReviewDecision)
  -> client.respond(req.id, { decision })
```

### 4.3 超时 + default-reject

- Phase 0 client 默认对**未注册 handler 的 server-request** 返回 `-32601 "no handler"`（`packages/app-server-client/src/client.ts`）。这防止 codex 等待挂死。
- Phase 0 client 对**handler 抛错或 30s 超时** 返回 `-32603 "handler error"`。
- Phase 1 `ApprovalBroker` 加业务级 30 分钟过期：过期时返回 `decision: "denied"`（保守），同时 IM 提示用户 "审批已过期，请重新发起任务"。

## 5. Command execution 渲染

服务器端命令执行的事件流（Phase 1 EventNormalizer 消费）：

```text
turn 内 ->
  item/started (kind: command-execution-related)
  item/commandExecution/outputDelta            // 流式 stdout/stderr
  item/commandExecution/terminalInteraction    // 命令需要交互（rare）
  item/completed (with exec result item)
```

如果命令需要审批，会先发出 `item/commandExecution/requestApproval` 这个 server request（见 §4）。

### Phase 0+ 渲染目标

- **开始**：`cwd / cmd / reason / status: pending|running|done|failed`
- **运行中**：elapsed time、stdout/stderr tail（ring buffer，default 4KB）
- **完成**：exit code + tail

### 渐进展开

- P0：state machine 实现，CLI smoke 验证。
- P1：EventNormalizer 把上面 raw notification 转成 `RichBlock` 中的 `command` 类型。
- P2：full output 写文件，IM 卡片支持下载附件。

## 6. File change 渲染

事件流：

```text
item/fileChange/outputDelta       // 流式 patch chunk
item/fileChange/patchUpdated      // 完整 patch 更新
item/completed (with file-change item)
turn/diff/updated                 // turn 级 diff 摘要更新
```

如果文件变更需要审批：`item/fileChange/requestApproval`（见 §4）。

- P0：files 列表 + summary。
- P1：diff summary + 可下载 full diff 附件。
- P2：collapsible diff card on supporting platforms。

## 7. Plan / token usage / review

| 通知 | 用途 |
|---|---|
| `turn/plan/updated` | TurnPlanUpdatedNotification — `/plan` 命令产出 |
| `item/plan/delta` | PlanDeltaNotification — 流式 plan |
| `thread/tokenUsage/updated` | ThreadTokenUsageUpdatedNotification — usage 显示 |
| `model/rerouted` | ModelReroutedNotification — codex 中途换 model 通知 |
| `model/verification` | ModelVerificationNotification |
| `thread/compacted` | ContextCompactedNotification — context 压缩完成 |

`review/start` 启动 review 后产出独立 thread + 完整 turn 流；renderer 用 review-specific UI。

## 8. Unknown event 策略

任何未知 method 的 server -> client message：

- 写入 audit / event log。
- 如果有关联 thread/turn，附加到 runtime timeline。
- **不导致进程崩溃**（Phase 0 `client.ts` 已强制 — Codex final review #4 加 strict guards 后仍保留 fall-through warn 路径）。
- debug 模式下可通过 `/debug last-events` 查看（Phase 1+ 增强）。

## 9. 协议生成策略

```bash
pnpm protocol:generate
# = pnpm check:codex-version
#  && rm -rf packages/codex-protocol/{src/generated,schema}
#  && codex app-server generate-ts --out packages/codex-protocol/src/generated
#  && codex app-server generate-json-schema --out packages/codex-protocol/schema
#  && node scripts/canonicalize-schema.mjs

pnpm protocol:check
# = pnpm protocol:generate && git diff --exit-code packages/codex-protocol
#   验证两次生成完全等同（确定性）
```

> **不带 `--experimental` flag**。Phase 0 Task 0.2 通过 empirical diff 决定：experimental 多出来的 +29 文件（`thread/realtime/*` voice / `fuzzyFileSearch/session*` / `thread/memoryMode/*` / `mock/experimentalMethod` 等）全部不在 Phase 0–6 scope。详见 `docs/phase-0/codex-gen-diff.md`。
>
> **`canonicalize-schema.mjs` 是必要兜底**：codex 0.125 `generate-json-schema` 输出的 v2 bundle JSON 在两次运行间会重排 top-level keys (HashMap iteration order)。canonicalize 后递归 sort keys，确保确定性。

## 10. App Server smoke test

Phase 0 实现了**两层** smoke，均**默认 disabled**：

```bash
# Layer 1: initialize-only，不调模型，不进 thread
CODEX_SMOKE=1 pnpm smoke:app-server

# Layer 2: 真 turn，触发模型调用 (~$0.01)
CODEX_REAL_SMOKE=1 pnpm smoke:real-turn
```

**Layer 1 (`smoke:app-server`)**：
1. `StdioTransport` spawn `codex app-server --listen stdio://` (`sandbox=read-only`, `approval_policy=on-request`)
2. client.setServerRequestHandler(null) — explicit default-reject
3. `performInitializeHandshake(client, clientInfo)`
4. log InitializeResponse fields
5. `client.stop()` — clean shutdown

**Layer 2 (`smoke:real-turn`)**：
1. 同样 spawn + sandbox rails + default-reject
2. handshake
3. `client.request("thread/start", {})`
4. `client.request("turn/start", { threadId, input: [{type:"text", text:harmlessPrompt, text_elements:[]}] })`
5. wait for `turn/completed` notification (60s ceiling)
6. assert no unhandled server-request leak
7. clean shutdown

**Harmless prompt**（`packages/cli/src/prompts/harmless-turn.txt`）：固定字面 "Reply OK"，明令禁止 shell / file / Computer Use。Smoke **不**断言模型回复内容；只断言 lifecycle 到达 terminal state。

详见 `packages/cli/README.md` 安全边界。

## 11. 防止协议漂移

### 自动机制（已落地）

- **`pnpm check:codex-version`**：root `CODEX_VERSION` ↔ `package.json#codexIm.codexVersion` ↔ `codex --version` 三方对账。任一不一致 fail-stop。
- **`pnpm protocol:check`**：regenerate + git diff exit-code，确定性验证。
- **wire fixtures**：`packages/testkit/fixtures/codex-0.125.0/*.jsonl` 提交真实 wire frame。Phase 1 contract tests `pnpm test:contract` 在每次 CI 跑 fixture replay 检测漂移。

### 升级 codex 时的标准流程

1. 更新 `CODEX_VERSION` + `package.json#codexIm.codexVersion`。
2. `pnpm protocol:generate`（自动 canonicalize）。
3. `git diff packages/codex-protocol/` 仔细 review。
4. `pnpm test:contract` 用旧 fixture replay 新 schema；任何字段消失/方法重命名都会失败。
5. 如有 breaking change：在新 codex 版本下重抓 wire fixture（`packages/testkit/fixtures/codex-X.Y.Z/`），更新本文档相应章节。
6. 单提交一次 "codex upgrade X.Y.Z -> A.B.C"。

### 工程纪律

- **业务代码不硬编码 method 名**（Phase 0 Task 10.3 audit 强制）。Phase 1 EventNormalizer / ApprovalBroker 从生成 union 读 method。
- **业务代码不直接读 raw `JsonRpcNotification.params`**：先经 EventNormalizer 投影成 `CodexRichEvent`。
- 对 server-initiated approval request 保留 raw payload（audit + 跨版本兼容）。
