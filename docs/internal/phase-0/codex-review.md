# Phase 0 Codex CLI Independent Review

- **Date**: 2026-04-29
- **Codex CLI**: 0.125.0
- **Scope**: full Phase 0 git diff (commits `9372944`..`14f3324`, 30 commits, 67 tests passing pre-review)
- **Verdict**: **BLOCK-WITH-4-P1** → **CLEARED** after fix commit `1c81023`

## Summary

| Group | Sev | Count | Status |
|-------|-----|------:|--------|
| Group 1: Hard-rule violations | P0 | **0** | none |
| Group 2: Phase 0 production code-quality | P1 | **4** | all fixed in `1c81023` |
| Group 3: Phase 1 readiness | P2 | **4** | deferred to Phase 1 backlog |
| Group 4: Spec drift | P3 | **2** | deferred (low impact) |
| Group 5: Surprises | P3 | **1** | deferred (FakeAppServer test ergonomics) |

## Group 2 (P1) — applied in commit `1c81023`

### #1 — `request()` leaked pending entry on synchronous `send()` throw
- **File**: `packages/app-server-client/src/client.ts:111`
- **Issue**: pending entry inserted before `transport.send()`. A synchronous send throw left the entry + timer alive until `defaultTimeoutMs`.
- **Fix**: wrap `send()` in try/catch inside the Promise executor; clear timer + delete pending + reject immediately on throw.
- **Regression test**: `Codex final review #1 — request() does not leak pending on send throw`. Pre-fix would have waited 50ms; post-fix rejects in <40ms.

### #2 — Transport errors dropped (no `onError` subscription)
- **File**: `packages/app-server-client/src/client.ts:78`
- **Issue**: `start()` only subscribed `onMessage`+`onClose`. `StdioTransport`'s parse/spawn errors (emitted via `onError`) were lost; callers only saw later request timeouts.
- **Fix**: subscribe to `transport.onError`; log at warn level via the injected logger.
- **Regression test**: emits an error on the InMemoryTransport's `Side` EventEmitter and asserts the warn-spy fires with `"transport error"`.

### #3 — Server-request handler timeout never cleared on success
- **File**: `packages/app-server-client/src/client.ts:193` (in `dispatchServerRequest`)
- **Issue**: `Promise.race` against `setTimeout`. When handler resolved fast, the timer's closure stayed scheduled for `serverRequestHandlerTimeoutMs` (default 30s), retaining handler/params references.
- **Fix**: capture timer in `let timer` outside the race; `clearTimeout` in both success and failure branches.
- **Regression test**: `Codex final review #3 — server-request timeout timer is cleared on success`.

### #4 — JSON-RPC type guards too loose for production wire input
- **File**: `packages/app-server-client/src/jsonrpc.ts:60`
- **Issue**: `isJsonRpcResponse` / `isJsonRpcErrorResponse` only checked field presence. Malformed envelopes like `{id:1, error: undefined}` passed and reached `new JsonRpcResponseError(undefined)`, throwing inside the message handler and breaking dispatch.
- **Fix**: added `isValidId` (number|string) and `isValidError` ({code:number, message:string}) helpers. Response guards now check:
  - `id` is number/string for success; null allowed only for error responses
  - `result` cannot be `undefined`
  - `error` must be a well-formed `JsonRpcError`
  - `isJsonRpcServerRequest` tightens id to number|string (was lax).
- **Regression test**: 7 new tests covering each malformed shape + an end-to-end `client.handleMessage` tolerance test (3 malformed envelopes followed by a real ping that must still succeed).

## Group 3 (P2) — Phase 1 backlog

These are valid concerns but explicitly NOT Phase 0 scope. Captured for Phase 1.

| # | Subject | Phase 1 plan |
|---|---------|--------------|
| 1 | Raw string request API will want typed protocol bindings | Phase 1 `CodexRuntime` adds typed wrappers (e.g. `runtime.threadStart(params): Promise<ThreadStartResponse>`) over `client.request("thread/start", params)` |
| 2 | Single global server-request handler too coarse for `ApprovalBroker` | Phase 1 `ApprovalBroker` owns the single registered handler and dispatches internally on method name; will also add per-request lifecycle, expiry, audit metadata |
| 3 | Notification callback API has no queue/backpressure/replay | Phase 1 `EventNormalizer` will sit on top of `client.onNotification` and expose an ordered async iterator with terminal-state recognition |
| 4 | Client lifecycle is one-shot (`start()` doesn't reset `closed`) | Phase 1 will document one-shot policy explicitly. Daemon supervisor creates a new `AppServerClient` on codex restart rather than reusing |

## Group 4 (P3) — Spec drift

| # | Subject | Disposition |
|---|---------|-------------|
| 1 | `09-ROADMAP.md:52` Phase 1 list repeats AppServerClient/FakeAppServer tasks done in Phase 0 | Phase 1 plan rewrite will reword these as "extend/build on" |
| 2 | `host-environment.md:235` server-request capture note is stale (real-turn yielded zero server requests) | Already addressed by the "Real-turn smoke results" section on the same file (Task 10.2 commit `fa05a5e`); keeping the older note as-is documents the deferred capture |

## Group 5 (P3) — Surprise

| # | Subject | Disposition |
|---|---------|-------------|
| 1 | `FakeAppServer.emitServerRequest` waits forever without its own timeout | Phase 1: add `timeoutMs` parameter, unsubscribe on timeout, reject with diagnostic. Low impact for now since vitest test files have their own `testTimeout: 10000` ceiling. |

## Verbatim Codex output

Captured in this session (`codex exec` with `model_reasoning_effort=high`). The full output, including disposition labels and confidence scores, is reproduced inline above per finding.
