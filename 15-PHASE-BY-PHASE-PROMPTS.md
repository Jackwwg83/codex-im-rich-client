# 15. Phase-by-Phase 操作指南与提示词

本文件把 `09-ROADMAP.md` 的每个阶段变成可直接粘贴给 Claude Code 的工作指令。

每个 phase 都包含：

- 开始前检查
- Claude Code 开始提示词
- gstack / Superpowers 建议
- Codex CLI 辅助提示词
- 验收清单
- 收尾提示词

---

## Phase 0：项目初始化与协议验证

### 目标

建立 monorepo、协议生成、app-server 最小通信、fake server 基础测试环境。

### 开始前检查

```bash
node --version
pnpm --version
claude --version
codex --version
codex app-server --help
```

### Claude Code 开始提示词

```text
进入 Phase 0：项目初始化与协议验证。

请阅读：
- CLAUDE.md
- README.md
- 03-ARCHITECTURE.md
- 05-CODEX-APP-SERVER-PROTOCOL.md
- 09-ROADMAP.md
- 13-IMPLEMENTATION-SKELETON.md
- 14-OPERATION-GUIDE-AND-PROMPTS.md

不要马上写代码。
先输出 Phase 0 implementation plan，使用 Superpowers writing-plans 风格。

Phase 0 目标：
1. 初始化 pnpm workspace。
2. 建立 packages skeleton。
3. 配置 TypeScript、Vitest、lint/format。
4. 实现 protocol:generate 脚本。
5. 实现 JSONL transport 最小读写。
6. 实现 fake app-server testkit 的起点。
7. 实现 smoke:app-server 脚本，能 initialize/account-read 或最小 thread 操作。

必须明确：
- 哪些命令需要从 codex app-server --help 验证。
- 哪些字段来自生成协议，不能猜。
- 哪些测试先用 fake server。
- 哪些测试才连真实 app-server。

请把任务拆成 2-5 分钟粒度，并标出每个任务的文件路径、测试、验证命令、退出条件。
```

### gstack / Superpowers

建议顺序：

```text
Superpowers writing-plans
→ gstack /plan-eng-review
→ 人类批准
→ Superpowers executing-plans 或 Claude Code 手动执行
```

### Codex CLI 辅助提示词

```text
你是本项目的独立协议验证工程师。

项目目标：开发 Codex App Server IM Rich Client，不是 Codex CLI wrapper。
当前任务：验证本机 codex app-server 的可用命令、transport、协议生成方式、最小 initialize 流程。

请检查：
1. codex app-server --help 输出里有哪些 listen/generate/schema 相关选项。
2. 是否支持 generate-ts 或 generate-json-schema。
3. stdio JSONL transport 的启动方式。
4. WebSocket 是否需要 capability token，是否不应在本项目 Phase 0 使用。
5. 给出 Phase 0 里 protocol:generate 和 smoke:app-server 的建议命令。

不要建议解析 codex CLI/TUI 输出。
如果你不确定某个命令，请要求先运行 --help 验证。
```

### 验收清单

- [ ] `pnpm install` 成功。
- [ ] `pnpm typecheck` 可运行。
- [ ] `pnpm test` 至少跑通 fake test。
- [ ] `protocol:generate` 成功或明确记录当前 Codex 版本无法生成时的替代方式。
- [ ] JSONL transport 有 request id correlation 测试。
- [ ] app-server smoke test 可以启动并完成最小 initialize/account-read。
- [ ] 任何真实 app-server 连接只使用 stdio 或 localhost。
- [ ] README 补充 Phase 0 启动方式。

### 收尾提示词

```text
请收尾 Phase 0。

执行：
1. git diff 审查。
2. pnpm typecheck。
3. pnpm test。
4. 如果有 lint 命令，运行 lint。
5. 运行 smoke:app-server；如果无法运行，写明具体原因和下一步。
6. 使用 Codex CLI 做一次独立 review：重点看是否误把项目做成 CLI wrapper、协议生成是否可靠、fake test 是否覆盖核心路径。
7. 更新 09-ROADMAP.md 和 README.md。
8. 输出 commit message 草案。
```

---

## Phase 1：Codex Runtime Core

### 目标

完成不依赖 IM 的 Codex Runtime Core：AppServerClient、Runtime 状态机、EventNormalizer、ApprovalBroker、FakeAppServer。

### Claude Code 开始提示词

```text
进入 Phase 1：Codex Runtime Core。

请阅读：
- 03-ARCHITECTURE.md
- 04-MODULE-DESIGN.md
- 05-CODEX-APP-SERVER-PROTOCOL.md
- 08-DATA-MODEL.md
- 11-TESTING-AND-QA.md
- Phase 0 的实现和测试

不要马上写代码。
先输出 Phase 1 plan。

必须实现/完善：
1. AppServerClient：request、notification、server-initiated request、timeout、shutdown。
2. JSONL transport：stdout/stderr 处理、line framing、invalid json 处理。
3. EventNormalizer：把 raw App Server events 归一化成 CodexRichEvent。
4. CodexRuntime：thread/turn/item/pending approval 状态。
5. ApprovalBroker：pending request、decision routing、timeout、audit hook。
6. FakeAppServer testkit：模拟 event stream、approval request、unknown event。
7. CLI smoke 命令：runtime send / app-server smoke。

原则：
- 先写 fake server contract test。
- 不要把 IM 平台逻辑混入 core。
- unknown event 必须记录但不能崩溃。
- approval 必须是 first-class state，不能只是回调。
- 所有 raw event 到 rich event 的转换都要有测试。

请拆成 2-5 分钟任务，并标出可以并行的任务和必须串行的任务。
```

### gstack / Superpowers

- 用 `/plan-eng-review` 审模块边界和事件状态机。
- 用 Superpowers `test-driven-development` 建议先写 fake server 和 normalizer 测试。
- 如果任务较多，用 `subagent-driven-development`，但不要让多个 agent 同时改 `AppServerClient`。

### Codex CLI 辅助提示词

```text
你是本项目 Phase 1 的独立 code reviewer。

请审查当前 git diff，重点看：
1. AppServerClient 是否正确区分 client request、server notification、server-initiated request。
2. request id correlation 是否有并发测试。
3. JSONL framing 是否能处理 partial lines、invalid JSON、stderr。
4. EventNormalizer 是否没有丢失 approval/diff/plan/command/tool 事件。
5. ApprovalBroker 是否有 pending、decision、timeout、audit 路径。
6. core 包是否没有依赖 Telegram/飞书/钉钉。
7. unknown event 是否不会导致 runtime 崩溃。

请按 P0/P1/P2 分级输出问题，并给出最小修复建议。
```

### 验收清单

- [ ] fake server 可模拟 initialize、turn started、delta、completed、approval request。
- [ ] AppServerClient 并发 request 测试通过。
- [ ] EventNormalizer snapshot 或 fixture 测试通过。
- [ ] ApprovalBroker 能处理 allow_once / allow_session / deny / cancel。
- [ ] unknown event 不崩溃。
- [ ] runtime CLI 能跑 fake 和真实 app-server 最小流程。

---

## Phase 2：Telegram MVP

### 目标

Telegram 私聊/群聊端到端：收消息、绑定 thread、启动 turn、流式渲染、approval inline keyboard、stop/status。

### Claude Code 开始提示词

```text
进入 Phase 2：Telegram MVP。

请阅读：
- 06-IM-ADAPTERS.md
- 08-DATA-MODEL.md
- 07-SECURITY-AND-COMPUTER-USE.md
- Phase 1 core 实现

不要马上写代码。
先输出 Phase 2 plan。

必须实现：
1. ChannelAdapter interface。
2. Telegram adapter。
3. CommandRouter：/start /projects /new /resume /status /stop。
4. SessionRouter：chat_id/topic_id ↔ thread_id/project/cwd/model。
5. SQLite storage。
6. RenderScheduler：delta 合并、edit message、长文本切分。
7. Approval inline keyboard。
8. 基础白名单。

原则：
- Telegram adapter 不能直接依赖 raw App Server events，只接收 CodexRichEvent。
- 流式输出必须节流，不能每个 delta 发一条消息。
- approval callback 必须校验操作者是否有权限。
- daemon 重启后绑定必须恢复。
- token 只能来自 env/config，不得写入 repo。

请拆成任务，并明确 mock Telegram API 的测试方案。
```

### gstack / Superpowers

- `/plan-design-review`：审 Telegram 消息展示、按钮、错误提示。
- `/plan-eng-review`：审 adapter/core 边界。
- Superpowers TDD：先测 CommandRouter、SessionRouter、RenderScheduler。

### Codex CLI 辅助提示词

```text
你是 Phase 2 Telegram adapter 的独立 reviewer。

请审查：
1. TelegramAdapter 是否实现 ChannelAdapter，而不是泄漏平台细节到 core。
2. /new /resume /status /stop 的状态转换是否正确。
3. RenderScheduler 是否节流并支持长文本切分。
4. approval callback 是否校验 user/chat 权限和 approval id。
5. SQLite storage 是否有迁移和重启恢复测试。
6. bot token 是否不会进入日志或 repo。
7. 错误提示是否不会泄露敏感路径/secret。

按 P0/P1/P2 输出问题。
```

### 验收清单

- [ ] Telegram 私聊能 `/start`。
- [ ] `/new <project>` 创建或绑定 thread。
- [ ] 普通消息触发 `turn/start`。
- [ ] active turn 时消息使用 `turn/steer` 或清晰提示。
- [ ] streaming 以 edit message 展示。
- [ ] approval inline keyboard 能 allow/deny。
- [ ] `/stop` 能 interrupt。
- [ ] daemon 重启后 session 绑定恢复。

---

## Phase 3：安全与审计

### 目标

让本机 daemon 可以长期安全运行：ACL、project policy、deny pattern、audit log、secret redaction、approval timeout、launchd。

### Claude Code 开始提示词

```text
进入 Phase 3：安全与审计。

请阅读：
- 07-SECURITY-AND-COMPUTER-USE.md
- 08-DATA-MODEL.md
- 12-OPERATIONS.md
- Phase 2 Telegram 实现

不要马上写代码。
先输出 Phase 3 plan。

必须实现：
1. allowed_users / allowed_chats。
2. project ACL：哪些 chat/user 可操作哪些 project。
3. command deny patterns。
4. audit log schema 与写入。
5. secret redaction。
6. approval timeout。
7. launchd plist 生成或安装脚本。
8. health/status 命令增强。

原则：
- 默认拒绝未知用户、未知群、未知 project。
- 安全策略失败时 fail closed。
- audit log 不记录 secret。
- launchd 不应暴露 app-server 端口。
- 不要为了方便测试默认 allow all。

请拆任务，并明确每个安全点的单元测试和集成测试。
```

### gstack / Superpowers

- 用 `/guard` 或 `/freeze` 限制改动范围，尤其是安全模块。
- 用 gstack 的安全/工程审查模式检查默认策略。
- Superpowers TDD：先写 deny 测试。

### Codex CLI 辅助提示词

```text
你是 Phase 3 安全审计 reviewer。

请审查当前实现是否存在：
1. 默认 allow all。
2. 未授权用户可触发 turn/approval。
3. approval id 可被猜测或跨 chat 使用。
4. secret/token 被写入日志。
5. command deny patterns 可被简单绕过。
6. App Server 被网络暴露。
7. launchd plist 泄露密钥或不安全权限。
8. audit log 缺少 actor/action/target/decision/timestamp。

请输出 P0/P1/P2 问题和修复建议。
```

### 验收清单

- [ ] 未授权用户无法触发命令。
- [ ] 未授权群无法触发命令。
- [ ] 未授权 project 无法绑定。
- [ ] approval 只能由授权 actor 决策。
- [ ] secret redaction 测试通过。
- [ ] audit log 记录所有敏感操作。
- [ ] launchd 启停可用，且不暴露 app-server。

---

## Phase 4：飞书/Lark

### 目标

实现飞书长连接、消息接收、interactive card、approval roundtrip、状态卡片更新。

### Claude Code 开始提示词

```text
进入 Phase 4：飞书/Lark。

请阅读：
- 06-IM-ADAPTERS.md
- Phase 2 Telegram adapter
- Phase 3 security 实现

不要马上写代码。
先输出 Phase 4 plan。

必须实现：
1. Lark adapter skeleton。
2. 长连接或本地可用的事件接收方式。
3. 文本消息 / mention bot 解析。
4. sendText / edit 或 update card 能力映射。
5. interactive card renderer。
6. card action callback → ApprovalBroker。
7. 卡片更新节流。
8. 飞书 actor/chat 与 SecurityPolicy 对接。

原则：
- 飞书 adapter 不能影响 Telegram adapter。
- 共同逻辑只能放到 ChannelAdapter/renderer 层。
- approval 操作必须校验 open_id/chat_id。
- card schema 要有 snapshot test。

请拆任务，并先实现 mock Lark adapter test，再接真实 SDK。
```

### gstack / Superpowers

- `/plan-design-review`：飞书卡片布局、按钮文案、状态更新。
- `/plan-eng-review`：adapter capability mapping。

### Codex CLI 辅助提示词

```text
你是 Phase 4 飞书 adapter reviewer。

请审查：
1. 是否使用 ChannelAdapter 抽象而不是复制 Telegram 逻辑。
2. 飞书 card action 是否正确映射 approval decision。
3. actor/chat/project ACL 是否生效。
4. card schema 是否可测试、可更新、不会刷屏。
5. 错误处理和 reconnect 是否合理。
6. 飞书凭据是否只来自 env/config。

输出 P0/P1/P2 问题。
```

### 验收清单

- [ ] 飞书私聊或群 mention 能触发。
- [ ] `/new`、`/status`、`/stop` 可用。
- [ ] approval card allow/deny 可用。
- [ ] streaming/status card 可更新且节流。
- [ ] 未授权 open_id/chat_id 被拒绝。

---

## Phase 5：钉钉

### 目标

实现钉钉 Stream 模式、消息接收、互动卡片、approval roundtrip、reconnect。

### Claude Code 开始提示词

```text
进入 Phase 5：钉钉。

请阅读：
- 06-IM-ADAPTERS.md
- Phase 4 Lark adapter
- Phase 3 security 实现

不要马上写代码。
先输出 Phase 5 plan。

必须实现：
1. DingTalk adapter skeleton。
2. Stream mode client。
3. bot receive message。
4. sendText 或 card send。
5. interactive card renderer。
6. card callback → ApprovalBroker。
7. reconnect/backoff。
8. 钉钉 actor/chat 与 SecurityPolicy 对接。

原则：
- 和飞书共用 RichCard 中间结构，但不要强迫两个平台卡片完全一样。
- 卡片更新频率必须受控。
- callback 必须校验 actor。
- SDK 连接失败不能让 core runtime 崩溃。
```

### gstack / Superpowers

- 飞书已完成后，可用 subagent-driven-development 把 DingTalk adapter 作为独立 workstream。
- 用 `/plan-design-review` 审卡片 fallback。

### Codex CLI 辅助提示词

```text
你是 Phase 5 钉钉 adapter reviewer。

请审查：
1. Stream 连接和 reconnect/backoff。
2. 卡片 callback 到 ApprovalBroker 的映射。
3. actor/chat ACL。
4. 错误处理不会影响 core runtime。
5. 卡片更新是否节流。
6. 凭据是否安全。

输出 P0/P1/P2 问题。
```

### 验收清单

- [ ] 钉钉至少一种会话形态可收发消息。
- [ ] approval roundtrip 可用。
- [ ] reconnect/backoff 有测试或手工验证。
- [ ] 未授权 actor 被拒绝。

---

## Phase 6：Computer Use

### 目标

通过 IM 安全触发 Codex App Computer Use，同时保护账号、隐私、桌面和敏感操作。

### Claude Code 开始提示词

```text
进入 Phase 6：Computer Use。

请阅读：
- 07-SECURITY-AND-COMPUTER-USE.md
- 05-CODEX-APP-SERVER-PROTOCOL.md
- Phase 3 security 实现
- Phase 2/4/5 adapter 实现

不要马上写代码。
先输出 Phase 6 plan。

必须实现：
1. /cu 命令。
2. ComputerUsePolicy。
3. prompt wrapping：明确限制 app、目标、停止条件。
4. allowed_apps / denied_apps。
5. sensitive step approval。
6. audit log 增强。
7. smoke test 文档：Chrome-only、本地网页、无凭证提交。

原则：
- 没有 /cu 不触发 Computer Use。
- 默认 deny 高风险 app：Keychain、1Password、System Settings 等。
- 涉及登录、支付、凭证、删除、外部发送必须二次确认。
- 不要自动批准 Computer Use 的敏感步骤。
- 如果 App Server 对 Computer Use 支持不确定，先做 spike，不要假装已支持。

请先列出需要验证的 App Server / Codex App 行为，再拆实现任务。
```

### gstack / Superpowers

- 用 `/plan-eng-review` 审 Computer Use 的安全状态机。
- 用 `/guard` 限制安全模块改动。
- 不建议并行开发 Computer Use 核心策略。

### Codex CLI 辅助提示词

```text
你是 Phase 6 Computer Use 安全 reviewer。

请审查：
1. 是否只有 /cu 能触发 Computer Use。
2. prompt wrapper 是否明确 app allowlist、stop conditions、禁止提交凭据/支付/删除。
3. denied_apps 是否默认存在。
4. sensitive action 是否进入 ApprovalBroker。
5. audit log 是否记录 actor、target app、prompt、decision。
6. 是否存在自动批准敏感动作。
7. 是否有手工 smoke test 文档。

输出 P0/P1/P2 问题。P0 包括任何可能导致远程误操作桌面/账号的漏洞。
```

### 验收清单

- [ ] `/cu status` 可用。
- [ ] `/cu Chrome-only <task>` 或等价命令可用。
- [ ] 无 `/cu` 的普通消息不会注入 Computer Use 指令。
- [ ] denied app 被拒绝。
- [ ] 敏感动作会请求确认。
- [ ] audit log 记录 Computer Use。
- [ ] 手工 smoke test 成功或明确记录阻塞原因。

---

## Phase 7：扩展平台：Satori/Koishi 与 Vercel Chat SDK POC

### 目标

验证是否值得通过 Satori/Koishi 或 Vercel Chat SDK 支持长尾平台。

### Claude Code 开始提示词

```text
进入 Phase 7：扩展平台 POC。

请阅读：
- 02-TECHNICAL-DECISIONS.md
- 06-IM-ADAPTERS.md
- Telegram/Lark/DingTalk adapter 实现

不要马上写代码。
先输出 POC plan。

必须验证：
1. Satori/Koishi 是否能覆盖长尾中文 IM。
2. Vercel Chat SDK 是否适合作为 Slack/Discord/Teams/GitHub/Linear 等 adapter 层。
3. 两者对 buttons/cards/edit/streaming/file/thread 的能力矩阵。
4. approval fallback 是否可用。
5. 引入后的维护成本。

原则：
- POC 不得改动 core 架构。
- 不得替换已有 native adapter。
- 结果必须产出决策文档：adopt / defer / reject。
```

### Codex CLI 辅助提示词

```text
你是 Phase 7 adapter framework POC reviewer。

请对照当前 ChannelAdapter 能力矩阵，审查 Satori/Koishi 或 Vercel Chat SDK POC：
1. 是否保留 Codex rich events。
2. 是否支持 approval 按钮或 fallback。
3. 是否支持消息更新或 streaming fallback。
4. 是否增加过多抽象泄漏。
5. 是否值得纳入 P2。

请输出 adopt/defer/reject 建议和理由。
```

### 验收清单

- [ ] 至少一个 Satori/Koishi POC 或明确 defer。
- [ ] 至少一个 Chat SDK POC 或明确 defer。
- [ ] 能力矩阵更新。
- [ ] 技术决策文档更新。

---

## Phase 8：Web Console 与团队能力

### 目标

加入本地可观察性和管理后台：pending approvals、bindings、logs、health。

### Claude Code 开始提示词

```text
进入 Phase 8：Web Console 与团队能力。

请阅读：
- 12-OPERATIONS.md
- 08-DATA-MODEL.md
- 07-SECURITY-AND-COMPUTER-USE.md
- 已完成的 adapters 和 audit log

不要马上写代码。
先输出 Phase 8 plan。

必须实现或规划：
1. local-only web console。
2. pending approvals dashboard。
3. project/binding 管理。
4. audit log 浏览。
5. health endpoints。
6. 基础 auth 或 local-only 访问限制。

原则：
- Web Console 默认只监听 localhost。
- 不允许公网无认证访问。
- 不改变 IM 控制面的主路径。
- gstack /browse 可用于 UI 验收。
```

### 验收清单

- [ ] localhost web console 可访问。
- [ ] pending approvals 可查看。
- [ ] audit log 可查看。
- [ ] health endpoint 可用。
- [ ] 外部网络不可访问或需要认证。

