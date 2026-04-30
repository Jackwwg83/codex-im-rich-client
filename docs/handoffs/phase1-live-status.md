# Phase 1 Live Status

> Minimum context for compact / resume. Updated at task boundaries and before context exceeds 70%.
> **Last updated:** 2026-04-30 — Pre-3 docs amended; implementation pending. T9a blocked on Pre-3 merge.

---

## 1. Current phase / task

- **Phase:** Phase 1 — Codex Runtime Core
- **Active task:** **Pre-3** — `AppServerClient` `JsonRpcResponseError` propagation. Plan docs amended (this commit-window); implementation not yet started.
- **Blocked task:** T9a — cannot start until Pre-3 merges.
- **Last completed task:** T8 (CodexRuntime typed wrappers) + T8 codex review fixes.

## 2. Branch / HEAD

- **Branch:** `phase-1-runtime`
- **HEAD:** `585235e fix(t8): codex outside-voice review — 5 of 5 findings resolved`
- **Parent of HEAD:** `f59205f feat(codex-runtime): CodexRuntime typed wrappers (T8 / P1.1)`
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

## 4. Currently doing

User chose **Option C** (drift audit). Pre-3 is being executed docs-first / code-second:

- **Done in this turn:** stashed the drift as `stash@{0}: pre3-appserverclient-jsonrpc-error-propagation`; amended the plan with a new `Pre-3` subsection in §0.4, made T9a depend on Pre-3, clarified T9b §9b.3 throw-distinction (generic `Error` → -32603 vs explicit `JsonRpcResponseError` → preserve code/message/data), updated parallelization windows and rollout sequence; updated this live-status doc.
- **Not started:** Pre-3 implementation (which is just the unstash + verification + commit, since the diff already exists in the stash).

No `packages/core/` work has been done.

## 5. Next exact action

User-driven step pending. The expected sequence is:
1. Verify plan amendments by re-reading §0.4 Pre-3 + T9a "Depends on" + T9b §9b.3.
2. Pop the stash: `git stash pop stash@{0}`.
3. Re-run gates (`pnpm typecheck && pnpm test && pnpm lint && pnpm protocol:check && bash scripts/ci-check.sh`). Expected test count: 230 → 231.
4. Commit Pre-3 with the message in the plan's Pre-3 "Tag/commit" block (single commit on `phase-1-runtime`).
5. Optional: open the Pre-3 PR (or merge directly into `phase-1-runtime`, mirroring how Pre-1/Pre-2 landed).
6. Then start T9a's Step 9a.1.

## 6. Currently modified files (working tree only — not committed)

```
 M CLAUDE.md                                            (Compact / Resume Instructions; previous turn)
 M docs/superpowers/plans/2026-04-30-phase-1-runtime.md (Pre-3 + T9a/T9b amendments; this turn)
 M docs/handoffs/phase1-live-status.md                  (this turn — but already saved by the time you read this)
?? .claude/scheduled_tasks.lock                          (gstack runtime; ignore)
```

The original AppServerClient drift is in `git stash`, NOT in the working tree:
```
$ git stash list
stash@{0}: On phase-1-runtime: pre3-appserverclient-jsonrpc-error-propagation
```

## 7. Current test results

- `pnpm typecheck` → exit 0 (5 strict packages clean)
- `pnpm test` → **231 passed (231)**, 24 files
- `pnpm typecheck:tests` → exit 0
- `pnpm test:cli-smoke` → 2 passed
- `pnpm lint` → exit 0 (biome 77 files)
- `pnpm protocol:check` → exit 0
- `scripts/verify-phase1-fixtures.mts` → GATE PASS (1 server-request frames, 1 approval-capable)
- All 8 ci-check gates green at `585235e`. Drift commit isn't on HEAD, so the +1 test (231→232 transition) is staged but not yet permanent.

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

**Pre-3 implementation must complete (and merge) before T9a starts.** Drift-audit option C was chosen and is in flight. While Pre-3 is open, do not:

- Add ANY file under `packages/core/` (T9a/T9b territory).
- Add ANY file under `packages/codex-runtime/` beyond what T1-T8 already shipped.
- Add a broker, dispatch table, fixture replay, or `setServerRequestHandler` caller in any package.
- Hard-code an approval method-name string literal anywhere outside `packages/core/` (rule already in CLAUDE.md; not relaxed by Pre-3).
- Add real IM adapter (Phase 2+), Computer Use production flow (Phase 6), or any public WebSocket / public HTTP listener (Phase 8).
- Modify any Phase 0 module beyond Pre-3's narrow `dispatchServerRequest` catch-arm (`AppServerClient`, `StdioTransport`, `JsonlDecoder` are contract — only the catch-arm extension is in Pre-3 scope).
- Make `AppServerClient` restartable (still violates ONE-SHOT JSDoc).
- Bypass approvals or default-approve in any code path (Pre-3 does not touch approval semantics — only error-envelope propagation on the existing reject path).

Other Phase 1 non-goals from handoff (unchanged):
- Any IM adapter (Phase 2+).
- Computer Use production path (Phase 6).
- SQLite storage (Phase 2).
- ChannelAdapter / SessionRouter / CommandRouter (Phase 2).
- Rewriting any Phase 0 module.

## 11. First command for a new (post-compact) session

```bash
cat docs/handoffs/phase1-live-status.md && \
git status --short && \
git log --oneline -5
```

Then read `CLAUDE.md` "Compact / Resume Instructions" and follow the Context Recovery Mode flow before touching code.
