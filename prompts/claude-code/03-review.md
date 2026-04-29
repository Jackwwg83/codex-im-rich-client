# Claude Code Review 模板

请审查当前 git diff。

重点：
1. 是否符合 CLAUDE.md。
2. 是否符合 03-ARCHITECTURE.md 模块边界。
3. 是否误用 Codex CLI/TUI wrapper。
4. core 是否独立于 IM adapter。
5. adapter 是否只消费 ChannelAdapter/CodexRichEvent。
6. approval/security/audit 是否 fail closed。
7. 测试是否覆盖 happy path、失败路径、unknown event、权限失败。
8. 文档是否需要更新。

不要修改代码，先输出 review report。按 P0/P1/P2 分类。
