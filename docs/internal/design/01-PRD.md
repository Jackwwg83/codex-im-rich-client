# PRD：Codex IM Rich Client

## 1. 背景

用户希望在 Mac mini 上运行 Codex App / Codex App Server，并通过 Telegram、飞书、钉钉或其他 IM 远程控制 Codex 执行开发、测试、review、文件修改、shell 命令、Computer Use 等操作。目标不是做 OpenClaw 插件，也不是解析 Codex CLI/TUI 的终端输出，而是做一个 App Server 原生 rich client。

Codex App Server 的价值在于它暴露的是 thread/turn/item、流式事件、审批请求、diff、review 等 UI 友好的 rich event stream。IM client 应该尽量保留这些结构，而不是把所有内容压缩成一段普通 assistant 文本。

## 2. 产品目标

### P0 目标

- 在 Mac mini 上启动一个本地 daemon。
- daemon 通过 stdio 启动或连接 `codex app-server`。
- 支持 Telegram 私聊/群聊控制一个或多个 Codex threads。
- 支持创建 thread、恢复 thread、发送 prompt、追加 steering、停止运行、查看状态。
- 支持 Codex event streaming 聚合显示。
- 支持命令执行和文件变更审批按钮。
- 支持项目绑定：IM chat/thread -> Codex project/cwd/thread_id。
- 支持基础安全：用户白名单、群白名单、项目白名单、敏感命令拦截。

### P1 目标

- 支持飞书/Lark 长连接接入。
- 支持飞书 interactive card 展示状态、diff、approval。
- 支持钉钉 Stream 模式接入。
- 支持 review/start、diff 摘要、plan 更新、token usage 展示。
- 支持 Computer Use 显式命令 `/cu`，并做 app allowlist 和风险提示。
- 支持 SQLite 持久化 session、approval、audit log。

### P2 目标

- 支持 Satori/Koishi adapter，覆盖 QQ、企业微信、微信公众平台等长尾平台。
- 支持 Slack/Discord/Teams，可考虑使用 Vercel Chat SDK adapter。
- 支持轻量 Web console：查看 threads、pending approvals、audit logs、运行状态。
- 支持多 Codex runtime：本机、SSH remote、多个 workspace。

## 3. 非目标

- 不做 OpenClaw 插件。
- 不通过终端 UI 自动输入，也不解析 Codex CLI/TUI 文本输出。
- 不把 Vercel AI SDK 的 `useChat`/message abstraction 作为核心协议模型。
- 不直接公网暴露 Codex App Server。
- P0 不做复杂团队 RBAC；先做白名单和项目级权限。

## 4. 用户画像

### 个人开发者

- Mac mini 常开，多个项目在本机或外接盘。
- 移动端通过 Telegram/飞书/钉钉给 Codex 下任务。
- 需要看到任务进度、approve 命令、查看测试结果。

### 小团队技术负责人

- 希望在团队 IM 中触发 Codex 对某个 repo 做 review、测试、修复。
- 需要群聊权限、项目绑定、审计日志、审批人限制。

## 5. 核心用户故事

1. 作为用户，我可以在 Telegram 里输入 `/new web`，为 `web` 项目创建一个 Codex thread。
2. 作为用户，我可以直接发“帮我修复登录页测试失败”，Codex 开始一个 turn 并持续回传进度。
3. 作为用户，我可以看到 Codex 请求执行 `pnpm test`，并通过按钮选择“允许一次”或“拒绝”。
4. 作为用户，我可以输入 `/stop` 中断正在运行的 turn。
5. 作为用户，我可以输入 `/review` 启动代码 review，并看到 review 结果摘要。
6. 作为用户，我可以输入 `/cu 用 Chrome 打开 localhost:3000 复现登录问题`，让 Codex 使用 Computer Use，但只允许操作 Chrome，并在敏感行为前请求确认。
7. 作为用户，我可以输入 `/status` 看到当前 chat 绑定的 project、thread、active turn、pending approval。

## 6. 关键命令

```text
/start                         初始化说明
/help                          命令帮助
/projects                      列出可用项目
/new <project>                 创建新 thread
/resume [thread]               恢复 thread
/list                          列出近期 threads
/use <project>                 绑定当前 chat 到项目
/status                        当前绑定和运行状态
/stop                          中断当前 turn
/model <name>                  设置默认模型，可选
/review                        启动 review/start
/compact                       请求 Codex 压缩上下文，可选
/plan                          请求只规划不执行，可选
/cu <task>                     显式 Computer Use 任务
/approve <id>                  文本 approval fallback
/deny <id>                     文本 approval fallback
```

## 7. Rich UI 要求

### 普通 streaming

- 不逐 token 发消息。
- 每 1-2 秒编辑一次“进行中”消息。
- turn 结束后发送最终摘要。

### 命令执行

展示：

- cwd
- command
- reason
- running/completed/failed
- stdout/stderr 摘要
- 展开日志的链接或文件附件，P1 再做。

### 文件变更

展示：

- changed files 列表
- diff summary
- 可选 full diff 附件
- review/status

### 审批

按钮：

- 允许一次
- 本会话允许
- 拒绝
- 取消任务

### Computer Use

展示：

- 目标 app
- 当前任务
- 风险提示
- 需要用户显式确认的敏感步骤

## 8. 成功指标

### 功能指标

- P0：Telegram 端可以稳定完成 20 次 thread/turn 循环。
- P0：审批按钮 round-trip 成功率 100%。
- P0：daemon 重启后能够恢复 chat -> thread 绑定。
- P1：飞书/钉钉至少各完成 10 次任务流。
- P1：Computer Use smoke test 在本机可用，并能在 IM 里正确展示状态/风险。

### 质量指标

- 单元测试覆盖 app-server client、event normalizer、approval broker、session router。
- 所有 unknown Codex events 都被记录，不导致进程崩溃。
- App Server 断线后自动重启或提示用户重试。
- 不把 secret、token、审批 payload 原文泄露到公开日志。

## 9. 验收清单

- [ ] `pnpm test` 通过。
- [ ] `pnpm lint` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm smoke:app-server` 可以启动 app-server 并完成 initialize。
- [ ] Telegram `/new`、普通消息、streaming、approval、`/stop` 均可用。
- [ ] SQLite 持久化 chat/thread/project/approval/audit。
- [ ] README 中有 Mac mini launchd 安装步骤。
- [ ] `CLAUDE.md` 和 agent workflow 文档完成。
