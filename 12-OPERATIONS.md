# 运维与部署文档

## 1. Mac mini 运行要求

- macOS，建议 Apple Silicon。
- Codex App 已安装并登录。
- `codex` 命令在 launchd 环境 PATH 可用。
- Node.js 20+ 或 22+。
- pnpm。
- IM 平台 bot/app 凭据。

## 2. 目录布局

```text
~/.codex-im-bridge/
  config.toml
  state.db
  logs/
    daemon.log
    app-server.stderr.log
  backups/
  tmp/
```

## 3. 配置文件示例

```toml
[server]
transport = "stdio"
codex_command = "codex"
codex_args = ["app-server", "--listen", "stdio://"]
restart_on_crash = true

[database]
path = "/Users/mini/.codex-im-bridge/state.db"

[security]
allowed_users = ["telegram:123456789"]
allowed_chats = ["telegram:-100123456"]
admin_users = ["telegram:123456789"]

[defaults]
approval_policy = "ask"
sandbox = "workspace-write"
stream_update_interval_ms = 1500

[projects.web]
name = "web"
cwd = "/Users/mini/code/web"
writable_roots = ["/Users/mini/code/web"]
allowed_users = ["telegram:123456789"]

[adapters.telegram]
enabled = true
bot_token_env = "TELEGRAM_BOT_TOKEN"
mode = "polling"

[adapters.lark]
enabled = false
app_id = "cli_xxx"
app_secret_env = "LARK_APP_SECRET"
domain = "feishu"

[adapters.dingtalk]
enabled = false
client_id = "ding_xxx"
client_secret_env = "DINGTALK_CLIENT_SECRET"

[computer_use]
enabled = true
require_explicit_prefix = true
allowed_apps = ["Google Chrome", "Safari", "Xcode", "Simulator"]
deny_apps = ["1Password", "Keychain Access", "System Settings"]
```

## 4. 环境变量

```bash
export TELEGRAM_BOT_TOKEN="..."
export LARK_APP_SECRET="..."
export DINGTALK_CLIENT_SECRET="..."
```

launchd 下要通过 plist `EnvironmentVariables` 注入，或使用 wrapper script 从 Keychain 读取。

## 5. launchd plist 草案

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.codex-im-bridge</string>

  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/mini/code/codex-im-bridge/apps/daemon/dist/index.js</string>
    <string>--config</string>
    <string>/Users/mini/.codex-im-bridge/config.toml</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/mini/code/codex-im-bridge</string>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/Users/mini/.codex-im-bridge/logs/daemon.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/mini/.codex-im-bridge/logs/daemon.stderr.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>TELEGRAM_BOT_TOKEN</key>
    <string>REPLACE_ME_OR_USE_WRAPPER</string>
  </dict>
</dict>
</plist>
```

## 6. 启停命令

```bash
launchctl load ~/Library/LaunchAgents/dev.codex-im-bridge.plist
launchctl unload ~/Library/LaunchAgents/dev.codex-im-bridge.plist
launchctl kickstart -k gui/$(id -u)/dev.codex-im-bridge
log stream --predicate 'process == "node"' --style compact
```

## 7. 健康检查

本地 CLI：

```bash
codex-im health
codex-im runtime status
codex-im adapters status
codex-im approvals list
```

健康状态：

- `app_server: connected/disconnected/restarting`
- `telegram: connected/polling/error`
- `lark: connected/error`
- `dingtalk: connected/error`
- `db: ok/error`

## 8. 日志

### 日志等级

```text
debug: raw event sampling, development only
info: lifecycle, task summary
warn: reconnect, unknown event, unauthorized access
error: crash, failed approval response, db error
```

### Redaction

必须 redact：

- bot token
- app secret
- Authorization header
- Codex auth token
- password/token-like values

## 9. 备份与恢复

### 备份

```bash
sqlite3 ~/.codex-im-bridge/state.db ".backup ~/.codex-im-bridge/backups/state-$(date +%Y%m%d).db"
```

### 恢复

1. stop daemon。
2. 复制 backup 到 state.db。
3. start daemon。
4. `/status` 验证 bindings。

## 10. 升级流程

1. stop daemon。
2. `git pull`。
3. `pnpm install`。
4. `pnpm build`。
5. `pnpm db:migrate`。
6. `pnpm protocol:generate` 如果 Codex 已升级。
7. `pnpm test && pnpm smoke:app-server`。
8. start daemon。
9. Telegram `/status` 验证。

## 11. 故障排查

### bot 收不到消息

- 检查 IM 平台 app/bot 权限。
- Telegram 检查 privacy mode。
- 飞书检查事件订阅、权限、长连接状态。
- 钉钉检查 Stream 模式和 app 发布状态。

### app-server 启动失败

- launchd PATH 是否包含 `codex`。
- Codex 是否已登录。
- config cwd 是否存在。
- 查看 app-server stderr。

### approval 卡住

- `codex-im approvals list`。
- 检查 request id 是否已 response。
- 检查重复点击是否被 idempotency 过滤。
- 必要时 `/stop`。

### Computer Use 不工作

- 检查 Codex App 是否安装 Computer Use plugin。
- 检查 macOS Screen Recording / Accessibility。
- 检查 Codex App 内 app approval。
- 使用本地 Codex App 先跑一遍无害任务。
