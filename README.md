# Codex IM Rich Client 文档包

本包是一套用于开发“基于 Codex App Server 的 IM rich client”的项目蓝图。目标是在 Mac mini 上常驻运行一个本地 daemon，通过 Telegram、飞书、钉钉等 IM 远程控制 Codex App Server，并尽可能保留 Codex App Server 的完整能力：thread/turn、流式事件、命令执行、文件变更、review、approval、Computer Use 等。

## 推荐阅读顺序

1. `01-PRD.md`：产品目标、用户故事、范围与验收标准。
2. `02-TECHNICAL-DECISIONS.md`：关键技术选型，尤其是 Chat SDK、Koishi/Satori、native adapter 的取舍。
3. `03-ARCHITECTURE.md`：整体架构、部署拓扑、数据流、核心边界。
4. `04-MODULE-DESIGN.md`：分模块设计。
5. `05-CODEX-APP-SERVER-PROTOCOL.md`：App Server 协议接入策略、事件归一化、审批流。
6. `06-IM-ADAPTERS.md`：Telegram、飞书、钉钉、Satori/Koishi、Vercel Chat SDK 的接入方式。
7. `07-SECURITY-AND-COMPUTER-USE.md`：权限、审批、安全边界、Computer Use 风险控制。
8. `08-DATA-MODEL.md`：SQLite 表结构与状态模型。
9. `09-ROADMAP.md`：MVP 到可用版本的迭代计划。
10. `10-CLAUDE-CODE-CODEX-WORKFLOW.md`：如何使用 Claude Code + gstack + Superpowers + Codex CLI 完成本项目开发。
11. `11-TESTING-AND-QA.md`：测试矩阵、模拟 App Server、真实 smoke test。
12. `12-OPERATIONS.md`：Mac mini 常驻运行、launchd、日志、监控、备份。
13. `13-IMPLEMENTATION-SKELETON.md`：建议目录结构、接口、配置、脚本。
14. `CLAUDE.md`：可以直接复制到项目根目录的 Claude Code 项目说明。
15. `.claude/commands/*`：建议创建的 Claude Code 自定义命令草案。

## 一句话架构

```text
IM 平台
  -> 本地 codex-im-bridge daemon
  -> Codex App Server JSON-RPC client
  -> codex app-server / Codex App runtime / Computer Use
  -> Codex events, approval requests, diffs, status cards
  -> IM rich UI
```

## 核心原则

- App Server rich client 核心自研，不套普通 LLM chat 框架。
- IM 平台接入不完全从零写：Telegram 用 grammY 或原生 Bot API；飞书用官方 Node SDK；钉钉用官方 Stream SDK；Satori/Koishi 作为长尾平台兼容层；Vercel Chat SDK 作为 Slack/Discord/Teams 等后续适配候选。
- 默认 stdio 连接 `codex app-server`，不要公网暴露 App Server。
- 所有敏感操作必须走 approval broker，Computer Use 必须有更严格的二次安全策略。
- Claude Code 是主开发入口；Codex CLI 用于协议生成、独立 review、非交互验证和 App Server smoke test。

## 补充：第一次 AI 协作操作手册

本 v2 文档包新增：

- `14-OPERATION-GUIDE-AND-PROMPTS.md`：完整开发操作指南。
- `15-PHASE-BY-PHASE-PROMPTS.md`：Phase 0-8 的 Claude Code / Codex CLI 提示词。
- `16-CODEX-CLI-PROMPTS.md`：Codex CLI 独立验证、review、debug、测试生成提示词。
- `17-CLAUDE-CODE-RUNBOOK.md`：Claude Code 日常 session runbook。
- `18-HOOKS-AND-GUARDRAILS.md`：hooks 与安全 guardrails 建议。
- `prompts/`：可复制提示词库。
- `hooks/`：stop check 脚本草案。
- `.claude/commands/`：更完整的项目 slash commands。
