# Claude Code Implementation 模板

我批准计划：<计划名/摘要>。

请开始实现，但遵守：
1. 按计划逐项执行。
2. 每个任务完成后运行对应测试。
3. 不修改计划外文件；如必须修改，先说明原因。
4. 协议字段不确定时，先通过 codex app-server --help/schema 或 Codex CLI 验证。
5. 所有 core/security/adapter routing 新增逻辑必须有测试。
6. 敏感行为 fail closed。
7. 不要把产品实现成 Codex CLI/TUI wrapper。

每完成一组小任务，输出：
- 完成内容。
- 修改文件。
- 测试结果。
- 下一步。
