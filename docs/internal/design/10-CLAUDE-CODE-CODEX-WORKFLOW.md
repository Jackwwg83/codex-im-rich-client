# Claude Code + Codex CLI 开发工作流

## 1. 你的工作方式映射

你日常使用：

```text
Claude Code = 项目开发主入口、任务编排者、代码实现者
Codex CLI = 独立验证者、协议生成工具、测试/审查/调试助手
GStack = 角色化 review、计划、设计、文档、安全、浏览器验证
Superpowers = 强制结构化开发流程：brainstorm -> worktree -> plan -> execute -> TDD -> review -> finish
```

本项目建议严格采用“Claude 主导，Codex 交叉验证”的双 agent 工作流。

## 2. 项目根目录 `CLAUDE.md`

使用本包的 `CLAUDE.md` 作为项目根目录说明。它会告诉 Claude Code：

- 目标产品不是 CLI wrapper。
- 核心必须保留 Codex App Server rich events。
- P0 技术边界。
- 每次修改后的必跑命令。
- 什么时候调用 Codex CLI 做独立 review。

## 3. GStack 推荐使用方式

### 产品与架构阶段

```text
/plan-eng-review
```

用于检查：

- 架构边界。
- 数据流。
- 状态机。
- trust boundaries。
- 测试覆盖。

```text
/plan-design-review
```

用于检查：

- IM 里的卡片/按钮/审批 UX。
- Telegram/飞书/钉钉降级策略。
- streaming 是否刷屏。

### 实现阶段

```text
/freeze packages/app-server-client
```

限制 Claude 只改指定模块，避免一次任务乱改全 repo。

```text
/guard
```

在处理 security、approval、Computer Use、secret redaction 时使用。

### QA 与发布阶段

```text
/browse
```

用于 Web console 或飞书/钉钉卡片在浏览器/调试台中的视觉检查。

```text
/document-release
```

每个 phase 结束后更新 README、CHANGELOG、docs。

```text
/retro
```

每个大里程碑后复盘测试健康度、未解决风险。

## 4. Superpowers 推荐使用方式

### 标准流程

1. `brainstorming`：先确认设计，不直接写代码。
2. `using-git-worktrees`：每个 phase 建独立 worktree/branch。
3. `writing-plans`：把实现拆成 2-5 分钟的小任务，每项带文件路径和验证命令。
4. `subagent-driven-development` 或 `executing-plans`：逐任务执行。
5. `test-driven-development`：关键模块先写 failing test。
6. `requesting-code-review`：每个模块完成后 review。
7. `finishing-a-development-branch`：合并/保留/丢弃。

### 强制应用的模块

| 模块 | Superpowers skill |
|---|---|
| app-server-client | test-driven-development, systematic-debugging |
| approval-broker | test-driven-development, requesting-code-review |
| security | systematic-debugging, verification-before-completion |
| adapters | executing-plans, verification-before-completion |
| Computer Use | brainstorming, writing-plans, requesting-code-review |

## 5. Claude Code 调用 Codex CLI 的方式

### 5.1 协议生成

```bash
codex app-server generate-ts --out packages/codex-protocol/src/generated
codex app-server generate-json-schema --out packages/codex-protocol/schema
```

### 5.2 App Server debug

```bash
codex debug app-server send-message-v2 "只回复 OK，不运行命令"
```

用于观察真实事件结构，更新 normalizer fixtures。

### 5.3 独立 code review

建议创建 wrapper：

```bash
scripts/codex-review.sh packages/app-server-client "Review JSON-RPC request correlation and approval handling. Focus on race conditions and malformed JSON."
```

wrapper 内部可以调用你本机熟悉的 Codex CLI 非交互/exec 模式。不要让业务代码依赖这个 wrapper，它只用于开发。

### 5.4 独立测试设计

```bash
scripts/codex-test-plan.sh packages/codex-runtime "Find missing tests for event normalizer and turn state machine."
```

Codex 输出应被 Claude Code 读取后转成具体测试。

## 6. 推荐 Claude Code 自定义命令

见 `.claude/commands/`：

- `codex-im-plan.md`
- `codex-im-implement.md`
- `codex-im-review.md`
- `codex-im-smoke.md`
- `codex-im-docs.md`

## 7. 推荐 hooks

### PreToolUse：阻止危险命令

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block-dangerous-bash.sh"
          }
        ]
      }
    ]
  }
}
```

### PostToolUse：编辑后快速检查

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/quick-check.sh",
            "async": true,
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

### Stop：不满足条件不允许结束

Stop hook 检查：

- 是否运行了本 phase 的验证命令。
- 是否更新了相关文档。
- 是否记录了未解决风险。
- 是否需要 Codex CLI 独立 review。

## 8. 每个 phase 的开发模板

### Step 1：开分支/worktree

```bash
git checkout -b phase-1-runtime-core
```

或使用 Superpowers `using-git-worktrees`。

### Step 2：让 Claude Code 制定 plan

Prompt：

```text
阅读 docs/09-ROADMAP.md 中 Phase 1，使用 Superpowers writing-plans，把任务拆成 2-5 分钟小任务。每个任务必须包含：文件路径、要写的测试、实现内容、验证命令。不要开始写代码，先输出计划。
```

### Step 3：gstack 工程 review

```text
/plan-eng-review
```

### Step 4：执行任务

Prompt：

```text
按已批准计划执行 Task 1。严格 TDD：先写 failing test，再写最小实现，再跑测试。只修改计划中列出的文件。
```

### Step 5：Codex CLI 独立 review

```bash
scripts/codex-review.sh packages/app-server-client "Review the implementation against docs/05-CODEX-APP-SERVER-PROTOCOL.md."
```

### Step 6：Claude Code 修复 Codex 指出的问题

Prompt：

```text
读取 Codex review 输出，只修复其中真实且与本 phase 相关的问题。对不采纳的问题写明原因。
```

### Step 7：收尾

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm smoke:app-server
```

然后：

```text
/document-release
```

## 9. Codex 与 Claude 分工建议

| 工作 | 主导 | 辅助 |
|---|---|---|
| 产品需求整理 | Claude + gstack | Codex review |
| App Server 协议观察 | Codex CLI | Claude 整理 fixtures |
| TypeScript 实现 | Claude Code | Codex review |
| 测试设计 | Claude Code | Codex 找遗漏 |
| 协议 schema 生成 | Codex CLI 命令 | Claude 提交产物 |
| 安全审查 | Claude + gstack /guard | Codex independent review |
| 文档更新 | Claude + /document-release | Codex sanity check |

## 10. 注意事项

- 不要让 Claude 把目标实现成“调用 codex CLI 并解析输出”。
- 不要让 Codex CLI review 直接改代码，除非你明确把它作为实现 agent。
- App Server 真实事件以本机生成 schema 和 debug 输出为准。
- 所有协议未知字段集中在 normalizer 处理。
- 安全模块必须 TDD。
