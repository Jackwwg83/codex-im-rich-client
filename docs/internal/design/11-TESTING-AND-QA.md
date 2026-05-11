# 测试与 QA 设计

## 1. 测试金字塔

```text
Unit tests
  - JSONL framing
  - request correlation
  - event normalizer
  - session router
  - approval broker
  - security policy

Integration tests
  - fake app-server
  - fake channel adapters
  - SQLite repositories
  - command router -> runtime -> renderer

Smoke tests
  - real codex app-server initialize
  - real harmless turn
  - Telegram sandbox bot
  - Lark/DingTalk dev app

Manual tests
  - Computer Use
  - approval UX
  - launchd restart
```

## 2. Unit tests

### app-server-client

- parses JSONL split chunks。
- handles multiple messages in one chunk。
- correlates response by id。
- emits notification。
- emits server request。
- rejects timeout。
- handles malformed JSON without crashing。

### codex-runtime

- turn starts -> active turn set。
- turn completed -> active turn cleared。
- assistant deltas are aggregated。
- command item lifecycle。
- file change lifecycle。
- unknown event logged。

### approval-broker

- creates pending approval。
- renders allowed actions based on policy。
- resolves allow_once。
- resolves allow_session。
- denies expired approval。
- rejects unauthorized approver。
- idempotent duplicate button clicks。

### security

- allowed users。
- allowed chats。
- project ACL。
- deny command patterns。
- require admin patterns。
- Computer Use prefix required。

## 3. Fake App Server

`packages/testkit` 提供 FakeAppServer：

```ts
const server = new FakeAppServer();
server.onRequest("initialize", () => ({ capabilities: {} }));
server.script([
  notification("thread/started", ...),
  notification("turn/started", ...),
  serverRequest("item/commandExecution/requestApproval", ...),
  notification("turn/completed", ...),
]);
```

用途：

- 可复现 approval 流。
- 不依赖真实 Codex。
- CI 可跑。

## 4. Fake Channel Adapter

用于测试 IM 层：

```ts
const adapter = new FakeChannelAdapter({ supportsButtons: true });
await adapter.injectMessage({ text: "/new web" });
expect(adapter.sentCards).toContainApproval(...);
await adapter.injectAction({ approvalId, action: "allow_once" });
```

## 5. Contract tests

基于 generated schema 和 fixtures：

- `fixtures/codex-events/*.jsonl`
- `fixtures/approvals/*.json`

测试：

- 所有 fixture 可 parse。
- normalizer 输出稳定 snapshot。
- unknown fields 不破坏。
- required mapping 不缺失。

## 6. Real App Server smoke tests

### `pnpm smoke:app-server`

要求：

- 本机有 `codex`。
- 已登录。
- 项目目录可读。

流程：

1. 启动 app-server。
2. initialize。
3. thread/start。
4. turn/start：prompt 为“只回复 OK，不运行命令，不修改文件”。
5. 等待 turn/completed。
6. assert 收到 assistant message。
7. stop。

### `pnpm smoke:approval`

让 Codex 请求一个低风险命令，例如 `pwd` 或 `git status`，验证 approval roundtrip。注意真实环境行为可能变化，因此此测试默认手动或 nightly，不进普通 CI。

## 7. IM smoke tests

### Telegram

- `/start`
- `/projects`
- `/new test`
- 发普通 prompt。
- approval button。
- `/stop`。
- 长文本切分。

### 飞书

- 长连接是否 ready。
- 群聊 mention。
- interactive card。
- button callback。
- card update。

### 钉钉

- Stream connection。
- robot message callback。
- card full update。
- approval callback。

## 8. Computer Use manual QA

只做手动验证，不自动化高风险桌面操作。

### 前置

- Codex App 已安装 Computer Use plugin。
- macOS Screen Recording / Accessibility 已授权。
- Chrome/Safari 已在 Codex 中允许。

### 测试用例

1. `/cu status`：返回当前配置和安全策略。
2. `/cu 用 Chrome 打开 about:blank，然后停止`。
3. `/cu 用 Chrome 打开 http://localhost:3000，只观察页面，不提交任何表单`。
4. 触发敏感关键字时应请求确认。
5. 尝试使用 deny app 时拒绝。

## 9. 性能测试

- 1000 条 assistant_delta 聚合不刷屏。
- 10 个并发 chat，每个一个 active turn，内存稳定。
- stdout 1MB 输出只保留 tail，不撑爆 IM。
- SQLite 写 event_log 不阻塞 event loop。

## 10. 回归清单

每个 PR/phase：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm test:integration
pnpm smoke:app-server
```

手动：

- Telegram approval。
- 至少一个真实 turn。
- `/stop`。
- daemon restart recovery。

## 11. QA 输出格式

每次 release 更新：

```text
Release: phase-x-name
Commit: <sha>
Codex version: <codex --version>
Node version: <node --version>
Tests:
  - unit: pass/fail
  - integration: pass/fail
  - smoke app-server: pass/fail
  - Telegram: pass/fail
Known risks:
  - ...
Next actions:
  - ...
```
