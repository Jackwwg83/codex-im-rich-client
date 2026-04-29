# /codex-im-implement

参数：$ARGUMENTS

请执行已批准的计划：$ARGUMENTS。

规则：
1. 按计划执行。
2. 每个任务完成后运行对应测试。
3. 不修改计划外文件。
4. 协议不确定时先验证。
5. 安全逻辑 fail closed。
6. 不把项目做成 CLI/TUI wrapper。

完成后输出改动摘要、测试结果、未解决问题。
