# AGENTS.md：Codex IM Rich Client 项目规则

## 项目目标

本项目要实现一个基于 Codex App Server 的 IM rich client。Mac mini 上常驻运行 daemon，通过 Telegram、飞书、钉钉等 IM 控制 Codex App Server，保留 thread/turn/item、streaming、approval、diff、review、Computer Use 等能力。

## 绝对不要做

- 不要把项目实现成 OpenClaw 插件。
- 不要通过解析 Codex CLI/TUI 终端输出实现功能。
- 不要把 Vercel AI SDK 的普通 chat abstraction 作为 Codex 核心。
- 不要公网暴露 Codex App Server。
- 不要默认绕过 approvals。
- 不要让 Computer Use 被普通 prompt 隐式触发。

## 必须坚持的架构

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

核心层自研：

- AppServerClient
- CodexRuntime
- EventNormalizer
- ApprovalBroker
- SessionRouter
- SecurityPolicy
- RenderScheduler

IM 平台只通过 ChannelAdapter 接入。

## 技术栈

- TypeScript
- Node.js 24+ (Node 20 reached EOL 2026-04-30; project bumped pre-Phase-1)
- pnpm workspace
- SQLite
- Vitest
- Telegram: grammY/native API
- Feishu/Lark: @larksuiteoapi/node-sdk
- DingTalk: dingtalk-stream-sdk-nodejs

## 开发流程

1. 先读 docs 中相关设计。
2. 使用 Superpowers：brainstorming -> writing-plans -> TDD -> review -> finish。
3. 使用 gstack：重要架构任务先 `/plan-eng-review`，高风险任务用 `/guard`，收尾用 `/document-release`。
4. 每个任务只改计划内文件。
5. 关键模块先写 failing tests。
6. 每个 phase 结束调用 Codex CLI 做独立 review。
7. Autonomous loop sessions must follow `docs/automation/codex-app-autonomous-loop-runbook.md`.

### Autonomous loop operator directive (2026-05-02)

When the human explicitly starts an unattended autonomous loop, do not stop for
routine technical approvals after a clean recovery report. Reconstruct context,
verify the branch/HEAD/working tree/gates, then continue the next safe Linear
issue. For technical ambiguity, consult GPT Pro using the runbook template
instead of asking the human product owner to decide. Preserve hard safety
boundaries by using reversible commits, private branches, tests, docs, and
sanitized consultation packets.

## 常用命令

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm protocol:generate
pnpm smoke:app-server
```

## Codex CLI 的用途

可以使用 Codex CLI 来：

- 生成 App Server protocol types。
- 运行 app-server smoke/debug。
- 做独立 code review。
- 生成测试计划。

但运行时代码不能依赖“解析 Codex CLI/TUI 输出”。

## 安全规则

- 所有 approval 必须可审计。
- 非白名单用户/群不能触发任务。
- Computer Use 必须 `/cu` 显式触发。
- deny app/deny command 不可被普通 approval 绕过。
- 日志必须 redact secrets。

## Method literal policy (Phase 1 tag-gate fix, 2026-05-01)

Production source code must not scatter Codex App Server JSON-RPC method
string literals. The boundary is enforced (partly by build-time grep
guard, partly by code review) so that protocol-method drift is caught
in one place when codex bumps versions.

**ClientRequest method literals** (e.g. `"thread/start"`, `"turn/start"`,
`"review/start"`):

- Raw calls like `client.request("thread/start", ...)` are forbidden in
  production `src` outside the approved central runtime method table.
- The approved home: `packages/codex-runtime/src/runtime.ts` —
  `REQUEST_METHODS` const declared `as const satisfies Record<string,
  ClientRequest["method"]>`. Wrappers like `runtime.threadStart(...)` /
  `runtime.turnStart(...)` are how downstream code invokes these methods.
- CLI, daemon, and IM adapters MUST use `CodexRuntime` wrappers instead
  of raw `client.request("...")`. If a wrapper is missing for a method
  Phase N needs, add the wrapper to `runtime.ts` (with a `REQUEST_METHODS`
  entry); do not duplicate the literal at the call site.

**ServerRequest method literals** (e.g. `"item/fileChange/requestApproval"`,
`"applyPatchApproval"`, `"account/chatgptAuthTokens/refresh"`):

- Two approved homes (Phase 1 + Phase 2):
  - `packages/core/src/approval-broker.ts` — `DispatchTable` typed
    `as const satisfies Record<ServerRequest["method"], DispatcherSpec>`
    plus the `_ExhaustiveDispatch` type-level guard.
  - `packages/core/src/approval-request-kind.ts` (Phase 2 T2 / D18) —
    `METHOD_TO_KIND` table used by `classifyApprovalRequest()`. This
    is the SOLE place renderer / channel-core / wire-up code reaches
    when classifying an approval; downstream code never reads the
    raw method string.
- T20 (Phase 2) replaced the Phase 1 `git grep -F` pipeline with a
  filesystem walk over an explicit allowlist
  (`packages/core/test/no-method-literals.test.ts` `SCANNED_DIRS` +
  `ALLOWED_FILES`). Scope extended to `packages/render/src/**`,
  `packages/channel-core/src/**`, plus `packages/im-*/src/**` (when
  shipped). Plus an explicit T20.3 assertion that
  `packages/core/src/decision-mapper.ts` contains zero method literals
  (mapper switches on `ApprovalRequestKind`, never on raw strings).
- Synthetic unknown-method tests must use names like `"future/unseen/
  method"` and must not pretend to be real approval protocol methods.

**Allowed exceptions** (legitimate references; not boundary violations):

- `docs/**` — handoffs, plans, review reports, protocol audits.
- `TODOS.md` — backlog tracking that may quote method names verbatim.
- `packages/testkit/fixtures/**` and fixture metadata (`metadata.json`).
- `scripts/**` — audit / verification scripts that read protocol evidence
  (e.g. `scripts/verify-phase1-fixtures.mts`).
- `**/README.md` examples that quote method names AS examples (CLI
  README's "what `runtime send` exercises" section).
- `packages/codex-protocol/src/generated/**` — ts-rs generated types
  carry literals as discriminator strings; this is correct.
- Test files (`**/test/**`) — tests may reference method names to
  assert dispatch correctness; the grep guard exempts test paths.

**Disallowed**:

- `packages/cli/src/**` — raw `client.request("thread/start", ...)` etc.
  Use `CodexRuntime` wrappers.
- `packages/daemon/src/**` — same.
- `packages/render/src/**` (Phase 2 +) — renderer switches on
  `ApprovalRequestKind` from `classifyApprovalRequest()`, never on
  raw method strings. F1 boundary.
- `packages/channel-core/src/**` (Phase 2 +) — channel adapters
  consume `ApprovalAction` (= `ApprovalUiAction`) only; the wire
  shape is the broker's concern.
- Future `packages/im-*/src/**` (Phase 3+) — same.
- `packages/codex-runtime/src/**` — except inside the `REQUEST_METHODS`
  const table itself.
- `packages/core/src/**` — except inside `approval-broker.ts`'s
  `DispatchTable` keys AND `approval-request-kind.ts`'s `METHOD_TO_KIND`
  table. `decision-mapper.ts` MUST switch on `ApprovalRequestKind`
  (T20.3 explicit assertion).

If a future audit script needs to reference a method literal in
production source code, document it in this section before adding.

## Phase 2 redlines (carry forward to Phase 3+)

In addition to the project-wide redlines (start of this file):

- ❌ **No first-actor-wins** — `bindActorPolicy` is the only way to grant
  approval permission. `resolve()` validates per-card per call.
  See `packages/core/src/approval-broker.ts` `actorAllowed` /
  `targetEqual`. (D19 / Codex round-1 P0-5)
- ❌ **No `expirePending()` as a security boundary** — `expirePending`
  is a sweep utility for audit/metrics. `resolve()` MUST also
  lazy-check `Date.now() >= expiresAt` before settle (D20 / Codex
  missing #4 / T11.3).
- ❌ **No `entry.settleOnce` modification** — body byte-for-byte
  locked at Phase 1 tag. All settle paths route through
  `#settleEntry` (D21). Byte-identical guard test exists in
  `packages/core/test/approval-broker-t7-public-surface.test.ts`.
- ❌ **No `"approve"` wire decision** — v2 = `"accept"`; legacy =
  `"approved"`. Mapper switches per `ApprovalRequestKind` (D11 /
  Codex round-1 P1-1). `packages/core/src/decision-mapper.ts`.
- ❌ **Production = `Supervisor`; `runtime-send` = dev/operator only**
  (Codex Q6 / D16 / T22). `Supervisor.#spawnFresh` head asserts
  `broker.isAttached()` with a load-bearing error message naming the
  split. Daemon production wire-up MUST attach the broker before
  passing it to Supervisor.
- ❌ **F13 channel-core boundary** — `packages/channel-core/src/**`
  has NO runtime import of `@codex-im/core`, `@codex-im/codex-runtime`,
  or `@codex-im/app-server-client`. Type-only consumption via
  `@codex-im/render` is allowed. Boundary tests
  `packages/channel-core/test/no-broker-import.test.ts` +
  `no-protocol-import.test.ts` enforce.
- ❌ **C-P1 unknown-snapshot must render decline-only** — if a
  `PendingApprovalSnapshot` reaches the renderer with
  `classifyApprovalRequest(method) === "unknown"`, project to a
  decline-only `ApprovalCard` with `target.riskLevel = "critical"`,
  `actions = [{kind: "decline"}]`. Broker's `#handle` already
  fail-closes at `-32601`; this is defense-in-depth at the renderer.

## 结束任务前检查

- 是否有测试？
- 是否跑了 `pnpm test/typecheck/lint`？
- 是否更新文档？
- 是否有 unknown risk？
- 是否需要 Codex CLI 独立 review？

## Compact / Resume Instructions

After auto-compaction, manual `/compact`, `/resume`, or context loss, Codex must not continue implementation immediately.

First enter Context Recovery Mode:

1. Read:
   - AGENTS.md
   - README.md
   - current phase plan under docs/superpowers/plans/
   - latest handoff under docs/handoffs/
   - docs/handoffs/phase1-live-status.md if present
   - 09-ROADMAP.md
   - TODOS.md

2. Run:
   - git status --short
   - git diff --stat
   - git diff --name-only

3. Reconstruct:
   - current branch and HEAD
   - current phase/task
   - completed tasks
   - modified files
   - tests already run
   - next exact action
   - applicable redlines

4. Stop and output a Context Recovery Report.

Do not modify code after compaction until the user approves the recovery report.

Persistent project redlines:
- This project is a Codex App Server native IM Rich Client.
- Do not implement a Codex CLI/TUI wrapper.
- Do not parse terminal output as product protocol.
- Do not hard-code unknown approval method names.
- Do not implement real IM adapters before the approved phase.
- Do not implement Computer Use production flow before the approved phase.
- Do not expose public WebSocket listeners.
- Unknown App Server events must not be silently dropped.
- Security and approval logic must fail closed.
