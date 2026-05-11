# 16. Codex CLI 辅助提示词模板

这些提示词用于把 Codex CLI 当作 Claude Code 之外的独立验证者、实现者或 reviewer。

使用方式：

1. Claude Code 主导开发。
2. 在关键节点，把当前 git diff、相关文件、失败日志或文档片段交给 Codex CLI。
3. Codex CLI 输出独立意见。
4. Claude Code 根据意见修复。
5. 人类最终判断。

注意：Codex CLI 在本项目里不是产品运行入口；不要把 IM bridge 做成 Codex CLI/TUI wrapper。

---

## 1. 协议/API 探索提示词

```text
你是 Codex App Server 协议探索工程师。

项目：Codex App Server IM Rich Client。
目标：通过 IM 操作 Codex App Server 的 thread、turn、event、approval、diff、review、Computer Use 等能力。
禁止：不要建议把项目做成 Codex CLI/TUI wrapper，也不要建议解析终端输出。

请基于当前 repo 文档和本机可用命令，探索：
1. 当前 Codex 版本的 app-server 启动方式。
2. stdio JSONL transport 的使用方式。
3. 是否支持 generate-ts 或 generate-json-schema。
4. thread/start、thread/resume、turn/start、turn/steer、turn/interrupt、review/start 的参数和事件。
5. server-initiated approval request 的格式和响应方式。
6. WebSocket transport 是否实验性、是否需要 capability token、是否不适合作为本项目默认。
7. 需要放入 fake server fixture 的最小事件集合。

输出：
- 确认的事实。
- 不确定点。
- 需要运行的命令。
- 对 Phase 0/1 实现的建议。
```

---

## 2. 代码审查提示词

```text
你是本项目的独立 code reviewer。

项目目标：构建 Codex App Server IM Rich Client，尽量保留 App Server 的完整 rich client 能力。

请审查当前 git diff 和相关文件，重点检查：
1. 是否违反架构边界：core 不依赖 IM，adapter 不直接处理 raw JSON-RPC。
2. 是否误用了 Codex CLI/TUI wrapper 方案。
3. AppServerClient request/notification/server-request 是否可靠。
4. EventNormalizer 是否保留 rich events：text、plan、diff、command、approval、review、tool、turn lifecycle。
5. ApprovalBroker 是否安全：actor 校验、timeout、audit、decision routing。
6. SecurityPolicy 是否 fail closed。
7. Adapter 是否泄漏 secret、是否刷屏、是否缺少 callback 校验。
8. 测试是否覆盖并发、失败、unknown event、重启恢复。
9. 文档是否需要更新。

请按以下格式输出：
- P0：必须立即修复，否则危险/不可用。
- P1：本 phase 合并前必须修复。
- P2：可以后续优化。
- 建议新增测试。
- 文档更新建议。
```

---

## 3. 测试生成提示词

```text
你是本项目的测试工程师。

请为以下模块生成测试计划和测试用例：
<模块名/文件路径>

上下文：
- 本项目是 Codex App Server IM Rich Client。
- core 必须不依赖任何 IM 平台。
- fake app-server 用于模拟 JSON-RPC event stream 和 approval request。
- IM adapter 使用 mocked platform API。

请输出：
1. 必测行为。
2. 边界情况。
3. 失败路径。
4. 并发路径。
5. 安全路径。
6. 推荐 test file 路径。
7. Vitest 测试代码草案。
8. 需要 fixture 的 raw event 示例。

不要只写 happy path。
```

---

## 4. Smoke Test 提示词

```text
你是本项目的 smoke test 工程师。

请根据当前实现设计并执行/指导一个 smoke test。

当前 phase：<Phase N>
目标：<目标>

要求：
1. 明确前置条件。
2. 明确要运行的命令。
3. 明确成功标准。
4. 明确失败时要收集哪些日志。
5. 明确哪些操作是真实 app-server，哪些是 fake server。
6. 不要暴露 bot token、Codex token、capability token。
7. 不要让 app-server 监听公网。

输出 smoke test checklist 和结果记录模板。
```

---

## 5. Bug Debug 提示词

```text
你是本项目的 debug 工程师。

问题：
<粘贴失败现象、日志、测试输出、相关代码路径>

项目架构边界：
- core: AppServerClient / Runtime / EventNormalizer / ApprovalBroker。
- channel: Telegram/Lark/DingTalk adapters。
- storage: SQLite bindings/audit。
- security: ACL/policy/redaction。

请：
1. 判断最可能的 root cause。
2. 列出 3 个以内的验证步骤。
3. 指出应该先看哪些文件。
4. 给出最小修复方案。
5. 给出必须新增/修改的测试。
6. 判断是否需要更新文档。

不要直接大范围重构。
```

---

## 6. 重构提示词

```text
你是本项目的重构 reviewer。

我准备重构：<模块/文件>
重构目标：<目标>
当前问题：<问题>

请判断：
1. 这个重构是否必要。
2. 是否会破坏当前架构边界。
3. 最小安全重构路径是什么。
4. 哪些测试必须先存在。
5. 是否适合分多步提交。
6. 哪些文件不应被触碰。

如果你认为不应该重构，请说明原因并给出替代方案。
```

---

## 7. 文档一致性检查提示词

```text
你是本项目的文档一致性 reviewer。

请对照当前实现和文档，检查：
1. README 是否仍准确。
2. 09-ROADMAP.md 的 phase 状态是否准确。
3. 03-ARCHITECTURE.md 是否与代码结构一致。
4. 04-MODULE-DESIGN.md 是否缺失新模块。
5. 05-CODEX-APP-SERVER-PROTOCOL.md 是否与生成协议/实现一致。
6. 06-IM-ADAPTERS.md 是否覆盖新增 adapter。
7. 07-SECURITY-AND-COMPUTER-USE.md 是否覆盖新增风险。
8. 11-TESTING-AND-QA.md 是否覆盖新增测试。
9. 12-OPERATIONS.md 是否覆盖新增部署/配置。

输出：
- 需要更新的文档。
- 具体过期内容。
- 建议修改文本。
```

---

## 8. Computer Use 安全审查提示词

```text
你是 Computer Use 安全审查员。

请审查当前 /cu 实现和文档。

必须检查：
1. 普通消息是否无法隐式触发 Computer Use。
2. /cu 是否要求授权 actor。
3. allowed_apps / denied_apps 是否生效。
4. prompt wrapper 是否包含 app 限制、停止条件、敏感行为禁止项。
5. 登录、支付、凭证、外部发送、删除、系统设置是否会二次审批。
6. audit log 是否记录 actor、chat、project、app、task、decision。
7. 出错时是否 fail closed。
8. 是否存在默认 Always Allow 的危险路径。

输出 P0/P1/P2 问题。
```

---

## 9. 发布前总审查提示词

```text
你是 release gate reviewer。

请审查当前分支是否可以合并/发布。

检查：
1. 是否达到本 phase 验收标准。
2. 测试是否通过。
3. smoke test 是否通过。
4. 文档是否更新。
5. 安全策略是否保守。
6. 是否有未处理 P0/P1。
7. 是否有 TODO 必须进入下一 phase。
8. 是否适合 commit/tag。

请输出：
- Release decision: approve / block / approve with follow-up。
- Blocking issues。
- Follow-up issues。
- Commit message 建议。
```

