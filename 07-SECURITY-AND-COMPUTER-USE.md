# 安全与 Computer Use 设计

## 1. 安全目标

- 只允许授权用户和授权 chat 控制 Codex。
- 不把 Codex App Server 暴露到公网。
- 所有高风险操作有可审计的 approval。
- Computer Use 必须显式触发且受 allowlist/denylist 限制。
- 任何敏感 secret 不进入普通日志或 IM 消息。

## 2. 基础 ACL

```toml
[security]
allowed_users = [
  "telegram:123456789",
  "lark:ou_xxx",
  "dingtalk:staff_xxx"
]
allowed_chats = [
  "telegram:-100123456",
  "lark:oc_xxx",
  "dingtalk:cid_xxx"
]
admin_users = ["telegram:123456789"]
```

检查顺序：

1. platform 是否启用。
2. user 是否 allowed 或 admin。
3. chat 是否 allowed。
4. chat 是否绑定项目。
5. 用户是否有项目权限。

## 3. 项目权限

```toml
[projects.web]
cwd = "/Users/mini/code/web"
allowed_users = ["telegram:123456789"]
allowed_chats = ["telegram:-100123456"]
writable_roots = ["/Users/mini/code/web"]
```

原则：

- 不允许用户通过 IM 任意切换 cwd 到未配置目录。
- writable roots 必须显式配置。
- project id 不等于路径，避免泄露本机目录结构。

## 4. App Server 暴露策略

推荐：

```text
IM bridge 与 app-server 同机
app-server 使用 stdio
不监听公网端口
```

如果必须远程：

- 优先 SSH tunnel、Tailscale、VPN。
- WebSocket 只监听 loopback 或私网。
- 必须配置 token/capability auth。
- 不要把 App Server 裸露到公网。

## 5. Approval policy

### 分类

```ts
type ApprovalKind =
  | "command_execution"
  | "file_change"
  | "mcp_tool_call"
  | "computer_use_app"
  | "computer_use_sensitive_step"
  | "unknown";
```

### 默认策略

| 类型 | 默认 | 可 allow_session | 说明 |
|---|---|---|---|
| command_execution | ask | yes | 例如 test/build/git |
| file_change | ask | yes | 文件写入/修改 |
| mcp_tool_call | ask | depends | 取决于 tool trust |
| computer_use_app | ask | limited | 仅 allowlisted app |
| sensitive step | ask always | no | 登录、支付、发送、删除等 |
| unknown | deny/ask admin | no | 不认识就不要自动放行 |

## 6. 命令安全

### deny patterns

```toml
[security.commands]
deny_patterns = [
  "rm -rf /",
  "sudo ",
  "chmod -R 777",
  "security dump-keychain",
  "pbpaste |",
  "curl .* | sh",
  "wget .* | sh"
]
require_admin_patterns = [
  "git push",
  "gh pr merge",
  "npm publish",
  "pnpm publish",
  "docker system prune"
]
```

### 审批卡片必须展示

- command 原文。
- cwd。
- reason。
- requested by 哪个 thread/turn。
- 风险标签。

## 7. Computer Use 安全策略

### 配置

```toml
[computer_use]
enabled = true
require_explicit_prefix = true
allowed_apps = ["Google Chrome", "Safari", "Xcode", "Simulator", "Finder"]
deny_apps = ["1Password", "Keychain Access", "System Settings", "Terminal"]
require_approval_for_new_app = true
require_approval_keywords = [
  "login", "password", "token", "payment", "checkout", "delete", "send", "submit", "publish", "transfer"
]
```

### 触发规则

只允许：

```text
/cu ...
/computer-use ...
```

不允许普通 prompt 隐式触发 Computer Use。CommandRouter 如果检测到“打开 Chrome 操作网页”等意图但没有 `/cu` 前缀，应提示用户使用 `/cu`。

### Prompt 包装

对 `/cu` 任务包装安全边界：

```text
You are running a Computer Use task initiated from an IM remote client.
Allowed apps: Chrome only.
Do not enter credentials, submit forms, make payments, delete data, send messages, publish, or change account/security settings without asking for explicit approval.
Stop and summarize before any irreversible action.
Task: <user task>
```

## 8. Secret 管理

- IM tokens 只来自环境变量或 macOS Keychain，配置文件只写 env var 名。
- 日志 redact：token、app_secret、authorization header、approval raw payload 中可能的 secret。
- 不把 `.env` 内容发到 IM。
- 不允许 Codex 读取 bridge 的 secret 配置目录，除非开发任务明确需要并由 admin 审批。

## 9. Audit log

记录：

- 谁发起任务。
- 哪个 chat/project/thread。
- 哪个 approval。
- 决策是什么。
- 执行了什么命令。
- 修改了哪些文件。
- Computer Use 触发和 app。

不要记录：

- 完整 token。
- 完整密码。
- 高敏表单内容。

## 10. 事故处理

### 误触发任务

- 用户 `/stop`。
- bridge 发 `turn/interrupt`。
- 标记 audit log。

### 误 allow_session

- `/permissions` 查看本会话 allow 列表。
- `/revoke <permission>` 撤销。
- 重启 thread/session 时默认不继承高风险 Computer Use permission。

### App Server 异常

- 立刻停止转发新的 prompt。
- pending approvals 标记为 stale。
- 通知 admin。

## 11. 安全测试

- 非白名单用户发消息被拒绝。
- 非白名单群消息被忽略。
- 未绑定项目时不能执行 prompt。
- deny pattern 命令无法 approval allow。
- approval timeout 不会自动 allow。
- Computer Use 无 `/cu` 不触发。
- deny app 不可用。
- 日志中不含 app secret / bot token。
