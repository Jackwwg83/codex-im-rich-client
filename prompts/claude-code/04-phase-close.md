# Claude Code Phase Close 模板

请收尾 Phase <N>：<名称>。

必须执行：
1. 检查 git diff。
2. 运行 pnpm typecheck / pnpm test / pnpm lint，若不存在则说明并运行可用替代。
3. 运行本 phase smoke test。
4. 用 Codex CLI 做独立 review。
5. 修复所有 P0/P1。
6. 更新 09-ROADMAP.md。
7. 更新 README.md 和相关专项文档。
8. 输出最终验收结果。
9. 输出 commit message 草案。

不能跳过失败测试。无法执行的检查必须写明原因和后续补救任务。
