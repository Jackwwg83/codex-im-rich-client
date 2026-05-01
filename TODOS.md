# TODOS

Pending items deferred from prior phases. Each links to where the rationale lives.
Phase 1 plan-eng-review should ground itself on this file.

## From Phase 0 (closed by tag `phase0-bootstrap-complete`)

### Phase 1 implementation backlog (active)

- [ ] **P1.1 — `CodexRuntime` typed wrappers** over `client.request<R>(method, params)`
  - **Why**: Phase 1 callers will otherwise scatter method strings and unchecked result casts across the runtime.
  - **What**: typed wrappers like `runtime.threadStart(params): Promise<ThreadStartResponse>` over `client.request("thread/start", params)`. Cover at least `thread/{start,resume,fork,interrupt,turns/list,read}`, `turn/{start,steer,interrupt}`, `review/start`, `command/exec/{,write,terminate,resize}`. Use `@codex-im/protocol` generated types as the source of truth — ts-rs union arms drive the wrapper signatures.
  - **Where to start**: `packages/codex-runtime/` (new package). Depends on existing `@codex-im/app-server-client` `AppServerClient` + handshake.
  - **Source**: `docs/phase-0/codex-review.md` Group 3 #1.

- [ ] **P1.2 — `ApprovalBroker` with single server-request handler + internal method dispatch**
  - **Why**: Phase 0 `AppServerClient.setServerRequestHandler` accepts ONE global handler. Phase 1 needs method routing, expiry, audit metadata, and per-turn/thread ownership. Multiple modules cannot register their own handlers — they ALL go through `ApprovalBroker` which owns the one slot.
  - **What**: `ApprovalBroker.handleServerRequest(req)` is the single registered handler. Internally it switches on `req.method` (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `item/tool/call`, `mcpServer/elicitation/request`, `applyPatchApproval` legacy, `execCommandApproval` legacy, `account/chatgptAuthTokens/refresh`). Method names MUST be read from generated `ServerRequest.ts`, NOT hardcoded as string literals (Phase 0 Task 10.3 audit enforced zero hardcoded method names in production code).
  - **Where to start**: `packages/core/src/approval-broker.ts` (new). Depends on `@codex-im/app-server-client`.
  - **Source**: `docs/phase-0/codex-review.md` Group 3 #2.

- [ ] **P1.3 — `EventNormalizer` ordered async iterator + terminal-state recognition**
  - **Why**: Phase 1 needs ordered async consumption of codex events with terminal-state recognition (`turn/completed`, `turn/failed`-equivalent if discovered, `thread/closed`, etc.) and deterministic teardown. Fire-and-forget `client.onNotification` callbacks make missed events hard to reason about.
  - **What**: a normalizer that sits on top of `client.onNotification`, exposes `for await (const event of normalizer.events())`, maps raw `JsonRpcNotification` (e.g. `turn/completed`, `item/agentMessage/delta`, `item/started`, `item/commandExecution/outputDelta`, `item/fileChange/patchUpdated`, `turn/diff/updated`) into `CodexRichEvent` per `03-ARCHITECTURE.md` §6. Must:
    - preserve order (FIFO queue between callback fire and async iterator consume)
    - recognize terminal events and gracefully close the iterator
    - allow per-turn / per-thread filtered sub-iterators if needed by ApprovalBroker
    - surface unknown methods as `{ type: "unknown", method, params }` without crashing
  - **Where to start**: `packages/codex-runtime/src/event-normalizer.ts`. Depends on `@codex-im/app-server-client` and `@codex-im/protocol`.
  - **Source**: `docs/phase-0/codex-review.md` Group 3 #3.

- [ ] **P1.4 — Daemon supervisor: client lifecycle policy on codex restart**
  - **Why**: `AppServerClient.stop()` and `handleClose()` set `closed=true` and never reset. Phase 0 `client.ts` JSDoc explicitly documents the ONE-SHOT policy (commit `2055646`). Phase 1 daemon supervisor MUST respect it: when codex subprocess exits or transport closes, the supervisor must construct a NEW `AppServerClient` and re-attach handlers, NOT reuse the old one.
  - **What**: `packages/daemon/src/supervisor.ts` (new). On codex child exit: log + audit, exponential backoff, spawn fresh `StdioTransport`, construct new `AppServerClient(transport, opts)`, run `performInitializeHandshake`, re-register `ApprovalBroker` as server-request handler, re-subscribe `EventNormalizer` to notifications, replace runtime's reference to point at new client.
  - **Where to start**: read `packages/app-server-client/src/client.ts` "Lifecycle policy: ONE-SHOT" header JSDoc for the 7-step protocol.
  - **Source**: `docs/phase-0/codex-review.md` Group 3 #4. JSDoc applied in `packages/app-server-client/src/client.ts`.

- [ ] **P1.5 — `categorizeJsonRpcError(err)` helper**
  - **Why**: Codex 0.125 returns `-32600` for BOTH unknown-method AND invalid-params (Phase 0 wire spike case 3+4 in `host-environment.md`). Client cannot distinguish by code alone. Also: malformed JSON has NO JSON-RPC error response — it's stderr-only with ANSI escapes (case 5).
  - **What**: helper in `packages/app-server-client/src/errors.ts` (or `src/jsonrpc.ts`) that string-matches `error.message`:
    - `"unknown variant"` → `{ category: "method-not-found", code: -32600 }`
    - `"missing field"` / `"invalid type"` / `"unknown field"` → `{ category: "invalid-params", code: -32600 }`
    - other `-32600` → `{ category: "invalid-request", code: -32600 }`
    - `-32603` → `{ category: "internal-error" }`
    - other code → `{ category: "unknown", code }`
  - Note that **malformed JSON wire frames** never reach `categorizeJsonRpcError` because they're stderr-only — they surface via `StdioTransport`'s logger.warn path, not as a `JsonRpcResponseError`.
  - **Where to start**: `packages/app-server-client/src/errors.ts` exports new helper alongside `JsonRpcResponseError`.
  - **Source**: `docs/phase-0/host-environment.md` "Wire spike results" + Codex outside-voice on plan v2.

- [ ] **P1.6 — Capture richer wire fixtures** during EventNormalizer development
  - **Why**: Phase 0 `smoke:real-turn` ran with a deliberately minimal "Reply OK" prompt. Model never triggered any `item/agentMessage/delta`, `item/started`, `command/exec/outputDelta`, server-initiated approval request, etc. The committed `harmless-turn-event-stream.jsonl` slot in `packages/testkit/fixtures/codex-0.125.0/` is still a placeholder.
  - **What**: design a Phase 1 richer prompt that exercises (a) tool use / file edit / shell exec — each producing a stream of `item/*/outputDelta` and `item/completed` notifications, (b) at least one server-initiated approval request so `item/{commandExecution,fileChange}/requestApproval` shapes can be captured. Run `CODEX_REAL_SMOKE=1 pnpm smoke:real-turn` with the richer prompt, capture the full notification stream, save as `packages/testkit/fixtures/codex-0.125.0/<scenario>-event-stream.jsonl`. Update `packages/testkit/test/fixture-replay.test.ts` to add contract tests over the new fixtures.
  - **Where to start**: extend `packages/cli/src/smoke-real-turn.ts` with a `--capture <path>` flag (or a sibling `smoke-real-turn-capture.ts`) that dumps every inbound message verbatim to a file. Then write the prompt, run, commit the fixture.
  - **Source**: `docs/phase-0/host-environment.md` "Real-turn smoke results" Phase 1 implications. Codex outside-voice on plan v2 #1 follow-up.

### Phase 1 documentation work (small, can fold into any P1.x commit)

- [ ] **05-CODEX-APP-SERVER-PROTOCOL.md** ongoing maintenance
  - Phase 0 close-out did a comprehensive audit (commit `70a0381`). Phase 1 EventNormalizer/ApprovalBroker work will surface more of the protocol surface; expect to update §3, §4.1, §5–§7 as fixtures are captured.
  - Re-validate against `packages/codex-protocol/src/generated/ServerRequest.ts`, `ServerNotification.ts`, `ClientRequest.ts` whenever a Phase 1 module imports a new method name.

### Phase 1 starting-point review

- [ ] **Run `gstack /plan-eng-review` on Phase 1 plan before implementation**
  - Phase 0 plan v2 had 11 issues caught by gstack review + 10 caught by Codex outside voice. Don't skip this for Phase 1.
- [ ] **Run Codex outside voice on Phase 1 plan**
  - Same reasoning — two-model review catches structural blind spots.

## Done in Phase 0 (no action — listed for traceability)

- [x] ~~**FakeAppServer.emitServerRequest timeoutMs**~~ — applied in commit `022c075` with default 5000ms + diagnostic error naming method+id+timeout. 2 regression tests.
- [x] ~~**05-PROTOCOL.md approval method names + comprehensive audit**~~ — applied in commit `70a0381`. Replaced stale `"approval/request"`/`"commandApproval/request"` guesses with real `item/{commandExecution,fileChange,permissions,tool}/{requestApproval,requestUserInput}` from generated `ServerRequest.ts`. Added explicit injunction: app-server-client layer must NOT hardcode approval method names; Phase 1 ApprovalBroker reads them from generated schema.
- [x] ~~**09-ROADMAP Phase 1 wording "build" → "extend/build on"**~~ — applied in commit `88d37a7`. Marked AppServerClient/FakeAppServer/smoke:app-server/request-correlation/unknown-event as done with cross-references.
- [x] ~~**`AppServerClient` ONE-SHOT lifecycle JSDoc**~~ — applied in commit `2055646`. Header documents 7-step supervisor recovery protocol.
- [x] ~~**`pnpm audit` baseline**~~ — clean run recorded in `docs/phase-0/host-environment.md` Security baseline section. 193 deps, 0 vulnerabilities.

## External (not gated on a phase)

- [ ] **Report codex 0.125 `generate-json-schema` non-determinism upstream**
  - **Why**: Same input two consecutive runs produce schema files with reordered top-level keys (HashMap iteration order in serde_json). Phase 0 worked around with `scripts/canonicalize-schema.mjs`.
  - **Where**: openai/codex GitHub Issues. Include reproduction:
    ```bash
    mkdir /tmp/a /tmp/b
    codex app-server generate-json-schema --out /tmp/a
    codex app-server generate-json-schema --out /tmp/b
    diff /tmp/a/codex_app_server_protocol.v2.schemas.json \
         /tmp/b/codex_app_server_protocol.v2.schemas.json
    ```

## Hygiene (no fixed phase)

- [ ] **CI** (GitHub Actions): `pnpm install` + `typecheck` + `test` + `lint` + `check:codex-version` + `protocol:check` on every PR. Probably want this before Phase 1 is shippable to a remote.
- [ ] **`pnpm audit` periodic check**: re-run on every dependency bump and at start of each phase.
- [ ] **launchd plist + install script**: Phase 3 work per plan v2 NOT-in-scope. Required before Mac mini "always-on daemon" promise can be kept.

## Future defensive guardrails (not currently scheduled)

- [ ] **`AppServerClient` active server-request idempotency**
  - **Why**: Defense-in-depth against any future code path that accidentally produces a duplicate JSON-RPC response for the same id. Considered as Option A for the T9b blocker fix (2026-05-01) but explicitly **declined as the primary fix** because the duplicate-response bug was owned by `ApprovalBroker`'s split lifecycle, not by the wire layer. Fixing it at the protocol layer would have masked broker-internal bugs. The blocker was instead fixed in `ApprovalBroker` via B-clean (single broker-owned completion promise per pending request).
  - **What**: extend `AppServerClient` with a `Set<JsonRpcId>` of responded ids. `respond(id, ...)` / `reject(id, ...)` on an already-responded id silently drops (and `log.warn`s for visibility — surfacing real broker bugs instead of hiding them). Set is cleared in `stop()`. Consider periodic prune for long-running sessions.
  - **Where to start**: `packages/app-server-client/src/client.ts` — extend `respond` / `reject` methods, add a small unit test in `packages/app-server-client/test/`. Mirrors the Pre-3 modification pattern.
  - **Source**: T9b blocker fix decision 2026-05-01 (user message). `docs/phase-1/codex-review-t9b.md` finding #1 + plan §"Task 9b blocker-fix" → "Future defensive guardrail".
  - **Not scheduled**: ship only when there's a concrete second case where the wire-layer guard would catch a real bug. As of 2026-05-01 the `ApprovalBroker` is the only producer of server-request responses, and its B-clean lifecycle prevents duplicates by construction.
