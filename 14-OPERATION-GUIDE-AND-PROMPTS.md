# 14. 全套操作指南与协作提示词

## 1. 角色分工

### 1.1 GPT Pro

GPT Pro 用于：

- 产品方向讨论
- 架构取舍
- 新技术调研
- 文档包生成或修订
- 阶段复盘
- 发现 Claude Code / Codex CLI 跑偏时重新校准

不要让 GPT Pro 直接成为日常写代码主入口；写代码、改文件、跑测试由 Claude Code 主导。

### 1.2 Claude Code

Claude Code 是开发主控：

- 读取 repo 文档和 `CLAUDE.md`
- 写 implementation plan
- 拆任务
- 编辑代码
- 调用测试
- 维护进度文档
- 调用 Codex CLI 做独立验证
- 执行 gstack / Superpowers 流程

Claude Code 必须始终把自己当成“工程负责人”，不是随手 patch 的代码助手。

### 1.3 Codex CLI

Codex CLI 在本项目里有两个身份：

1. **开发辅助 agent**：在 Claude Code 之外做协议探索、代码审查、测试生成、debug、重构建议。
2. **被研究对象的工具链入口**：用于启动或检查 `codex app-server`、生成协议 schema、做 smoke test。

禁止把本项目实现成：

```text
IM message → shell → codex CLI interactive session → parse terminal output
```

### 1.4 gstack

gstack 用于高压审查：

- `/plan-eng-review`：架构、数据流、边界、测试、性能、并行 worktree 机会。
- `/plan-design-review`：IM rich UI、卡片、按钮、审批交互、状态展示。
- `/guard` / `/freeze`：高风险改动或单目录修复时限制文件编辑范围。
- `/browse`：后续 Web Console 或本地 UI 验收。
- `/document-release`：每个 phase 收尾更新文档。

### 1.5 Superpowers

Superpowers 用于强制工程纪律：

- brainstorming：早期梳理问题。
- writing-plans：生成详细 plan，拆成小任务。
- test-driven-development：先写测试再实现。
- subagent-driven-development：有多个独立模块时并行执行。
- executing-plans：按计划执行。
- requesting-code-review：请求代码审查。
- finishing-a-development-branch：完成分支收尾。

## 2. 总体工作流

每个 phase 都按同一个循环走：

```text
A. Phase intake
   ↓
B. Claude Code 读文档 + 输出计划
   ↓
C. gstack / Superpowers 审计划
   ↓
D. 人类批准计划
   ↓
E. Claude Code TDD 实现
   ↓
F. 本地测试 + fake server / smoke test
   ↓
G. Codex CLI 独立 review
   ↓
H. 修复 review 问题
   ↓
I. 更新文档与 roadmap
   ↓
J. commit / tag / 下一 phase
```

## 3. 每次开启 Claude Code session 的标准动作

粘贴或使用 `.claude/commands/codex-im-session-start.md`：

```text
你正在开发 Codex App Server IM Rich Client。
先阅读 CLAUDE.md、README.md、09-ROADMAP.md，以及本次 phase 相关文档。
不要立刻写代码。
先输出：
1. 当前 phase 目标。
2. 当前 repo 状态假设。
3. 必须遵守的架构边界。
4. 今日最小可交付成果。
5. 需要我确认的真正阻塞项。
如果没有阻塞项，请给出下一步计划。
```

## 4. Phase 开始提示词模板

```text
进入【Phase N：<名称>】。

请阅读：
- README.md
- CLAUDE.md
- 09-ROADMAP.md
- 03-ARCHITECTURE.md
- 04-MODULE-DESIGN.md
- 本 phase 涉及的专项文档

请不要马上改代码。
请先使用 Superpowers writing-plans 的方式，输出 Phase N 的实施计划。
计划必须包含：
1. 目标和非目标。
2. 需要修改/新增的文件路径。
3. 每个任务的实现内容。
4. 每个任务的测试。
5. 每个任务的验证命令。
6. 可能需要 Codex CLI 独立验证的点。
7. 需要 gstack review 的点。
8. 验收标准。
9. 回滚策略。
10. 禁止事项。

任务粒度控制在 2-5 分钟可执行。
```

## 5. Phase 执行提示词模板

```text
我批准上面的 Phase N plan。

请按计划执行，但遵守以下规则：
1. 不要修改计划之外的文件，除非先说明原因。
2. 每完成一个小任务，运行对应测试或最小验证命令。
3. 遇到协议字段不确定时，先用 Codex CLI 或 app-server help/schema 验证，不要猜。
4. 所有新增模块都必须有测试。
5. 任何涉及权限、approval、Computer Use、网络监听、密钥的改动，都必须保守处理。
6. 完成后输出：改动摘要、测试结果、未解决问题、下一步建议。
```

## 6. Phase 收尾提示词模板

```text
请收尾当前 Phase N。

必须执行：
1. 检查 git diff。
2. 运行 pnpm typecheck、pnpm test、pnpm lint。如果命令尚未存在，说明原因并运行可用替代检查。
3. 运行本 phase smoke test。
4. 使用 Codex CLI 做一次独立 code review。
5. 修复 review 中的 P0/P1 问题。
6. 更新 09-ROADMAP.md 的完成状态。
7. 更新 README.md 或相关专项文档。
8. 输出 commit message 草案。

不要自行跳过失败测试。
如果某项无法执行，必须写明原因、风险和后续补救任务。
```

## 7. 如何调用 Codex CLI

在 Claude Code 内部，你可以要求它用 shell 调用 Codex CLI，也可以自己在另一个 terminal 中执行。

建议把 Codex CLI 用作“第二工程师”，提示词见 `16-CODEX-CLI-PROMPTS.md`。

典型用途：

```text
协议探索：让 Codex CLI 研究当前 codex app-server help/schema 输出。
代码审查：让 Codex CLI 审查当前 git diff 是否违反架构。
测试生成：让 Codex CLI 针对某模块补充边界测试。
debug：让 Codex CLI 根据日志和失败测试找原因。
文档一致性：让 Codex CLI 对照实现检查文档是否过期。
```

不要让 Codex CLI 直接决定架构边界；架构边界来自文档和 Claude Code plan，必要时回到 GPT Pro 讨论。

## 8. Worktree 与并行开发策略

### 可以并行的内容

- Phase 1 中：fake app-server、JSONL transport、EventNormalizer 测试可部分并行。
- Phase 2 中：Telegram renderer、SQLite schema、CommandRouter 可在接口稳定后并行。
- Phase 4 与 Phase 5：飞书和钉钉 adapter 可以并行。
- Phase 7：Satori POC 和 Vercel Chat SDK POC 可以并行。

### 必须串行的内容

- AppServerClient request/server-request 基础协议。
- EventNormalizer 的核心事件类型。
- ApprovalBroker 的状态机。
- SecurityPolicy 的默认 deny 规则。
- Computer Use 的安全策略。

### 并行提示词

```text
请使用 Superpowers subagent-driven-development 评估当前 plan 中哪些任务可以并行。
要求：
1. 只并行接口已经稳定的任务。
2. 每个 subagent 必须有明确输入、输出、文件边界、测试命令。
3. 所有 subagent 完成后，主 agent 必须做整合测试。
4. 不要让多个 subagent 同时修改同一文件。
5. 如果并行会增加风险，请改为串行。
```

## 9. 什么时候回到 GPT Pro

遇到以下情况，不要让 Claude Code/Codex CLI 在代码里硬试：

1. App Server 协议和预期不一致，影响架构。
2. Computer Use 是否能通过 App Server 触发不确定。
3. IM adapter 抽象无法同时覆盖 Telegram/飞书/钉钉。
4. 安全策略需要重新取舍。
5. 需要决定是否引入 Satori、Koishi、Vercel Chat SDK。
6. Phase 计划连续两次失败。
7. 代码结构开始偏离文档中的模块边界。

回到 GPT Pro 的提示词：

```text
我们正在开发 Codex App Server IM Rich Client。
当前处于 Phase N：<名称>。
目前文档假设是：<摘要>。
实际遇到的问题是：<日志/现象/失败测试>。
Claude Code 的判断是：<摘要>。
Codex CLI 的独立 review 是：<摘要>。
请帮我重新判断架构/方案，不要直接写代码。
请给出：原因分析、可选方案、推荐方案、需要修改的文档、下一步给 Claude Code 的提示词。
```

## 10. 禁止事项

1. 禁止把本项目实现成 Codex CLI/TUI 输出解析器。
2. 禁止把 App Server 暴露到公网。
3. 禁止跳过 approval broker 直接自动批准危险操作。
4. 禁止在没有 `/cu` 显式命令时触发 Computer Use。
5. 禁止把密钥、bot token、capability token 写进 repo。
6. 禁止手写覆盖协议生成产物，除非文档明确说明。
7. 禁止用“能跑就行”的方式绕过 fake server contract test。
8. 禁止每个 streaming delta 都发 IM 消息导致刷屏。
9. 禁止在没有审计日志的情况下执行敏感操作。
10. 禁止让不同平台 adapter 直接依赖 Codex raw JSON-RPC event。

