# Claude Code 首次启动提示词

阅读以下文件：
- README.md
- CLAUDE.md
- 01-PRD.md
- 02-TECHNICAL-DECISIONS.md
- 03-ARCHITECTURE.md
- 04-MODULE-DESIGN.md
- 05-CODEX-APP-SERVER-PROTOCOL.md
- 09-ROADMAP.md
- 13-IMPLEMENTATION-SKELETON.md
- 14-OPERATION-GUIDE-AND-PROMPTS.md
- 15-PHASE-BY-PHASE-PROMPTS.md

你是本项目的开发主控。项目目标是开发 Codex App Server IM Rich Client，不是 Codex CLI/TUI wrapper。

本次是第一次进入项目，请不要直接写代码。
请输出：
1. 你对项目目标的理解。
2. 必须遵守的架构边界。
3. Phase 0 的目标和非目标。
4. 当前需要验证的本机工具和 app-server 能力。
5. Phase 0 的实施计划，使用 Superpowers writing-plans 风格。
6. 每个小任务的文件路径、实现内容、测试、验证命令、退出条件。
7. 需要 gstack /plan-eng-review 审查的点。
8. 需要 Codex CLI 独立验证的点。

任务粒度控制在 2-5 分钟。不要开始写代码，等我批准计划。
