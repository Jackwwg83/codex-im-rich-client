# 实现骨架

## 1. 建议目录结构

```text
codex-im-bridge/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md
  CLAUDE.md
  docs/
  packages/
    codex-protocol/
      src/generated/
      src/index.ts
      schema/
    app-server-client/
      src/jsonl.ts
      src/client.ts
      src/process.ts
      src/errors.ts
      test/
    codex-runtime/
      src/runtime.ts
      src/normalizer.ts
      src/state.ts
      src/events.ts
      test/
    core/
      src/session-router.ts
      src/command-router.ts
      src/approval-broker.ts
      src/security-policy.ts
      src/audit.ts
      test/
    render/
      src/rich-block.ts
      src/telegram-renderer.ts
      src/lark-renderer.ts
      src/dingtalk-renderer.ts
      src/plain-renderer.ts
      test/
    channel-core/
      src/types.ts
      src/adapter.ts
    adapter-telegram/
      src/index.ts
      src/telegram-adapter.ts
    adapter-lark/
      src/index.ts
      src/lark-adapter.ts
    adapter-dingtalk/
      src/index.ts
      src/dingtalk-adapter.ts
    storage-sqlite/
      src/db.ts
      src/migrations.ts
      src/repositories.ts
    config/
      src/schema.ts
      src/load.ts
    daemon/
      src/index.ts
      src/wire.ts
    cli/
      src/index.ts
    testkit/
      src/fake-app-server.ts
      src/fake-channel-adapter.ts
  scripts/
    codex-review.sh
    codex-test-plan.sh
    install-launchd.sh
```

## 2. pnpm workspace

```yaml
packages:
  - "packages/*"
```

## 3. 根 package scripts

```json
{
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "protocol:generate": "rm -rf packages/codex-protocol/src/generated packages/codex-protocol/schema && codex app-server generate-ts --out packages/codex-protocol/src/generated && codex app-server generate-json-schema --out packages/codex-protocol/schema",
    "smoke:app-server": "tsx packages/cli/src/index.ts smoke app-server",
    "dev:daemon": "tsx packages/daemon/src/index.ts --config ./config.dev.toml"
  }
}
```

## 4. JSONL parser

```ts
export class JsonlDecoder {
  private buffer = "";

  push(chunk: Buffer | string): unknown[] {
    this.buffer += chunk.toString();
    const out: unknown[] = [];
    while (true) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      out.push(JSON.parse(line));
    }
    return out;
  }
}
```

## 5. AppServerClient 核心

```ts
export class StdioAppServerClient implements AppServerClient {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  async request<TParams, TResult>(method: string, params?: TParams): Promise<TResult> {
    const id = this.nextId++;
    const msg = { id, method, params };
    this.write(msg);
    return this.waitForResponse<TResult>(id);
  }

  notify<TParams>(method: string, params?: TParams): void {
    this.write({ method, params });
  }

  respond<TResult>(id: string | number, result: TResult): void {
    this.write({ id, result });
  }

  private handleMessage(msg: any): void {
    if ("id" in msg && ("result" in msg || "error" in msg) && !msg.method) {
      this.resolvePending(msg);
      return;
    }
    if ("id" in msg && msg.method) {
      this.emitServerRequest(msg);
      return;
    }
    if (msg.method) {
      this.emitNotification(msg);
      return;
    }
    this.emitUnknown(msg);
  }
}
```

## 6. Runtime event normalizer

```ts
export function normalizeCodexEvent(msg: JsonRpcNotification): CodexRichEvent {
  switch (msg.method) {
    case "turn/started":
      return { type: "turn_started", ...extractTurn(msg.params) };
    case "item/agentMessage/delta":
      return { type: "assistant_delta", ...extractDelta(msg.params) };
    case "turn/completed":
      return { type: "turn_completed", ...extractCompleted(msg.params) };
    default:
      return { type: "unknown", method: msg.method, params: msg.params };
  }
}
```

真实 method 名和 params 字段以 generated schema 与 smoke fixtures 为准。

## 7. RenderScheduler

```ts
export class RenderScheduler {
  private pending = new Map<string, RenderState>();

  schedule(target: Target, event: CodexRichEvent): void {
    const key = makeRenderKey(target, event);
    const state = this.pending.get(key) ?? createState(target, event);
    state.apply(event);
    if (!state.timer) {
      state.timer = setTimeout(() => this.flush(key), state.intervalMs);
    }
    this.pending.set(key, state);
  }

  async flush(key: string): Promise<void> {
    const state = this.pending.get(key);
    if (!state) return;
    state.timer = undefined;
    await state.renderer.update(state.snapshot());
  }
}
```

## 8. CommandRouter

```ts
export function parseInbound(text: string): RouteResult {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return { kind: "prompt", text: trimmed, attachments: [] };
  }
  const [name, ...args] = splitCommand(trimmed);
  return { kind: "command", command: normalizeCommand(name), args };
}
```

## 9. Approval action payload

不要在按钮 payload 放完整 JSON。使用短 id：

```ts
export function encodeApprovalAction(approvalId: string, action: ApprovalDecision): string {
  return `a:${approvalId}:${action}`;
}
```

对于 Telegram callback data 限制，approvalId 可用短随机 id，完整映射存在 SQLite。

## 10. Config schema

```ts
const ConfigSchema = z.object({
  server: z.object({
    transport: z.enum(["stdio", "websocket"]).default("stdio"),
    codex_command: z.string().default("codex"),
    codex_args: z.array(z.string()).default(["app-server", "--listen", "stdio://"]),
  }),
  security: z.object({
    allowed_users: z.array(z.string()).default([]),
    allowed_chats: z.array(z.string()).default([]),
    admin_users: z.array(z.string()).default([]),
  }),
  projects: z.record(ProjectSchema),
});
```

## 11. 最小 daemon wiring

```ts
async function main() {
  const config = await loadConfig(process.argv);
  const db = await openDatabase(config.database.path);
  await runMigrations(db);

  const appServer = new StdioAppServerClient(config.server);
  const runtime = new CodexRuntimeImpl(appServer, db);
  const core = createCore({ config, db, runtime });

  const adapters = createAdapters(config);
  for (const adapter of adapters) {
    adapter.onMessage((msg) => core.handleMessage(msg));
    adapter.onAction((action) => core.handleAction(action));
    await adapter.start();
  }

  await runtime.initialize();
  runtime.onEvent((event) => core.handleCodexEvent(event));
}
```

## 12. 第一批文件实现顺序

1. `packages/app-server-client/src/jsonl.ts`
2. `packages/app-server-client/src/client.ts`
3. `packages/testkit/src/fake-app-server.ts`
4. `packages/codex-runtime/src/events.ts`
5. `packages/codex-runtime/src/normalizer.ts`
6. `packages/core/src/approval-broker.ts`
7. `packages/channel-core/src/types.ts`
8. `packages/adapter-telegram/src/telegram-adapter.ts`
9. `packages/daemon/src/index.ts`

每个文件先写测试，再实现。
