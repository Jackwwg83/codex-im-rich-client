# Phase 1 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-04-30 — Pre-3 complete (docs `c96d36d` + code `44e2623`). T9a unblocked, ready to start.

---

## 1. Current phase / task

- **Phase:** Phase 1 — Codex Runtime Core
- **Active task:** **T9a — ready to start** (`ApprovalBroker` skeleton + happy-path dispatch + dispatch-coverage). Has not been started yet; awaiting user approval to begin Step 9a.1.
- **Last completed task:** **Pre-3** (`AppServerClient` `JsonRpcResponseError` propagation) — both commits landed (`c96d36d` docs, `44e2623` code).
- **Prior tasks:** T8 (CodexRuntime typed wrappers) + T8 codex review fixes.

## 2. Branch / HEAD

- **Branch:** `phase-1-runtime`
- **HEAD:** `44e2623 fix(app-server-client): preserve explicit JSON-RPC handler errors`
- **Parent:** `c96d36d docs(phase1): add pre-3 appserverclient error propagation prerequisite`
- **Grandparent:** `585235e fix(t8): codex outside-voice review — 5 of 5 findings resolved`
- **Main:** `main`

## 3. Completed tasks (Phase 1)

- Pre-1 (Node 24 bump) — landed
- Pre-2 (protocol facade expansion) — landed
- T1 (categorizeJsonRpcError) — landed + reviewed
- T2 (CLI capture flags) — landed
- T3 (codex-runtime skeleton + scripts) — landed
- T4 (real fixture capture) — landed + reviewed
- T4.5 (fixture acceptance gate) — landed + reviewed
- T5 (packages/core skeleton) — landed + reviewed (5/5 fixes applied)
- T6 (METHOD_CLASS + isServerNotificationMethod) — landed + reviewed (3/3 fixes applied)
- T7a (EventNormalizer skeleton) — landed + reviewed (6/6 fixes applied)
- T7b (T7b-1 + T7b-2 = exhaustive switch + walk-and-drop overflow) — landed + reviewed (2/2 fixes applied)
- T8 (CodexRuntime typed wrappers) — landed + reviewed (5/5 low+nit fixes applied)
- **Pre-3 (`AppServerClient` `JsonRpcResponseError` propagation) — landed (docs `c96d36d` + code `44e2623`).** No outside-voice review run on Pre-3; the change is purely additive (single new branch in catch arm; existing `-32603` path bit-identical). 231/231 tests pass.

## 4. Currently doing

Nothing in flight. Pre-3 is fully landed. Awaiting explicit user approval before T9a Step 9a.1.

## 5. Next exact action

**T9a Step 9a.1** — write failing tests in `packages/core/test/approval-broker.test.ts` covering:

1. `default-rejects an unknown (non-generated) method via -32601 (Pre-3 path)` — broker throws `JsonRpcResponseError({ code: -32601, ... })` for a synthetic method name; assertion uses `await expect(fake.emitServerRequest("future/unseen/method", {}, 42)).rejects.toMatchObject({ code: -32601 })`.
2. `duplicate attach() throws` — second `broker.attach()` raises `/already attached/`.

Test file uses `AppServerClient` + `FakeAppServer` (no `fake.client` placeholder). Synthetic method name only; **no approval method-name string literals in test code**.

After 9a.1 fails for the right reason, proceed sequentially through Steps 9a.2 → 9a.7 per plan §1626-1747.

T9a-authorized Files (CLAUDE.md "每个任务只改计划内文件"):
- `packages/core/src/approval-broker.ts`
- `packages/core/test/approval-broker.test.ts`
- `packages/core/test/approval-broker-dispatch.test.ts`
- `packages/core/test/dispatch-coverage.test.ts`

T9a may NOT touch `packages/app-server-client/` — Pre-3 owns that file.

## 6. Currently modified files (working tree)

Clean (only the gstack runtime lock):

```
?? .claude/scheduled_tasks.lock
```

`git stash list` is empty.

## 7. Current test results (at HEAD `44e2623`)

- `pnpm typecheck` → exit 0 (6 strict packages clean)
- `pnpm test` → **231 passed (231)**, 24 files
- `pnpm typecheck:tests` → exit 0
- `pnpm test:cli-smoke` → 2 passed
- `pnpm lint` → exit 0 (biome 77 files)
- `pnpm protocol:check` → exit 0
- `scripts/verify-phase1-fixtures.mts` → GATE PASS (1 server-request frames, 1 approval-capable)
- All 8 ci-check gates green at `44e2623`. The 231-count includes Pre-3's new `honors JsonRpcResponseError thrown from handler` test in `client-default-reject.test.ts`.

## 8. Current key decisions (Phase 1, decided — do not relitigate)

- **D5 final:** EventNormalizer single FIFO + class-aware walk-and-drop overflow (delta-soft + total-hard caps, sanitized).
- **D6:** transport-loss path auto-fails pending approvals as `denied / actor=system / reason=transport_lost`. Idempotent (Codex B7).
- **D7:** ApprovalBroker is the **single owner** of `client.setServerRequestHandler`. Dispatch is via exhaustive `Record<ServerRequest["method"], DispatcherSpec>` (Codex B5/B6 — `Map`/`Set` are not exhaustive).
- **D8:** ts-rs `ServerNotification.method` is `string` at the wire-decoded level; narrow via `isServerNotificationMethod` derived from `Object.hasOwn(METHOD_CLASS, m)`.
- **D9:** Two close paths for the normalizer — `#cancelConsumer` (caller iterator.return → drop queue) vs `endOfStream` (source ended → drain queue, then close).
- **D10 (resolved by Pre-3, 2026-04-30):** server-request handlers may throw `JsonRpcResponseError` to signal an explicit JSON-RPC error envelope; `AppServerClient.dispatchServerRequest` preserves `code` / `rawMessage` / `data` verbatim. Generic `Error` throws still collapse to `-32603 "handler error: ..."`. The `-32601` vs `-32603` plan inconsistency between T9a §9a.1 and T9b §9b.3 is now settled: `-32601` is reserved for "method not in dispatch table" via the Pre-3 path; `-32603` is reserved for "registered handler crashed at runtime". Both T9a and T9b plan sections have been amended to make this explicit.

## 9. Current redlines (must hold every iteration)

Persistent (CLAUDE.md):
- No Codex CLI/TUI wrapper — JSONL on stdio only.
- No public WebSocket / public HTTP listener.
- Approvals never auto-approve; default-deny.
- Computer Use needs explicit `/cu` invocation (Phase 6 anyway).
- Logs redact secrets.
- No hardcoded approval / server-request method names outside `packages/core/`. T9b adds the build-time grep guard over `packages/{app-server-client,codex-runtime,daemon,cli}/src/**`.
- Phase 0 modules (`AppServerClient`, `StdioTransport`, `JsonlDecoder`) are **contract** — extend, never rewrite.

Phase 1 specific:
- `AppServerClient` is **ONE-SHOT**. Supervisor (T11) constructs a fresh quartet per recovery; nothing is reused across the boundary.
- Method-name string literals exist **only** in `packages/codex-runtime/src/runtime.ts` (CodexRuntime wrappers) and `packages/core/src/approval-broker.ts` (when T9a lands). Nowhere else in `packages/{app-server-client,codex-runtime,daemon,cli}/src/**`.
- Unknown ServerNotification arms must produce a `CodexRichEvent` of type `unknown` — never silently dropped.
- Each task only touches files in its plan-listed Files block (CLAUDE.md "每个任务只改计划内文件").

## 10. Not allowed to advance until resolved

T9a may not start until the user explicitly approves Step 9a.1. Once T9a starts, the binding rules are:

- T9a only touches files in its plan-listed Files (see §5 above).
- T9a may NOT touch `packages/app-server-client/` — Pre-3 owns that surface area.
- No new approval method-name string literals outside `packages/core/`. Test code uses synthetic method names (`future/unseen/method`); production code reads from generated `ServerRequest["method"]` union.
- The single-handler invariant on `client.setServerRequestHandler` is the broker's exclusive territory (D7).
- `ApprovalBroker` constructor must NOT subscribe to `client.onClose` or attempt restart (ONE-SHOT lifecycle; Supervisor T11 owns recovery).

Other Phase 1 non-goals from handoff (unchanged across all tasks):
- Any IM adapter (Phase 2+).
- Computer Use production path (Phase 6).
- SQLite storage (Phase 2).
- ChannelAdapter / SessionRouter / CommandRouter (Phase 2).
- Public WebSocket / public HTTP listener (Phase 8).
- Rewriting any Phase 0 module.
- Making `AppServerClient` restartable.
- Default-approving any approval; bypassing approvals; failing-open on errors.

## 11. First command for a new (post-compact) session

```bash
cat docs/handoffs/phase1-live-status.md && \
git status --short && \
git log --oneline -5
```

Then read `CLAUDE.md` "Compact / Resume Instructions" and follow the Context Recovery Mode flow before touching code.
