# CLAUDE.md：Codex IM Rich Client 项目规则

## 项目目标

本项目要实现一个基于 Codex App Server 的 IM rich client。Mac mini 上常驻运行 daemon，通过 Telegram、飞书、钉钉等 IM 控制 Codex App Server，保留 thread/turn/item、streaming、approval、diff、review、Computer Use 等能力。

## 绝对不要做

- 不要把项目实现成 OpenClaw 插件。
- 不要通过解析 Codex CLI/TUI 终端输出实现功能。
- 不要把 Vercel AI SDK 的普通 chat abstraction 作为 Codex 核心。
- 不要公网暴露 Codex App Server。
- 不要默认绕过 approvals。
- 不要让 Computer Use 被普通 prompt 隐式触发。

## 必须坚持的架构

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

核心层自研：

- AppServerClient
- CodexRuntime
- EventNormalizer
- ApprovalBroker
- SessionRouter
- SecurityPolicy
- RenderScheduler

IM 平台只通过 ChannelAdapter 接入。

## 技术栈

- TypeScript
- Node.js 20+
- pnpm workspace
- SQLite
- Vitest
- Telegram: grammY/native API
- Feishu/Lark: @larksuiteoapi/node-sdk
- DingTalk: dingtalk-stream-sdk-nodejs

## 开发流程

1. 先读 docs 中相关设计。
2. 使用 Superpowers：brainstorming -> writing-plans -> TDD -> review -> finish。
3. 使用 gstack：重要架构任务先 `/plan-eng-review`，高风险任务用 `/guard`，收尾用 `/document-release`。
4. 每个任务只改计划内文件。
5. 关键模块先写 failing tests。
6. 每个 phase 结束调用 Codex CLI 做独立 review。

## 常用命令

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm protocol:generate
pnpm smoke:app-server
```

## Codex CLI 的用途

可以使用 Codex CLI 来：

- 生成 App Server protocol types。
- 运行 app-server smoke/debug。
- 做独立 code review。
- 生成测试计划。

但运行时代码不能依赖“解析 Codex CLI/TUI 输出”。

## 安全规则

- 所有 approval 必须可审计。
- 非白名单用户/群不能触发任务。
- Computer Use 必须 `/cu` 显式触发。
- deny app/deny command 不可被普通 approval 绕过。
- 日志必须 redact secrets。

## 结束任务前检查

- 是否有测试？
- 是否跑了 `pnpm test/typecheck/lint`？
- 是否更新文档？
- 是否有 unknown risk？
- 是否需要 Codex CLI 独立 review？
