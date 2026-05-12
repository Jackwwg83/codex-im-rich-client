# Codex Goal Mode Plan: App Server Semantics Alignment for Codex IM Rich Client

Status: guidance for a controlled Codex Goal Mode run
Scope: architecture/semantic alignment, not a new remote-control transport
Repository: `Jackwwg83/codex-im-rich-client`
Upstream reference: `openai/codex` latest `main` as evidence, but local generated protocol remains the implementation source of truth

---

## 1. Executive decision

Do both, but in this order:

1. Use this document as the **goal contract**.
2. Let Codex Goal Mode download or refresh `openai/codex` latest source into a temporary evidence directory.
3. Require Codex to produce a **Semantic Evidence Report** before any code change.
4. Only implement bounded slices after the report shows no architecture conflict.

Do not let Codex Goal Mode freely explore upstream and then directly patch the product. The upstream repository is evidence; it is not the implementation source of truth. The source of truth for implementation is:

- current `codex-im-rich-client` architecture;
- current pinned Codex version and generated protocol;
- runtime capability detection results;
- explicit reviewed plan.

---

## 2. Architecture verdict

The current Codex IM architecture is still semantically aligned with Codex App Server:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

This architecture should not be replaced by Codex remote-control. Remote-control is a different semantic layer: it is for Codex's own remote clients and lifecycle/remote-management flows. Codex IM is an IM rich client that projects App Server semantics into Telegram/Lark/DingTalk/Slack.

The right adjustment is not “switch to remote-control.” The right adjustment is to absorb these App Server semantics:

- lifecycle management signals and optional daemon lifecycle probes;
- native thread operations;
- permissions profile / bounded modifications;
- capability detection and runtime fallback;
- app_default cwd trust boundary;
- approval reviewer / approval policy continuity.

---

## 3. Upstream semantics to analyze

Codex Goal Mode should inspect these upstream files first:

```text
openai/codex:
  codex-rs/app-server-daemon/README.md
  codex-rs/app-server-protocol/src/protocol/common.rs
  codex-rs/app-server-protocol/src/protocol/v2/thread.rs
  codex-rs/app-server-protocol/src/protocol/v2/remote_control.rs
  codex-rs/app-server-protocol/schema/json/ClientRequest.json
  codex-rs/app-server-protocol/schema/json/ServerNotification.json
  codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json
  codex-rs/app-server-protocol/schema/json/v2/ThreadResumeParams.json
  codex-rs/app-server-protocol/schema/json/v2/ThreadForkParams.json
```

It should not scan the whole upstream repository randomly unless the evidence report identifies a specific missing area.

---

## 4. Semantic mapping

### 4.1 Lifecycle

Upstream semantics:

- `codex app-server daemon start`
- `restart`
- `stop`
- `version`
- `enable-remote-control`
- `disable-remote-control`
- `bootstrap --remote-control`

These commands are machine-readable and report JSON. They are relevant to Codex IM as **future lifecycle provider inputs**, not as the main IM runtime path.

Codex IM policy:

- v0.1 keeps current bridge/launchd/install path.
- Do not implement remote-control transport.
- Add only optional doctor/status probes if low risk:
  - detect whether `codex app-server daemon version` exists;
  - parse JSON if available;
  - report lifecycle capability as informational;
  - never use it as authorization or security signal.

Recommended future abstraction, only when needed:

```ts
type CodexLifecycleMode =
  | { kind: "bridge_spawn" }
  | { kind: "codex_app_server_daemon"; socketPath: string }
  | { kind: "external" };
```

Do not implement this provider abstraction until a real provider switch is planned.

### 4.2 Thread semantics

Upstream App Server now exposes or is expected to expose native thread operations:

- `thread/start`
- `thread/resume`
- `thread/fork`
- `thread/archive`
- `thread/unarchive`
- `thread/name/set`
- `thread/metadata/update`
- `thread/read`
- `thread/list`
- `thread/loaded/list`

Codex IM mapping:

| Codex IM command | App Server semantic | Current strategy |
|---|---|---|
| `/new` | `thread/start` | native thread creation |
| `/switch` | `thread/resume` before binding update | correct; fail closed if resume fails |
| `/fork` | `thread/fork` | capability-gated, use `excludeTurns` where supported |
| `/rename` | `thread/name/set` | remote when supported, local fallback otherwise |
| `/alias` | local display metadata | keep local-only |
| `/archive` | `thread/archive` | remote when supported, local fallback if explicit |
| `/unarchive` | `thread/unarchive` | remote when supported |
| `/threads` | local known sessions + optional native read/list | continue using `thread_sessions` as IM index |

Main rule: do not invent IM-only thread semantics when App Server has native semantics. When native method exists, use it behind capability detection.

### 4.3 Permissions profile / writable roots

Upstream semantics:

- `thread/start`, `thread/resume`, and `thread/fork` include `permissions`.
- `permissions` cannot be combined with `sandbox`.
- Bounded modifications include `additionalWritableRoot`.

Codex IM current state:

- `writable_roots` are parsed and realpath/existence checked.
- They are currently documented as metadata-only.
- This is acceptable for alpha only if clearly documented.

Required future alignment:

- Add capability-gated support for mapping configured `writableRoots` to App Server permissions modifications.
- Do not silently claim enforcement if the running Codex does not support it.

Suggested rollout:

1. Static check: verify generated protocol has `permissions` and `additionalWritableRoot`.
2. Runtime check: call optimistically; if `-32601` or schema rejection, cache unsupported.
3. Config mode:
   - default alpha: `writable_roots_mode = "metadata"` or existing docs-only behavior;
   - optional strict: `writable_roots_mode = "require_codex_enforcement"`.
4. In strict mode, fail startup or project selection if enforcement is unsupported.
5. In metadata mode, show warning in doctor/admin docs.

Do not mix `sandbox` and `permissions` in the same App Server request.

### 4.4 Capability detection

Current strategy is good:

- Layer A: generated protocol/types compile-time support.
- Layer B: runtime observe-and-cache based on `-32601` method-not-found.

Extend this pattern to:

- `thread/name/set`
- `thread/archive`
- `thread/unarchive`
- `thread/fork.excludeTurns`
- `permissions.additionalWritableRoot`
- remote-control status notification parsing
- app-server daemon lifecycle JSON probes

Do not active-probe with fake thread IDs if that can create side effects. Prefer lazy observation on real user command paths.

### 4.5 app_default cwd trust boundary

Keep the current pragmatic model:

- App Server default context can create a thread.
- Returned cwd can be recorded.
- But it is `app_default`, not `configured_project`.
- It must not bypass project allowlists.
- It must not display full local paths to normal IM users.
- It must not imply `writableRoots` enforcement.

Admin-only diagnostics may reveal more, but normal IM output should stay redacted.

### 4.6 Approval semantics

The current approval architecture remains correct:

```text
App Server server-request
  -> ApprovalBroker pending mode
  -> SecurityPolicy before rendering buttons
  -> opaque callback token / messageRef validation
  -> ApprovalBroker.resolve
  -> App Server JSON-RPC response
```

No change needed from remote-control semantics. Do not bypass broker or accept raw action metadata as authority.

---

## 5. What to adjust now vs later

### Safe to do now

- Add ADRs if not present:
  - lifecycle strategy;
  - remote-control non-goal;
  - capability detection;
  - cwd trust boundary;
  - permissions/writableRoots plan.
- Add a Codex semantics evidence report generated by Goal Mode.
- Add doctor/status informational check for App Server daemon lifecycle only if it is small and read-only.
- Update docs to separate current alpha behavior from future App Server semantic alignment.

### Do next, after evidence report

- Implement `writableRoots -> permissions.additionalWritableRoot` behind capability detection.
- Add strict/metadata config mode for writable roots.
- Add tests proving no `sandbox` + `permissions` conflict.
- Add capability cache tests for permission unsupported path.

### Do not do now

- Do not implement remote-control WebSocket.
- Do not replace current launchd/bridge path with Codex app-server-daemon provider.
- Do not auto-enable remote-control.
- Do not treat remote-control status as authorization.
- Do not use upstream `main` fields unless current generated protocol supports them.

---

## 6. Codex Goal Mode workflow

### Goal 0 — Evidence only

No product code changes.

Output required:

```text
Codex App Server Semantic Evidence Report
- upstream commit scanned
- files scanned
- local repo HEAD
- local codex pin
- generated protocol support matrix
- runtime support if available
- semantic gaps
- recommended slices
- no implementation performed
```

### Goal 1 — Architecture docs/ADR only

Allowed files:

```text
docs/architecture/decisions/*.md
docs/architecture/RULES.md
docs/user/admin-guide.md
docs/user/quickstart.md
```

No code changes.

### Goal 2 — Permissions/writableRoots spike

Allowed files:

```text
packages/codex-runtime/src/**
packages/config/src/**
packages/daemon/src/** only thin wiring, prefer new module
packages/*/test/**
docs/user/admin-guide.md
```

Output:

- test-first plan;
- whether generated protocol supports `permissions`;
- whether strict mode can be implemented;
- no remote-control changes.

### Goal 3 — Lifecycle informational probe

Optional.

Implement only if small:

- `codex app-server daemon version` probe;
- parse JSON;
- report in `codex-im:status` or `im:doctor` as informational;
- no launch-path switch.

---

## 7. Exact Codex Goal Mode prompt

```text
You are running Codex Goal Mode for Codex IM Rich Client.

Goal:
Determine whether the current Codex IM architecture is semantically aligned with the latest Codex App Server semantics, and produce a bounded implementation plan. Do not directly implement product changes until the Semantic Evidence Report is complete.

Important boundaries:
- Codex IM remains: IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server.
- Do not implement remote-control WebSocket.
- Do not switch the runtime to Codex app-server-daemon lifecycle in this goal.
- Do not parse Codex CLI/TUI output as product protocol.
- Do not bypass ApprovalBroker, SecurityPolicy, callback token, or messageRef validation.
- Upstream openai/codex main is evidence, not implementation source of truth.
- The implementation source of truth is this repo's pinned Codex version and generated protocol.

Step 1 — Prepare evidence checkout:
- Create a temp directory outside the repo, e.g. /tmp/codex-upstream-evidence.
- Clone or update https://github.com/openai/codex.git.
- Record upstream HEAD SHA.
- Do not vendor upstream files into this repo.

Step 2 — Inspect only these upstream areas first:
- codex-rs/app-server-daemon/README.md
- codex-rs/app-server-protocol/src/protocol/common.rs
- codex-rs/app-server-protocol/src/protocol/v2/thread.rs
- codex-rs/app-server-protocol/src/protocol/v2/remote_control.rs
- codex-rs/app-server-protocol/schema/json/ClientRequest.json
- codex-rs/app-server-protocol/schema/json/ServerNotification.json
- codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json
- codex-rs/app-server-protocol/schema/json/v2/ThreadResumeParams.json
- codex-rs/app-server-protocol/schema/json/v2/ThreadForkParams.json

Step 3 — Inspect local repo:
- package.json codexIm.codexVersion
- packages/codex-protocol generated files
- packages/codex-runtime/src/runtime.ts
- packages/codex-runtime/src/capabilities.ts
- packages/config/src/index.ts
- packages/daemon/src/remote-control.ts
- docs/architecture/decisions if present
- docs/user/admin-guide.md

Step 4 — Produce Semantic Evidence Report:
Include:
1. Upstream HEAD and files inspected.
2. Local HEAD and pinned Codex version.
3. Lifecycle semantics found upstream.
4. Thread semantics found upstream.
5. Permissions/profile/writableRoot semantics found upstream.
6. Remote-control semantics and why it remains a non-goal.
7. Local implementation status.
8. Conflict matrix: aligned / gap / risky / do not adopt.
9. Recommended implementation slices.
10. Stop conditions.

Step 5 — Stop.
Do not modify code. Wait for human/GPT approval.
```

---

## 8. Exact Claude Code follow-up prompt after Codex report

```text
Read the Codex Semantic Evidence Report.

Do not implement remote-control transport.
Do not change approval semantics.
Do not change IM adapter boundaries.

Your job is to turn the evidence report into a reviewed implementation plan.

Focus on:
- lifecycle strategy ADR;
- remote-control non-goal ADR;
- capability detection ADR update;
- writableRoots/permissions implementation plan;
- app_default cwd trust boundary tests/docs;
- doctor/status lifecycle probe if low-risk.

Output:
- APPROVE / APPROVE_WITH_CHANGES / REJECT for each proposed slice;
- exact files allowed;
- tests required;
- whether this can be done before customer alpha or deferred to v0.2.

Do not write code until the plan is approved.
```

---

## 9. Recommended prioritization

For customer alpha:

- do not block alpha on permissions enforcement if docs clearly say metadata-only;
- do not block alpha on Codex lifecycle provider;
- do not block alpha on remote-control status;
- do block alpha if docs imply writableRoots are enforced when they are not.

For v0.2:

1. `writableRoots -> permissions.additionalWritableRoot` capability-gated implementation.
2. lifecycle doctor probe for `codex app-server daemon version`.
3. optional `/status` line for App Server daemon lifecycle state.
4. `thread/metadata/update` support if it helps display or git metadata.
5. stricter support matrix in docs.

---

## 10. Final recommendation

Do not ask Codex Goal Mode to “download latest source and improve the product” as an open-ended goal.

Ask it to:

1. download upstream;
2. produce evidence;
3. compare semantics;
4. stop;
5. then implement only the approved slices.

Main architecture does not need to change. The most important semantic enhancement is permissions/writableRoots alignment, followed by optional lifecycle diagnostics.
