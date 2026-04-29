# 17. Claude Code Runbook

本 runbook 用于日常开发时直接指导 Claude Code。

## 1. 标准 session 类型

### 1.1 Planning Session

用途：进入新 phase 或大改动前。

粘贴：

```text
这是 Planning Session。

请阅读 CLAUDE.md、README.md、09-ROADMAP.md、当前 phase 文档和相关实现。
本 session 不允许写代码。
请输出：
1. 目标。
2. 非目标。
3. 当前实现状态。
4. 风险和不确定点。
5. 任务拆分。
6. 每个任务的文件路径、测试、验证命令、退出条件。
7. 需要 Codex CLI 独立验证的点。
8. 需要 gstack/Superpowers 的点。

任务粒度 2-5 分钟。
```

### 1.2 Implementation Session

用途：执行已经批准的 plan。

```text
这是 Implementation Session。

请执行已批准的计划：<计划文件或摘要>。

规则：
1. 严格按任务顺序执行。
2. 每个任务完成后运行对应测试。
3. 不修改计划外文件；如必须修改，先说明。
4. 遇到协议不确定，停下来通过 Codex CLI 或 app-server --help/schema 验证。
5. 遇到安全相关逻辑，默认 fail closed。
6. 完成后输出测试结果和未解决问题。
```

### 1.3 Debug Session

用途：失败测试、真实 app-server 问题、adapter callback 问题。

```text
这是 Debug Session。

问题：<粘贴错误/日志/现象>

请不要大范围改代码。
先做：
1. 复现路径。
2. root cause 假设，最多 3 个。
3. 验证命令。
4. 最小修复计划。
5. 需要新增的回归测试。

得到我确认后再修改代码。
```

### 1.4 Review Session

用途：phase 收尾前。

```text
这是 Review Session。

请审查当前 git diff。
重点：
1. 是否违反 CLAUDE.md。
2. 是否违反架构边界。
3. 是否存在安全问题。
4. 测试是否足够。
5. 文档是否需要更新。
6. 是否需要 Codex CLI 再做独立 review。

请不要改代码，先输出 review report。
```

### 1.5 Docs Session

用途：phase 收尾更新文档。

```text
这是 Docs Session。

请对照当前实现更新文档。
必须检查：
- README.md
- 09-ROADMAP.md
- 当前 phase 涉及的专项文档
- CLAUDE.md 是否需要更新

不要编造未实现能力。
所有新增能力必须对应实际代码或明确标为 planned。
```

## 2. 每日开发节奏

建议一天内的循环：

```text
1. session start：确认当前 phase 和目标。
2. planning：如果没有 plan，先写 plan。
3. implementation：执行 1-3 个小任务。
4. test：运行相关测试。
5. review：Claude 自查 + Codex CLI 独立审查。
6. docs：更新 progress。
7. commit：小步提交。
```

## 3. Claude Code 内部调用 Codex CLI 的规则

Claude Code 可以通过 shell 调用 Codex CLI，但必须遵守：

1. 不把 token、secrets、私人聊天记录粘贴给 Codex CLI。
2. 不让 Codex CLI 直接改大量文件，除非任务明确且有 review。
3. Codex CLI 的建议必须回到 Claude Code 计划里执行。
4. Codex CLI 的 review 结果要按 P0/P1/P2 处理。
5. Codex CLI 不得改变“不是 CLI wrapper”的架构边界。

## 4. 推荐 slash command 流程

### 新 phase

```text
/codex-im-phase-start Phase 2 Telegram MVP
```

### 生成计划

```text
/codex-im-plan Phase 2 Telegram MVP
```

### 执行计划

```text
/codex-im-implement plans/phase-2-telegram.md
```

### 审查

```text
/codex-im-review
```

### smoke

```text
/codex-im-smoke Phase 2 Telegram MVP
```

### 文档收尾

```text
/codex-im-docs Phase 2 Telegram MVP
```

## 5. 什么时候使用 gstack

### `/plan-eng-review`

使用时机：

- 每个 phase plan 写完后。
- 引入新 adapter 或安全策略前。
- AppServerClient/ApprovalBroker/Computer Use 改动前。

提示词：

```text
请用 /plan-eng-review 审查当前 Phase N plan。
重点关注：架构边界、数据流、状态机、错误处理、安全策略、测试覆盖、是否能并行 worktree。
不要写代码，只审计划。
```

### `/plan-design-review`

使用时机：

- Telegram/飞书/钉钉卡片和消息设计。
- Approval UI。
- Web Console。

提示词：

```text
请用 /plan-design-review 审查 IM rich client 的交互设计。
重点关注：用户能否理解当前 Codex 状态、approval 是否清楚、错误提示是否可操作、长输出是否可读、按钮是否安全。
```

### `/guard` / `/freeze`

使用时机：

- 安全模块。
- Computer Use。
- 大范围 refactor 前先锁目录。

提示词：

```text
请使用 /guard。当前只允许修改 <目录>，其他文件只读。
目标是完成 <任务>，不要触碰其他模块。
```

### `/document-release`

使用时机：

- phase 收尾。
- release/tag 前。

提示词：

```text
请使用 /document-release 检查当前实现与文档是否一致。
不要夸大功能，未实现的写 planned。
```

## 6. 什么时候使用 Superpowers

### writing-plans

每个 phase 开头必须使用。

```text
请使用 Superpowers writing-plans。
把 Phase N 拆成小任务，每个任务包含文件路径、实现内容、测试、验证命令和退出条件。
```

### test-driven-development

用于所有 core、安全、adapter routing 模块。

```text
请使用 Superpowers test-driven-development。
先写失败测试，再实现最小代码，再跑测试，再重构。
```

### subagent-driven-development

用于并行任务。

```text
请评估是否适合使用 Superpowers subagent-driven-development。
只有在文件边界清晰、不共享核心状态机时才能并行。
```

### finishing-a-development-branch

每个 phase 收尾。

```text
请使用 Superpowers finishing-a-development-branch。
检查测试、文档、git diff、未完成事项、commit message。
```

## 7. 常见跑偏修正语句

### Claude 想直接写代码

```text
停。现在仍是 planning session。请不要写代码，先输出计划和验收标准。
```

### Claude 想用 Codex CLI wrapper

```text
停。本项目不是 Codex CLI/TUI wrapper。请回到 Codex App Server JSON-RPC rich client 架构。
```

### Claude 跳过测试

```text
停。请先运行本任务对应测试。如果测试命令不存在，请创建或说明合理替代验证，不要跳过。
```

### Claude 过度重构

```text
停。请恢复到最小修复路径。当前任务不是重构，除非先给出重构计划和风险。
```

### Claude 忽略文档

```text
停。请先对照 README、CLAUDE.md、09-ROADMAP.md 和当前 phase 文档，再继续。
```

