# Phase 6 Plan - Explicit Computer Use Flow

Status: approved v1.1 for implementation
Generated: 2026-05-03
Base tag: `phase-5-dingtalk-adapter-complete`
Branch: `codex/phase-6-computer-use`
Linear parent: JAC-11
Current gate: JAC-101 final review / handoff / tag

## 1. Mission

Phase 6 enables Computer Use from IM without weakening the product boundary:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

The target is an explicit, auditable `/cu` flow. A normal prompt must never
enable Computer Use, even if the text asks the model to open a browser or click
desktop UI. `/cu` creates a scoped Computer Use request context, wraps the user
task with hard safety instructions, and allows `item/tool/call` only through a
daemon-side policy/session gate.

Phase 6 does not implement OpenClaw, Codex CLI/TUI parsing, public App Server
listeners, Satori/Koishi, Vercel Chat SDK, Web Console, or unattended live
desktop smokes.

## 2. Source Of Truth

- Phase 5 close: `docs/handoffs/phase5-live-status.md`
- Phase 5 to Phase 6 handoff: `docs/handoffs/2026-05-02-phase5-to-phase6.md`
- Phase 6 live status: `docs/handoffs/phase6-live-status.md`
- Computer Use security: `07-SECURITY-AND-COMPUTER-USE.md`
- Security guardrails: `18-HOOKS-AND-GUARDRAILS.md`
- Testing guidance: `11-TESTING-AND-QA.md`
- Protocol evidence: `05-CODEX-APP-SERVER-PROTOCOL.md` and generated
  `packages/codex-protocol/src/generated/**`
- Existing command boundary: `packages/core/src/command-router.ts`
- Existing daemon prompt path: `packages/daemon/src/daemon.ts`
- Loop runbook: `docs/automation/codex-app-autonomous-loop-runbook.md`
- Linear: JAC-11 parent, JAC-91 through JAC-101 execution children plus any
  plan-added children.

Current local protocol evidence:

- Codex 0.128.0 generated `ServerRequest` contains `item/tool/call`.
- `DynamicToolCallParams` has `threadId`, `turnId`, `callId`, `namespace`,
  `tool`, and `arguments`.
- `DynamicToolCallResponse` is `{ contentItems, success }`.
- Existing Phase 2/3 code classifies `item/tool/call` as `tool_call` and
  default-rejects it as `{ contentItems: [], success: false }`.
- No generated type names a first-class `computer_use` request. Phase 6 must
  treat Computer Use as a reviewed dynamic-tool capability, not as a guessed
  protocol method.

## 3. Hard Redlines

- No Computer Use without explicit `/cu` or `/computer-use`.
- No heuristic "desktop intent" trigger from ordinary prompts.
- No automatic approval for sensitive desktop actions.
- No direct IM adapter access to Computer Use, `ApprovalBroker`,
  `CodexRuntime`, `AppServerClient`, storage, daemon internals, or protocol
  packages.
- No public Codex App Server listener.
- No public IM webhook introduced by Phase 6.
- No browser cookies, Keychain values, OAuth tokens, passwords, recovery codes,
  `.env` contents, or private session data in docs, Linear, fixtures, SQLite,
  logs, or prompts sent to GPT Pro/Codex review.
- Denied apps fail closed. Default denied apps include 1Password, Keychain
  Access, System Settings, Terminal, password managers, wallet/payment apps,
  and security/privacy settings.
- Sensitive steps fail closed unless an explicit approval is recorded. Sensitive
  steps include credential entry, payment, purchase, transfer, deletion,
  external send/post/comment, publication, production config changes, and
  account/security setting changes.
- `item/tool/call` is denied unless it is tied to an active scoped `/cu`
  context for the same target/thread/turn/actor.
- Tool-call results and audit metadata are redacted before storage/logging.
- Live desktop smoke is env/operator gated and must not run by default.

## 4. Key Decision: Computer Use Execution Boundary

The risky boundary is not parsing `/cu`; it is deciding when a dynamic tool call
may operate the desktop. Phase 6 selects a two-gate design:

1. **Intent gate**: `CommandRouter` recognizes only explicit `/cu` and
   `/computer-use` commands. These produce a structured Computer Use intent.
2. **Tool-call gate**: daemon/broker only permits `item/tool/call` while an
   active `ComputerUseSession` exists for the same Codex thread/turn/target and
   the requested tool/app passes `ComputerUsePolicy`.

This means a normal prompt like "open Chrome and click the login button" is
just a normal prompt. If the model later attempts a dynamic tool call anyway,
the tool-call gate sees no active `/cu` context and rejects the call.

### Provider Decision

Phase 6 must not guess how Codex App Server exposes real Computer Use execution.
The generated protocol proves the dynamic-tool request/response shape, but not
the concrete namespace/tool names or whether the local Codex App Computer Use
plugin can be invoked from this daemon.

Therefore Phase 6 implementation uses a provider boundary:

```text
item/tool/call
  -> ApprovalBroker handler
  -> ComputerUseSessionRegistry
  -> ComputerUsePolicy
  -> ComputerUseProvider
```

Provider modes:

| Mode | Default | Purpose |
|---|---:|---|
| `fake` | tests/smoke | Deterministic no-desktop provider for TDD and CI. |
| `unsupported` | production fallback | Fail closed when real provider is not configured or capability is unknown. |
| `codex-app` | gated later | Real provider only after capability evidence and live/manual smoke docs are reviewed. |

JAC-91 must produce a capability evidence document before any real provider is
implemented. If evidence is insufficient, Phase 6 can still ship the parser,
policy, session gate, fake provider, audit, and docs while leaving real provider
activation behind a reviewed follow-up.

## 5. Phase 6 Architecture

### Core Additions

Planned core surfaces:

```text
packages/core/src/computer-use-command.ts
packages/core/src/computer-use-policy.ts
packages/core/src/computer-use-prompt.ts
```

Responsibilities:

- Parse `/cu`, `/computer-use`, `/cu status`, and optional app specifiers.
- Return structured `ComputerUseIntent`; do not start desktop work.
- Evaluate `ComputerUsePolicy` against target app, requested task, actor,
  project, sensitivity, and config.
- Build a prompt wrapper that constrains the model and tells it to stop before
  sensitive actions.

`CommandRouter` may import these local core helpers. It must not import daemon,
runtime, app-server-client, IM adapters, or protocol types.

### Config Additions

Planned config shape:

```toml
[computer_use]
enabled = false
require_explicit_prefix = true
default_app = "Google Chrome"
allowed_apps = ["Google Chrome"]
deny_apps = ["1Password", "Keychain Access", "System Settings", "Terminal"]
unknown_app_policy = "deny"
require_approval_keywords = [
  "login",
  "password",
  "token",
  "payment",
  "checkout",
  "delete",
  "send",
  "submit",
  "publish",
  "transfer"
]
live_smoke_enabled = false
```

Config stores app names and env-var names only. It never stores cookies,
passwords, tokens, or browser/profile secrets. Unknown or unlisted apps are
denied until an operator updates `allowed_apps`; Phase 6 does not support
"approve a new app from the card" because that would weaken app policy into a
runtime social prompt.

### Broker Integration

`item/tool/call` remains a raw ServerRequest method literal. Per
`AGENTS.md`, production code outside `packages/core/src/approval-broker.ts` and
`packages/core/src/approval-request-kind.ts` must not carry that literal.

Phase 6 therefore must not add daemon code like:

```ts
broker.registerHandler("item/tool/call", ...)
```

Instead, JAC-163/JAC-97 must add a broker-owned typed API such as:

```ts
broker.registerDynamicToolCallHandler(handler)
```

The exact name can change during implementation, but the invariant cannot: the
raw method literal stays inside the broker's approved method table home, and the
daemon calls a typed wrapper. The handler returns `DynamicToolCallResponse` and
is the only path that may reach a `ComputerUseProvider`.

Do not use broker pending-mode for provider execution. Current `tool_call`
pending resolution maps only `decline` to `{ contentItems: [], success: false }`;
it cannot safely execute a provider after approval.

### Daemon Additions

Planned daemon surfaces:

```text
ComputerUseSessionRegistry
ComputerUseToolGate
ComputerUseProvider
```

`ComputerUseSessionRegistry` binds:

- IM target
- sender actor
- project id
- Codex thread id
- active turn id
- allowed app
- task summary
- expiry

The registry is scoped and short-lived. It is not a general session permission.
It is cleared on turn completion, stop/interrupt, daemon shutdown, route change,
or timeout.

`ComputerUseToolGate` rejects dynamic tool calls when:

- no active `/cu` session exists
- target/thread/turn/actor does not match
- namespace/tool is not an allowed Computer Use tool
- app is denied, unknown, or not allowlisted
- task or arguments contain sensitive step signals without approval
- arguments are malformed or cannot be redacted safely
- provider is unavailable

### Approval Model

Phase 6 does not add first-actor-wins. It reuses the existing approval pattern:

- `/cu` safe setup can be a command/prompt route.
- Each sensitive step must either create a deliberate broker-owned synthetic
  approval through the same broker/card/token path already used by
  Telegram/Lark/DingTalk, or fail closed until that synthetic approval API
  exists.
- Sensitive approval is ask-always; no session-level sensitive-step approval.
- Sensitive approval cards must expose only allow-once and decline/abort style
  actions. They must not expose `allow_session`.
- Denied apps and disallowed external actions are policy denials, not approval
  candidates.

### Audit Model

Add daemon/storage audit actions such as:

- `computer_use.intent_created`
- `computer_use.intent_denied`
- `computer_use.prompt_wrapped`
- `computer_use.tool_call_allowed`
- `computer_use.tool_call_denied`
- `computer_use.sensitive_step_requested`
- `computer_use.sensitive_step_resolved`
- `computer_use.provider_unavailable`
- `computer_use.live_smoke_skipped`

Audit metadata must include target key, project id, app, redacted task summary,
decision, and reason. It must not include raw browser content, cookies,
passwords, tokens, form values, screenshots, or full tool arguments when those
may contain secrets.

## 6. Task Plan

### T0 - JAC-91 Plan Review Gate

Allowed files:

- `docs/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md`
- `docs/handoffs/phase6-live-status.md`
- `docs/phase-6/*`
- `README.md`
- `TODOS.md`
- Linear issue descriptions/comments

Body:

- Create this plan and live-status.
- Create capability evidence stub under `docs/phase-6/`.
- Run Codex outside-voice review.
- If review returns P0/P1, patch plan before implementation.
- Update Linear JAC-91.

Exit:

- Plan review returns GO or GO_WITH_LOW_NITS, or all P0/P1 fixes are absorbed.
- JAC-92 may start only after this gate is green.

### T1 - JAC-92 Explicit `/cu` Parser Only

- Extend command parsing to recognize `/cu` and `/computer-use`.
- Return structured Computer Use intent or `/cu status` command.
- Preserve existing normal prompt behavior.
- No desktop action, no provider, no protocol handler.

First failing test:

- `/cu open Chrome` parses as Computer Use intent.
- `open Chrome` remains a normal prompt and does not create intent.

### T2 - JAC-93 ComputerUsePolicy Schema

- Add policy types and evaluator.
- Default disabled.
- Default denied apps are present.
- Invalid or empty allowlist fails closed.
- Denied app wins over allowlist.

First failing test:

- Policy denies `Keychain Access` even if the task text asks for it.

### T3 - JAC-94 Config Schema For Allowed/Denied Apps

- Extend `@codex-im/config` with `[computer_use]`.
- Parse env-free app policy fields.
- Reject secret-looking values in app/config fields.
- Keep existing adapter secret resolution unchanged.

First failing test:

- Config with `deny_apps = ["1Password"]` parses, but config containing a
  token-shaped app value is rejected or redacted according to the local pattern.

### T4 - JAC-95 Prompt Wrapper

- Build `wrapComputerUsePrompt(intent, policyDecision)`.
- Include allowed app, explicit stop conditions, and sensitive-step rules.
- Do not include secrets, raw target ids, or private chat ids.
- Daemon uses wrapper only for `/cu`, never for normal prompts.

First failing test:

- Wrapper contains "Do not submit credentials" and the allowed app, while
  preserving the sanitized task.

### T5 - JAC-96 Normal Prompt Cannot Create Computer Use Intent

- Add parser/daemon invariant tests for the early route.
- Normal prompt path must not create a Computer Use intent or session.
- This task does not prove the full dynamic-tool gate; that requires the
  broker-owned handler/session registry added in JAC-163/JAC-97.

First failing test:

- A normal prompt saying "use Chrome to click" remains a normal prompt and does
  not create CU context.

### T6 - JAC-163 Capability Evidence / Provider Boundary

- Document observed `DynamicToolCallParams` shape for Computer Use from local
  generated protocol and, if possible, a fake/controlled app-server trace.
- Record exact observed namespace/tool names, argument schema, and redaction
  requirements. If a controlled trace is not possible, record a blocker instead
  of guessing.
- Add the broker-owned typed dynamic-tool registration API; no raw method
  literal in daemon.
- Define `ComputerUseProvider` interface.
- Implement fake and unsupported providers only.
- Do not implement real desktop control in this task.

First failing test:

- Unsupported provider returns `{ success: false, contentItems: [] }` and emits
  `computer_use.provider_unavailable`.

### T7 - JAC-97 Sensitive-Step Approval Model

- Introduce scoped `ComputerUseSessionRegistry`.
- Gate dynamic tool calls by target/thread/turn/actor/app.
- Prove a dynamic tool call without active `/cu` context fails closed and is
  audited.
- Detect sensitive steps and route them to approval cards.
- Denied apps are rejected before approval.
- Sensitive approval is ask-always; no allow-session.

First failing test:

- Sensitive step without approval fails closed; approved safe step reaches fake
  provider; denied app never reaches provider; sensitive approval cards do not
  include `allow_session`.

### T8 - JAC-98 Audit Events

- Persist redacted Computer Use audit actions.
- Cover intent, denial, wrapped prompt, tool-call allowed/denied, provider
  unavailable, and sensitive-step outcomes.
- Ensure redaction catches token/password-like values in task and arguments.

First failing test:

- `/cu login with token sk-...` stores redacted metadata only.

### T9 - JAC-99 Chrome-Only Fake/Manual Smoke Docs

- Add docs for fake smoke and manual Chrome-only smoke.
- Manual smoke must avoid credentials, form submission, deletion, external
  send/post/comment, and production systems.
- Include rollback/stop steps and permissions prerequisites.

Review target:

- Operator can run `/cu status` and a Chrome-only observation smoke without
  secrets or irreversible side effects.

### T10 - JAC-100 Operator-Gated Live Computer Use Smoke

- Add env/default-skip live smoke harness if a reviewed real provider exists.
- If no real provider exists, record the blocker and keep the smoke skipped.
- Never run live desktop control by default.

Exit:

- Default command skips with redacted reason.
- Live command requires explicit env and documented operator action.

### T11 - JAC-101 Final Review / Handoff / Tag

- Run Codex outside-voice Computer Use security review.
- Patch P0/P1 before tag.
- Update `phase6-live-status.md`, README, TODOS, and Phase 6 -> Phase 7
  handoff.
- Bump root version to `0.1.0-phase6` at tag gate only.
- Tag `phase-6-computer-use-complete` if review and gates are green.

## 7. Test And Gate Plan

Per issue:

- targeted unit tests first
- `pnpm typecheck`
- `pnpm typecheck:tests`
- `pnpm test`
- `pnpm lint`
- `pnpm protocol:check` at completion

Additional Phase 6 tests:

- parser and wrapper unit tests
- policy evaluator unit tests
- daemon fake tool-call gate tests
- audit redaction tests
- fake Computer Use smoke
- default-skipped live/manual smoke

Live desktop smoke is never part of default CI.

## 8. Review Questions For JAC-91

1. Is the two-gate model sufficient to prove normal prompts cannot trigger
   Computer Use?
2. Should `ComputerUseSessionRegistry` live in daemon, core, or a new package?
3. Is `item/tool/call` the right protocol boundary for Computer Use, or must
   Phase 6 add a capability spike before any provider work?
4. Are denied apps policy-denied before approval the correct behavior?
5. Are sensitive steps ask-always with no allow-session enough?
6. Is a fake/unsupported provider acceptable as the first implementation while
   real Codex App Computer Use capability evidence is collected?

## 9. Phase Exit Criteria

- `/cu` and `/computer-use` are explicit, parsed, and audited.
- `/cu status` reports policy safely without exposing secrets.
- Normal prompts do not create Computer Use context.
- Tool calls without active `/cu` context fail closed.
- Denied apps fail closed before approval.
- Sensitive steps require explicit approval and do not support allow-session.
- Audit records redacted Computer Use intent, policy, and tool-call outcomes.
- Fake provider tests and fake smoke pass.
- Live/manual smoke path is documented and default-skipped unless a reviewed
  real provider exists.
- Final Computer Use security review returns GO or P0/P1 findings are closed.
