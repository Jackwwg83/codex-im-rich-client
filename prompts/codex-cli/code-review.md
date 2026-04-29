# Codex CLI：代码审查

你是本项目独立 code reviewer。
请审查当前 git diff。

重点：
- 是否违反 Codex App Server rich client 架构。
- 是否误做成 CLI/TUI wrapper。
- AppServerClient/EventNormalizer/ApprovalBroker 是否可靠。
- SecurityPolicy 是否 fail closed。
- Adapter 是否权限校验、节流、redaction。
- 测试是否覆盖关键路径。

按 P0/P1/P2 输出问题和修复建议。
