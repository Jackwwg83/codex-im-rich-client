# /codex-im-release

参数：$ARGUMENTS

请执行 phase/release 收尾：$ARGUMENTS。

必须：
1. git diff 检查。
2. pnpm typecheck/test/lint。
3. phase smoke test。
4. Codex CLI independent review。
5. 修复 P0/P1。
6. 更新文档和 roadmap。
7. 输出 release decision 和 commit message。
