# 18. Hooks 与 Guardrails 建议

本文件给出 Claude Code hooks / 项目守卫策略的建议。不同版本的 Claude Code hooks 配置格式可能变化；实际落地前请让 Claude Code 读取当前官方 docs 或运行本机 help 验证。

## 1. Hook 目标

不是为了阻止开发，而是为了防止 AI agent 在以下方面跑偏：

1. 把项目写成 Codex CLI/TUI wrapper。
2. 修改密钥或把 token 写入 repo。
3. 暴露 app-server 到公网。
4. 跳过测试。
5. 在安全/Computer Use 相关代码中默认 allow。
6. 绕过 approval broker。
7. 大范围修改计划外文件。

## 2. 建议 hook 类别

### 2.1 PreToolUse：危险命令拦截

建议拦截或要求确认：

```text
rm -rf
sudo
chmod -R 777
curl | sh
npm publish
pnpm publish
git push --force
git reset --hard
launchctl unload/load production plist
codex app-server --listen ws://0.0.0.0
写入 .env / secret / token 文件
```

同时拦截这些架构违规关键词组合：

```text
parse codex terminal output
spawn codex interactive chat
wrap codex tui
screen scrape codex cli
```

### 2.2 PostToolUse：编辑后快速检查

当 Claude 修改代码后，建议运行轻量检查：

```bash
pnpm typecheck --if-present
pnpm test -- --run --changed
```

如果仓库尚未支持 changed tests，就运行当前 package 的相关测试。

### 2.3 Stop：session 结束检查

如果本 session 修改了代码，Stop hook 应提醒 Claude 输出：

1. 改了哪些文件。
2. 跑了哪些测试。
3. 哪些测试没跑，为什么。
4. 是否更新文档。
5. 是否存在未处理安全问题。
6. 下一步是什么。

## 3. 示例 hook policy 伪配置

> 注意：这不是保证可直接运行的 Claude Code 配置，只是策略草案。实际格式让 Claude Code 按你本机版本改写。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "match": "Bash",
        "denyIfCommandMatches": [
          "rm -rf",
          "sudo",
          "git push --force",
          "git reset --hard",
          "codex app-server --listen ws://0.0.0.0",
          "codex app-server --listen ws://[::]"
        ]
      },
      {
        "match": "Write|Edit",
        "denyIfPathMatches": [
          ".env",
          ".env.*",
          "**/*token*",
          "**/*secret*"
        ]
      }
    ],
    "PostToolUse": [
      {
        "match": "Edit|Write",
        "run": "pnpm typecheck --if-present"
      }
    ],
    "Stop": [
      {
        "run": "scripts/claude-stop-check.sh"
      }
    ]
  }
}
```

## 4. 推荐 stop check 脚本逻辑

`scripts/claude-stop-check.sh` 可做轻量检查：

```bash
#!/usr/bin/env bash
set -euo pipefail

if git diff --quiet; then
  echo "No working tree changes."
  exit 0
fi

echo "Working tree changed. Please ensure Claude reports:"
echo "- changed files"
echo "- tests run"
echo "- docs updated"
echo "- unresolved risks"
echo "- next step"

# 不在 Stop hook 自动跑重型测试，避免意外长时间卡住；由 Claude 主动运行。
```

## 5. gstack guard 用法

高风险任务前：

```text
请使用 /guard，并把修改范围限制在 packages/security 和 tests/security。
目标：实现 approval timeout fail-closed 行为。
不要修改 adapter 或 runtime 其他模块。
```

单目录修复：

```text
请使用 /freeze packages/core。
只允许修改 core 包，完成 AppServerClient timeout bug 修复。
```

解除：

```text
请使用 /unfreeze。
```

## 6. Computer Use 额外 guardrails

### 永久禁止默认自动批准

以下行为必须人工审批：

```text
提交登录表单
提交支付/购买/转账
读取或复制密码/密钥/恢复码
打开 1Password / Keychain / System Settings
删除文件或远程资源
发送邮件/IM/PR/issue/comment 到外部
修改生产系统配置
```

### `/cu` prompt wrapper 必须包含

```text
Use Computer Use only if necessary.
Operate only the allowed app: <app>.
Do not submit credentials, payment, purchase, transfer, deletion, or external-send actions.
Stop and ask for approval before any sensitive action.
Summarize what you see and what you plan before acting on sensitive UI.
```

## 7. 每个 phase 的安全 gate

### Phase 0/1

- App Server 只用 stdio 或 localhost。
- 不实现远程 WebSocket。
- fake server fixture 不含真实 secret。

### Phase 2

- Telegram token 从 env 读取。
- 未授权 chat/user 拒绝。
- approval callback 校验 actor。

### Phase 3

- 所有敏感行为写 audit log。
- deny pattern 测试必须存在。
- fail closed。

### Phase 4/5

- 飞书/钉钉 app secret 不写 repo。
- interactive card callback 校验 actor。
- reconnect 不泄露 token。

### Phase 6

- Computer Use 必须显式 `/cu`。
- denied apps 默认存在。
- 敏感动作二次审批。

