1. **Verdict: APPROVE_WITH_CHANGES**

Scope reviewed: `phase-5-dingtalk-adapter-complete..650db47`.

2. **Findings**

**P0**

None found.

**P1**

- `/cu` is parsed but still dropped by the daemon, so the Phase 6 flow is not actually enabled or audited. `routeInboundCommand()` can now return `kind: "computer_use"`, but daemon inbound handling only routes `prompt` and `command` branches at [daemon.ts](<repo>/packages/daemon/src/daemon.ts:620). The existing test still asserts `/cu open browser` does not reach session routing or runtime at [daemon.test.ts](<repo>/packages/daemon/test/daemon.test.ts:804). This misses the Phase 6 exit criteria for `/cu`, `/cu status`, prompt wrapping, session creation, and audit.

- The dynamic tool gate API is not safely wireable from the broker request shape. Codex’s `DynamicToolCallParams` only carries thread/turn/call/tool/arguments, not IM target or actor, per [computer-use-capability-evidence.md](<repo>/docs/internal/phase-6/computer-use-capability-evidence.md:13). But `ComputerUseToolGate.handle()` requires caller-supplied `targetKey` and `actorKey` at [computer-use-session.ts](<repo>/packages/core/src/computer-use-session.ts:101). Since the registry has no public lookup by thread/turn, a real `registerDynamicToolCallHandler()` path cannot prove the “same target/thread/turn/actor” requirement without inventing context outside the request.

- Expired Computer Use sessions fail open unless every caller passes `now`. Expiry is checked only when `input.now !== undefined` at [computer-use-session.ts](<repo>/packages/core/src/computer-use-session.ts:76), and the gate omits `now` by default at [computer-use-session.ts](<repo>/packages/core/src/computer-use-session.ts:138). Production-style calls without `now` can continue using an expired session.

- Computer Use audit events lack required routing context. The plan requires target key, project id, app, task summary, decision, and reason at [phase plan](<repo>/docs/internal/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md:274), but `emitComputerUseTriggerAudit()` accepts only audit, intent, and policy decision at [computer-use-audit.ts](<repo>/packages/core/src/computer-use-audit.ts:8). The test explicitly asserts no target/chat/user ids at [computer-use-audit.test.ts](<repo>/packages/core/test/computer-use-audit.test.ts:6), which prevents an auditable `/cu` trail.

**P2**

- Provider exceptions are not converted to fail-closed tool responses. `ComputerUseToolGate` awaits `provider.execute()` without `try/catch` at [computer-use-session.ts](<repo>/packages/core/src/computer-use-session.ts:176). Before any real provider, thrown provider errors should audit a minimized failure and return `{ contentItems: [], success: false }`.

- App/tool argument validation is still schema-blind. The gate policy checks `input.app` and stringified raw arguments at [computer-use-session.ts](<repo>/packages/core/src/computer-use-session.ts:156), but Phase 6 explicitly records real argument shape as unverified. This is acceptable for fake/unsupported providers, but must be closed before `codex-app` provider enablement.

**P3**

- `git diff --check phase-5-dingtalk-adapter-complete..650db47` reports extra blank lines at EOF in three Phase 6 review docs: [plan-v1-codex-review-prompt.md](<repo>/docs/internal/phase-6/plan-v1-codex-review-prompt.md), [plan-v1-review-response.md](<repo>/docs/internal/phase-6/plan-v1-review-response.md), and [plan-v1.1-codex-rereview-prompt.md](<repo>/docs/internal/phase-6/plan-v1.1-codex-rereview-prompt.md).

3. **Positive Checks**

- No OpenClaw, Codex CLI/TUI parsing, generic chat abstraction, or public listener drift found in the Phase 6 production diff.
- ServerRequest method literal boundary is preserved; the new typed dynamic-tool API keeps the raw method inside broker at [approval-broker.ts](<repo>/packages/core/src/approval-broker.ts:629).
- Normal desktop-looking prompts remain normal prompts; the added daemon test covers that boundary.
- Policy defaults are conservative: disabled by default, Chrome allowlist by default, denied app wins, unknown/unlisted apps fail closed.
- Live Computer Use smoke is default-skip and blocks real desktop execution in Phase 6.

4. **Required Fixes Before Tag**

Wire `/cu` and `/cu status` through the daemon, including policy check, redacted prompt wrapper, scoped session creation after turn id is known, typed broker dynamic-tool handler registration, and audit with target/project/thread/actor context. Make the gate callable from broker request context without fabricated actor/target data. Fix expiry to use current time by default, add regression tests for expired sessions without explicit `now`, and clean `git diff --check`.

5. **Tag Recommendation**

Do not tag `phase-6-computer-use-complete` at `650db47`. Re-review after the P1 fixes land and the full gates plus `git diff --check` are clean.