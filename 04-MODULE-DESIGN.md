# 分模块设计文档

## 1. Monorepo 包结构

```text
packages/
  codex-protocol/          # generated TS schema + thin type exports
  app-server-client/       # JSON-RPC transport/client
  codex-runtime/           # state machine/event normalizer
  core/                    # session router, command router, approval broker, security
  render/                  # platform-neutral rich render model + markdown/plaintext utils
  channel-core/            # ChannelAdapter interface + inbound/outbound types
  adapter-telegram/        # Telegram adapter
  adapter-lark/            # Feishu/Lark adapter
  adapter-dingtalk/        # DingTalk adapter
  adapter-satori/          # P2 Satori adapter
  adapter-chat-sdk/        # P2 Vercel Chat SDK adapter bridge
  storage-sqlite/          # SQLite implementation
  config/                  # config loading, zod schemas
  daemon/                  # process entrypoint, dependency wiring
  cli/                     # local admin CLI
  testkit/                 # fake app-server, fake adapters, fixtures
```

## 2. `codex-protocol`

### 责任

- 保存 `codex app-server generate-ts` 生成的协议类型。
- 暴露项目自用的 type aliases。
- 不写业务逻辑。

### 关键命令

```bash
pnpm protocol:generate
pnpm protocol:check
```

### 约束

- 每次 Codex 版本升级后必须重新生成。
- 生成结果要提交到 repo，保证 Claude Code/Codex CLI 在无额外步骤下能读类型。

## 3. `app-server-client`

### 责任

- 启动/连接 app-server。
- JSONL framing。
- request/response correlation。
- notification emitter。
- server-initiated request emitter。
- graceful shutdown。

### 接口

```ts
export interface AppServerClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  request<TParams, TResult>(method: string, params?: TParams): Promise<TResult>;
  notify<TParams>(method: string, params?: TParams): void;
  respond<TResult>(id: string | number, result: TResult): void;
  reject(id: string | number, error: JsonRpcError): void;
  onNotification(handler: (msg: JsonRpcNotification) => void): Unsubscribe;
  onServerRequest(handler: (msg: JsonRpcRequest) => void): Unsubscribe;
}
```

### 错误处理

- `Server overloaded`：retry with exponential backoff。
- child process crash：emit `runtime_disconnected`，由 daemon 决定重启。
- malformed JSON：记录并继续；连续失败超过阈值后重启。

## 4. `codex-runtime`

### 责任

- 初始化 Codex connection。
- thread/turn/item 状态机。
- 事件归一化。
- active turn 管理。
- diff/plan/usage 缓存。

### 接口

```ts
export interface CodexRuntime {
  initialize(): Promise<void>;
  listThreads(filter?: ThreadFilter): Promise<ThreadSummary[]>;
  startThread(input: StartThreadInput): Promise<ThreadRef>;
  resumeThread(threadId: string): Promise<ThreadRef>;
  startTurn(input: StartTurnInput): Promise<TurnRef>;
  steerTurn(input: SteerTurnInput): Promise<void>;
  interruptTurn(threadId: string, turnId?: string): Promise<void>;
  startReview(input: ReviewInput): Promise<ReviewRef>;
  onEvent(handler: (event: CodexRichEvent) => Promise<void> | void): Unsubscribe;
}
```

## 5. `core`

### 5.1 SessionRouter

负责 chat/project/thread 映射。

```ts
export interface SessionRouter {
  resolveContext(target: Target): Promise<SessionContext>;
  bindProject(target: Target, projectId: string): Promise<void>;
  bindThread(target: Target, threadId: string): Promise<void>;
  getActiveTurn(target: Target): Promise<ActiveTurn | null>;
}
```

### 5.2 CommandRouter

负责把 IM 输入分成命令和普通 prompt。

```ts
type RouteResult =
  | { kind: "command"; command: CommandName; args: string[] }
  | { kind: "prompt"; text: string; attachments: Attachment[] };
```

### 5.3 ApprovalBroker

负责 pending approval 生命周期。

```ts
export interface ApprovalBroker {
  create(request: AppServerApprovalRequest, ctx: SessionContext): Promise<ApprovalRecord>;
  resolve(input: ResolveApprovalInput): Promise<void>;
  timeoutExpiredApprovals(): Promise<void>;
}
```

### 5.4 SecurityPolicy

负责：

- 用户/群白名单。
- project 权限。
- command deny patterns。
- Computer Use policy。
- approval default decision。

## 6. `render`

### 责任

- 把 `CodexRichEvent` 转成 `RichBlock`。
- 把 `RichBlock` 渲染成平台消息。
- 做 markdown escape、长度限制、切分、摘要。

### 策略

- Telegram：prefer editMessageText + inline keyboard。
- 飞书：prefer interactive card + markdown text。
- 钉钉：prefer card full update；注意部分卡片流式更新需要全量更新。
- PlainText fallback：所有平台都必须可降级到文本命令。

## 7. `channel-core`

### InboundMessage

```ts
export interface InboundMessage {
  platform: string;
  messageId: string;
  target: Target;
  sender: Sender;
  text: string;
  attachments: Attachment[];
  raw: unknown;
  receivedAt: Date;
}
```

### InboundAction

```ts
export interface InboundAction {
  platform: string;
  actionId: string;
  target: Target;
  sender: Sender;
  payload: Record<string, unknown>;
  raw: unknown;
}
```

### ChannelAdapter

```ts
export interface ChannelAdapter {
  name: string;
  capabilities: ChannelCapabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => Promise<void>): void;
  onAction(handler: (action: InboundAction) => Promise<void>): void;
  sendText(target: Target, text: string, options?: SendOptions): Promise<MessageRef>;
  editText(ref: MessageRef, text: string): Promise<void>;
  sendCard(target: Target, card: RichCard): Promise<MessageRef>;
  updateCard(ref: MessageRef, card: RichCard): Promise<void>;
  sendFile?(target: Target, file: OutboundFile): Promise<MessageRef>;
}
```

## 8. `storage-sqlite`

### 责任

- migrations。
- repositories。
- transactional updates。
- idempotency。

### Repositories

```text
UserRepository
ChatRepository
ProjectRepository
ThreadBindingRepository
TurnRepository
ApprovalRepository
MessageRepository
AuditRepository
EventLogRepository
```

## 9. `daemon`

### 责任

- load config
- initialize storage
- initialize app-server client/runtime
- initialize adapters
- wire handlers
- signal handling
- health checks

### 启动流程

```text
load config
validate secrets
open SQLite
run migrations
start AppServerClient
runtime.initialize
start adapters
register handlers
ready
```

## 10. `cli`

本地管理命令：

```bash
codex-im config validate
codex-im db migrate
codex-im projects list
codex-im bindings list
codex-im approvals list
codex-im smoke app-server
codex-im smoke telegram
codex-im launchd install
codex-im launchd uninstall
```
