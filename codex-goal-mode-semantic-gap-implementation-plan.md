# Codex Goal Mode Plan — Codex App Server Semantic Gap Implementation

**Project:** Codex IM Rich Client
**Audience:** Codex goal mode, with GPT Pro / Claude Code acting as reviewers after checkpoints
**Intent:** Use one Codex goal-mode run to implement the App Server semantic gaps that are safe and evidenced, while treating protocol-dependent gaps as hard-gated rather than invented.
**Last updated:** 2026-05-12

---

## 0. Executive Decision

Yes, Codex goal mode can run this as **one goal**, but it must not be a single unbounded “do everything” task.

The correct shape is:

```text
One Codex Goal
  ├─ Part 0: Reconfirm evidence and local generated protocol
  ├─ Part 1: Add semantic guardrails
  ├─ Part 2: Implement safe native-thread semantics
  ├─ Part 3: Implement lifecycle diagnostics only
  ├─ Part 4: Attempt permissions/writableRoots only if protocol evidence exists
  ├─ Part 5: Update docs and customer-facing semantics
  └─ Part 6: Run gates, produce stop/continue report
```

This means Codex can stay in one goal-mode session, but the goal must contain **internal stop conditions**. In particular, it must stop before implementing any feature that is not exposed by the local pinned generated protocol.

---

## 1. Current Evidence Summary

Use the Codex Goal 0 evidence report as the source of truth.

Key facts:

```text
Local repo HEAD at evidence time: 4abc618
Package version: 0.1.0-alpha.4
Pinned Codex: 0.128.0
pnpm protocol:check: passed
Local codex app-server --help: proxy / generate-ts / generate-json-schema
Local codex app-server daemon version: unavailable / unrecognized
Architecture: aligned
Largest semantic gap: permissions / writableRoots enforcement
```

The evidence report says:

```text
The architecture is semantically aligned with Codex App Server for the current 0.128.0 pin.
The biggest semantic gap is not remote-control; it is permissions/writable-root enforcement.
The evidence does not support implementing that wire-up today because the pinned generated request params do not expose permissions.
Remote-control daemon semantics should stay informational and future-facing.
```

### Interpretation

The IM bridge architecture remains correct:

```text
IM Adapter
  -> ChannelAdapter
  -> Core
  -> CodexRuntime
  -> AppServerClient
  -> codex app-server
```

The project should not pivot to remote-control WebSocket. Instead, it should align these semantics:

```text
1. lifecycle / app-server daemon
2. native thread operations
3. permissions profile / writableRoots
4. capability detection
5. app_default cwd trust boundary
6. protocol bump / upstream drift detection
```

---

## 2. Non-Negotiable Architecture Boundaries

Codex goal mode must follow these throughout the goal:

```text
- Do not implement remote-control WebSocket.
- Do not make IM bridge a Codex remote-control client.
- Do not parse Codex CLI/TUI output as product protocol.
- Do not replace App Server rich-client semantics with a normal chatbot abstraction.
- Do not expose Codex App Server publicly.
- Do not bypass ApprovalBroker.resolve().
- Do not weaken SecurityPolicy.
- Do not weaken callback token / messageRef validation.
- Do not store raw callback tokens.
- Do not persist raw secrets.
- Do not write IM secrets into docs, logs, SQLite, plist, or Linear.
- Do not infer App Server fields from openai/codex main if they are absent from local generated protocol.
- Do not implement writableRoots enforcement unless local generated ThreadStart/Resume/Fork params expose an actual request path.
```

---

## 3. Goal Mode Top-Level Prompt

Paste this into Codex goal mode.

```text
You are Codex goal mode working on Codex IM Rich Client.

Goal:
Implement Codex App Server semantic-gap alignment in one controlled goal-mode run.

The project is a native Codex App Server IM rich client. It must remain:

IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server

Do not implement remote-control WebSocket. Do not turn this project into a Codex remote-control client. Remote-control is only a status/lifecycle signal unless a future reviewed phase says otherwise.

Use the Goal 0 Semantic Evidence Report as source of truth:
- Architecture is aligned.
- Pinned Codex is 0.128.0.
- Local generated protocol is the implementation source of truth.
- Local app-server daemon lifecycle command is unavailable.
- permissions/writableRoots is the largest semantic gap, but current local generated ThreadStart/Resume/Fork params do not expose top-level permissions.
- thread native operations are mostly aligned and can be improved safely through CodexRuntime wrappers and capability detection.

You may execute the full goal, but you must follow internal stop conditions.

Start by reading:
- package.json
- CODEX_VERSION
- docs/architecture/decisions/0001-codex-app-server-lifecycle-strategy.md
- docs/architecture/decisions/0002-cwd-trust-boundary.md
- docs/architecture/decisions/0003-capability-detection.md
- docs/architecture/decisions/0004-remote-control-non-goal.md
- docs/user/admin-guide.md
- docs/user/commands.md
- packages/codex-protocol/schema/ClientRequest.json
- packages/codex-protocol/schema/ServerNotification.json
- packages/codex-protocol/schema/v2/ThreadStartParams.json
- packages/codex-protocol/schema/v2/ThreadResumeParams.json
- packages/codex-protocol/schema/v2/ThreadForkParams.json
- packages/codex-protocol/src/generated/v2/ThreadStartParams.ts
- packages/codex-protocol/src/generated/v2/ThreadResumeParams.ts
- packages/codex-protocol/src/generated/v2/ThreadForkParams.ts
- packages/codex-runtime/src/runtime.ts
- packages/codex-runtime/src/capabilities.ts
- packages/daemon/src/remote-control.ts
- packages/daemon/src/daemon.ts
- packages/config/src/index.ts

Then execute the parts below in order.
```

---

## 4. Part 0 — Baseline Reconfirmation

### Objective

Reconfirm the current repo state and local generated protocol before editing.

### Commands

Run:

```bash
pwd
git branch --show-current
git rev-parse --short HEAD
git status --short
node --version
pnpm --version
codex --version || true
pnpm check:codex-version || true
pnpm protocol:check
```

### Output

Codex must produce:

```text
Baseline Report:
- branch / HEAD
- working tree status
- package version
- Codex pin
- local codex version
- protocol:check result
- whether local generated protocol is safe to use
```

### Stop conditions

Stop if:

```text
- working tree has tracked uncommitted changes unrelated to this goal
- protocol:check fails
- Codex version differs from package.json codexIm.codexVersion
- local generated protocol is missing thread/start or thread/resume
```

---

## 5. Part 1 — Semantic Guardrails

### Objective

Add guardrails so future work cannot silently drift away from the pinned App Server semantics.

### Required implementation

Add:

```text
scripts/check-app-server-semantics.mjs
```

Add package script:

```json
"check:app-server-semantics": "node scripts/check-app-server-semantics.mjs"
```

Add it to `check:contract` if the script is fast and deterministic.

### Script requirements

The script reads local committed schema only. No network. No openai/codex clone.

It must assert:

```text
ClientRequest has:
- thread/start
- thread/resume
- thread/fork
- thread/name/set
- thread/archive
- thread/unarchive

ServerNotification has:
- remoteControl/status/changed

ThreadResumeParams and ThreadForkParams expose:
- excludeTurns

ThreadStartParams / ThreadResumeParams / ThreadForkParams do NOT expose:
- top-level permissions
```

Behavior around permissions:

```text
If top-level permissions appears:
  fail with:
  "permissions now present; review writableRoots enforcement plan before release."

Rationale:
  This turns a future protocol improvement into an intentional implementation event.
```

Informational warnings:

```text
If ClientRequest has thread/turns/list:
  print warning:
  "thread/turns/list present in current pin; audit before Codex pin bump."

If ClientRequest has upstream-only methods from Goal 0:
  plugin/share/save
  plugin/share/list
  plugin/share/updateTargets
  plugin/share/delete
  plugin/skill/read
  windowsSandbox/readiness
print informational note, do not fail.
```

### Docs updates

Update existing ADRs:

```text
ADR 0001 lifecycle strategy:
- v0.1.x remains launchd / bridge / stdio App Server lifecycle.
- app-server daemon lifecycle is future optional provider / doctor probe.
- if adopted later, parse JSON only.

ADR 0003 capability detection:
- local generated protocol is implementation SoT.
- runtime detection is observe-and-cache.
- upstream-only fields/methods must not be used.
- thread/turns/list is pin-specific and must be audited before pin bump.

ADR 0004 remote-control non-goal:
- remote-control status is informational only.
- never authorization, approval routing, SessionRouter binding, or lifecycle decision.
```

### Tests

If the repo has script tests, add tests. If not, keep the script deterministic and covered by `pnpm check:app-server-semantics`.

### Commit

Suggested commit:

```bash
git add scripts/check-app-server-semantics.mjs package.json docs/architecture/decisions docs/user/admin-guide.md
git commit -m "test(semantics): guard app-server protocol assumptions"
```

---

## 6. Part 2 — Native Thread Semantics

### Objective

Make the IM command layer align more tightly with native Codex App Server thread semantics.

This part should implement only features already present in local generated protocol.

### Feature 2.1 — `/threads` native refresh

Current risk: local `thread_sessions` can diverge from Codex App’s native thread inventory.

Implement or verify:

```text
- CodexRuntime wrapper for thread/list if not already present.
- CodexRuntime wrapper for thread/read if needed.
- Optional wrapper for thread/loaded/list if useful.
- `/threads` can display local known sessions.
- `/threads --refresh` or `/threads refresh` imports native Codex threads into local `thread_sessions` without promoting them to configured projects.
```

Rules:

```text
- Imported native threads use context_kind = "native_thread" or "app_default".
- Do not infer project authorization from returned cwd.
- Do not show full cwd to normal users.
- Do not add raw cwd selection from IM.
- Do not create projects from IM.
```

Allowed files likely:

```text
packages/codex-runtime/src/runtime.ts
packages/daemon/src/thread-listing.ts
packages/daemon/src/daemon.ts  # thin routing only
packages/storage-sqlite/src/thread-sessions.ts
packages/daemon/test/*
docs/user/commands.md
```

### Feature 2.2 — `/switch` resume-before-bind invariant

Verify or implement:

```text
/switch <thread>
  -> call thread/resume first
  -> if resume succeeds, update local binding
  -> if resume fails, keep existing binding unchanged
```

Use `excludeTurns: true` only if local generated protocol supports it.

Tests:

```text
- resume success updates binding
- resume failure leaves binding untouched
- active turn blocks switch
- pending approval blocks switch
```

### Feature 2.3 — `/rename` semantics

If `thread/name/set` exists locally:

```text
/rename <title> should call thread/name/set.
```

If it fails with `-32601`:

```text
fallback to local alias only, with explicit IM message:
"Codex thread/name/set not supported; saved local alias only."
```

Keep `/alias <title>` as always local-only.

### Feature 2.4 — `/archive` / `/unarchive`

If local protocol exposes thread/archive and thread/unarchive, keep or implement native behavior:

```text
/archive:
  -> call thread/archive
  -> mark local session archived only after success
  -> fallback local-only only on -32601 and say so

/unarchive:
  -> call thread/unarchive
  -> mark local session open only after success
```

### Feature 2.5 — Do not expose dangerous native methods

Do not expose:

```text
thread/shellCommand
fs/writeFile
fs/remove
plugin/install
marketplace/add
thread/rollback
```

unless a future reviewed phase designs the security policy.

### Commit

Suggested commit:

```bash
git commit -m "feat(daemon): align IM thread commands with app-server semantics"
```

---

## 7. Part 3 — Lifecycle Diagnostics, Not Lifecycle Replacement

### Objective

Implement read-only lifecycle diagnostics around Codex App Server lifecycle semantics without switching the runtime provider.

### Required behavior

Add a small module:

```text
packages/daemon/src/app-server-lifecycle-probe.ts
```

or if more appropriate:

```text
packages/cli/src/app-server-lifecycle-probe.ts
```

It should support:

```ts
type AppServerLifecycleProbeResult =
  | { kind: "unavailable"; reason: string }
  | { kind: "available"; backend?: string; socketPath?: string; cliVersion?: string; appServerVersion?: string; rawRedacted: unknown };
```

Probe command:

```bash
codex app-server daemon version
```

Rules:

```text
- 2s timeout.
- Parse stdout as JSON only.
- If command unavailable, return unavailable.
- Do not parse human text.
- Do not start/restart/stop app-server.
- Do not enable remote-control.
- Do not mutate CODEX_HOME.
- Redact all paths or show only operator-safe paths in CLI/IM output.
```

Expose it through:

```text
pnpm codex-im:status
pnpm im:doctor
/status line in IM if cheap
```

Display wording:

```text
Codex App Server lifecycle daemon: unavailable in pinned Codex 0.128.0
```

or if available:

```text
Codex App Server lifecycle daemon: available, version <redacted/short>
```

### Stop conditions

Stop if implementation tries to:

```text
- call daemon start/restart/stop
- enable/disable remote-control
- use lifecycle status to authorize anything
- replace the existing Supervisor / launchd path
```

### Commit

Suggested commit:

```bash
git commit -m "feat(doctor): report codex app-server lifecycle availability"
```

---

## 8. Part 4 — permissions / writableRoots

### Objective

This is the most important semantic gap, but it is protocol-gated.

### Current evidence

Goal 0 found:

```text
- Upstream Rust has experimental permissions declarations.
- Local pinned JSON/TS ThreadStartParams, ThreadResumeParams, ThreadForkParams do not expose top-level permissions.
- Schema mentions additionalWritableRoot in definitions, but no top-level params path reaches it.
```

### What Codex goal mode should do

Run a fresh local protocol inspection:

```bash
node scripts/check-app-server-semantics.mjs
```

Then decide:

#### Case A — local generated params still do not expose `permissions`

Do **not** implement enforcement.

Do:

```text
- keep writableRoots metadata-only
- ensure docs say metadata-only clearly
- add runtime warning in `im:doctor` or `codex-im:status`:
  "writable_roots configured but not enforced by current Codex App Server protocol"
- add a test that doctor/status warns when writable_roots is non-empty and enforcement capability is absent
```

This is still a useful feature because it prevents user misunderstanding.

Suggested commit:

```bash
git commit -m "fix(doctor): warn when writableRoots are metadata-only"
```

#### Case B — local generated params expose `permissions`

Implement enforcement:

```text
- Add a permissions builder:
  buildThreadPermissionsFromProject(project)
- Map writableRoots to additionalWritableRoot modifications.
- Use it for thread/start, thread/resume, and thread/fork.
- Never combine `sandbox` and `permissions` in the same request.
- If both would be present, fail closed.
- Add capability detection around permissions if runtime returns -32601 or validation error.
```

Allowed module:

```text
packages/codex-runtime/src/permissions.ts
```

Tests:

```text
- configured writableRoots become additionalWritableRoot modifications
- empty writableRoots does not send permissions
- no request combines sandbox and permissions
- unsupported permissions falls back or fails with explicit message
- app_default/native_thread does not gain configured_project writable roots
```

Suggested commit:

```bash
git commit -m "feat(runtime): enforce project writableRoots via app-server permissions"
```

### Hard stop

If local generated protocol lacks `permissions`, but Codex tries to invent the field anyway, stop immediately.

Do not use upstream Rust declaration alone.

Do not use `config` as a secret path to smuggle writable roots into App Server.

---

## 9. Part 5 — Protocol Drift Preparation

### Objective

Prepare for a future Codex pin bump without doing the bump in this goal unless explicitly requested.

### Required output

Add or update:

```text
docs/architecture/codex-protocol-upgrade-checklist.md
```

Checklist should include:

```text
- run codex --version
- update CODEX_VERSION and package.json codexIm.codexVersion
- run protocol:generate
- diff generated protocol
- inspect ClientRequest / ServerNotification method delta
- inspect ThreadStart/Resume/Fork permissions
- inspect thread/turns/list removal risk
- inspect new process/outputDelta and process/exited notifications
- inspect plugin/share and windowsSandbox methods
- update check-app-server-semantics script
- run full gates
```

Suggested commit:

```bash
git commit -m "docs(protocol): add codex app-server upgrade checklist"
```

---

## 10. Part 6 — Final Gates

Run:

```bash
pnpm typecheck
pnpm typecheck:tests
pnpm test
pnpm test:cli-smoke
pnpm lint
pnpm check:app-server-semantics
pnpm protocol:check
pnpm release:check -- --skip-full-gates
```

If any gate fails, Codex must not continue to new features. It must produce:

```text
Failure Report:
- failing command
- relevant logs
- suspected cause
- whether failure is semantic/protocol-related
- proposed next action
```

---

## 11. Final Report Format

At the end of the goal, output:

```text
Codex App Server Semantic Gap Implementation Report

1. Branch / HEAD
2. Commits created
3. Files changed
4. Features implemented
5. Features intentionally not implemented and why
6. Guardrails added
7. Protocol facts confirmed
8. Gates run and results
9. Whether architecture remains aligned
10. Remaining semantic gaps
11. Recommended next goal
```

---

## 12. Expected Outcomes

### Expected outcome if current pin remains 0.128.0

Likely commits:

```text
test(semantics): guard app-server protocol assumptions
feat(daemon): align IM thread commands with app-server semantics
feat(doctor): report codex app-server lifecycle availability
fix(doctor): warn when writableRoots are metadata-only
docs(protocol): add codex app-server upgrade checklist
```

Likely non-implemented:

```text
writableRoots -> permissions enforcement
lifecycle provider replacement
remote-control WebSocket
protocol pin bump
```

### Expected outcome if protocol unexpectedly exposes permissions

Then Codex may implement:

```text
feat(runtime): enforce project writableRoots via app-server permissions
```

but only after tests prove the request shape exists in local generated protocol and no request combines `sandbox` with `permissions`.

---

## 13. What This Goal Must Not Do

Do not implement:

```text
remote-control transport
app-server daemon start/restart provider replacement
public listener
Computer Use expansion
real upgrade --apply
new IM platform
raw path project creation from IM
raw protocol calls from daemon or adapters
upstream-only plugin/share methods
windowsSandbox/readiness
```

Do not change:

```text
ApprovalBroker settlement semantics
callback token schema
messageRef validation
SecurityPolicy authorization model
ChannelAdapter boundary
Keychain secret model
```

---

## 14. If Codex Needs GPT Pro During Goal Mode

Use this packet:

```text
BEGIN CODEX GOAL CONSULTATION

Goal:
Codex App Server Semantic Gap Implementation.

Current part:
[Part number/name]

Current repo state:
- branch:
- HEAD:
- working tree:
- files changed:

Question:
[exact question]

Protocol evidence:
- local generated schema says:
- runtime behavior says:
- upstream openai/codex says:

Options:
A.
B.
C.

Redlines:
- no remote-control WebSocket
- no field absent from local generated protocol
- no approval bypass
- no writableRoots fake enforcement
- no secret leakage

Please decide:
1. CONTINUE / STOP / PATCH PLAN / REVERT
2. exact next step
3. allowed files
4. tests to run

END CODEX GOAL CONSULTATION
```

---

## 15. Rationale For Running This As One Goal

A single goal is acceptable because the semantic areas share the same source of truth:

```text
local generated App Server protocol
CodexRuntime wrappers
daemon command layer
doctor/status surfaces
user docs
```

But it must be internally staged because these areas have different risk levels:

```text
safe now:
  - guardrails
  - native thread commands already in local protocol
  - lifecycle diagnostics
  - docs

protocol-gated:
  - writableRoots enforcement

forbidden now:
  - remote-control transport
  - lifecycle provider replacement
```

This gives you the best of both worlds:

```text
Codex can make progress in one autonomous goal.
The project does not invent semantics that App Server has not exposed.
```
