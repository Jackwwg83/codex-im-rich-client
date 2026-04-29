# Codex CLI：测试生成

请为模块 <模块/文件> 生成测试计划和 Vitest 草案。

必须覆盖：
1. happy path。
2. failure path。
3. unknown event / invalid input。
4. concurrency / timeout。
5. security / authorization failure。
6. restart persistence，如适用。

输出推荐测试文件路径、fixture、测试代码草案。
