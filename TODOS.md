# TODOS

Pending items deferred from prior phases. Each links to where the rationale lives.
Phase 1 plan-eng-review should ground itself on this file.

## From Phase 0 (closed by tag `phase0-bootstrap-complete`)

### Phase 1 — `CodexRuntime` / `EventNormalizer` / `ApprovalBroker`

- [ ] **P2.1** Typed request wrappers over `client.request<R>(method, params)`
  - **Why**: Phase 1 callers will otherwise scatter method strings and unchecked result casts across CodexRuntime.
  - **Where to start**: `packages/codex-runtime/` (new package). Wrap the Phase 1 methods (`thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`, `review/start`, `command/exec`, etc.) with typed wrappers using `@codex-im/protocol` generated types.
  - **Source**: `docs/phase-0/codex-review.md` Group 3 #1.

- [ ] **P2.2** ApprovalBroker dispatcher with method routing + per-request lifecycle
  - **Why**: Phase 0 client has a single global server-request handler — too coarse for ApprovalBroker which needs method routing, expiry, audit metadata, and ownership by turn/thread.
  - **Where to start**: `packages/core/src/approval-broker.ts` (new). Owns the single `client.setServerRequestHandler(...)` slot; internally dispatches on method name from `generated/ServerRequest.ts` (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `applyPatchApproval`, `execCommandApproval`, `mcpServer/elicitation/request`, `account/chatgptAuthTokens/refresh`, `item/tool/call`).
  - **Source**: `docs/phase-0/codex-review.md` Group 3 #2.

- [ ] **P2.3** EventNormalizer — ordered async iterator over `client.onNotification`
  - **Why**: Phase 1 needs ordered async consumption of codex events with terminal-state recognition (turn/completed, etc.) and deterministic teardown. Fire-and-forget callbacks make missed events hard to reason about.
  - **Where to start**: `packages/codex-runtime/src/event-normalizer.ts`. Exposes `for await (const event of normalizer.events())` instead of callback. Maps raw `JsonRpcNotification` (e.g. `turn/completed`, `item/agentMessage/delta`, `item/started`, `command/exec/outputDelta`) into `CodexRichEvent` per `03-ARCHITECTURE.md` §6.
  - **Source**: `docs/phase-0/codex-review.md` Group 3 #3.

- [ ] **P2.4** Document one-shot client lifecycle in supervisor design
  - **Why**: `AppServerClient.stop()` and `handleClose()` set `closed=true` and never reset. Daemon supervisor must create a NEW `AppServerClient` after codex restart, not reuse the old one. Phase 0 already has JSDoc warning on `client.ts`; Phase 1 supervisor design must respect it.
  - **Where to start**: `packages/daemon/src/supervisor.ts` (new). On codex child exit: log, wait backoff, spawn fresh `StdioTransport` + `AppServerClient`, re-run `performInitializeHandshake`, re-attach handlers.
  - **Source**: `docs/phase-0/codex-review.md` Group 3 #4. JSDoc applied in `packages/app-server-client/src/client.ts`.

### Phase 1 — Diagnostics + protocol nuance

- [ ] **categorizeJsonRpcError(err)** helper to disambiguate codex's overloaded `-32600`
  - **Why**: Codex 0.125 returns `-32600` for BOTH unknown-method AND invalid-params (Phase 0 wire spike case 3+4 in `host-environment.md`). Client cannot distinguish by code alone.
  - **What**: helper in `packages/app-server-client/src/jsonrpc.ts` (or new `errors.ts`) that string-matches `error.message`:
    - `unknown variant` → `category: "method-not-found"`
    - `missing field` / `invalid type` / `unknown field` → `category: "invalid-params"`
    - else → `"unknown"`
  - **Source**: `docs/phase-0/host-environment.md` "Wire spike results" implications #4. Codex outside-voice on plan v2.

- [ ] **Capture richer wire fixtures** during EventNormalizer development
  - **Why**: Phase 0 `smoke:real-turn` ran with a deliberately minimal "Reply OK" prompt. Model never triggered any server-initiated request, so no `agentMessage/delta`, no `item/started`, no `command/exec/outputDelta`, etc. were captured.
  - **What**: When Phase 1 EventNormalizer needs concrete event examples, run real-turn with a richer prompt that exercises tool use / file edit / shell exec, and commit the captured event stream as `packages/testkit/fixtures/codex-X.Y.Z/<scenario>-event-stream.jsonl`. Add contract tests over them.
  - **Source**: `docs/phase-0/host-environment.md` "Real-turn smoke results" Phase 1 implications.

- [ ] **FakeAppServer.emitServerRequest** add own `timeoutMs` + reject-on-timeout
  - **Why**: Currently waits forever for client response. If a test forgets to register a server-request handler, the test hangs to vitest's outer 10s ceiling with a useless "test timed out" diagnostic instead of "fake's emitServerRequest never got an answer for method X".
  - **What**: add `timeoutMs?: number` to `emitServerRequest(method, params?, id?, opts?)`. On timeout: unsubscribe, reject Promise with diagnostic error naming method+id.
  - **Source**: Codex final review Group 5 #1.
  - **Status**: ALREADY ADDRESSED in Phase 0 follow-up commit (next in this batch).

### Documentation

- [ ] **05-CODEX-APP-SERVER-PROTOCOL.md** continued audit
  - **Why**: Originally written before we had real codex 0.125 wire data. Phase 0 wrap-up did a first audit; Phase 1 likely needs more updates as EventNormalizer/ApprovalBroker explore more of the surface.
  - **Where to start**: re-read against `packages/codex-protocol/src/generated/ServerRequest.ts`, `ServerNotification.ts`, `ClientRequest.ts` and update method names, request/response shapes accordingly.
  - **Status**: Phase 0 first pass landed in this batch's `05-PROTOCOL` commit.

## External

- [ ] **Report codex 0.125 `generate-json-schema` non-determinism upstream**
  - **Why**: Same input two consecutive runs produce schema files with reordered top-level keys (HashMap iteration order in serde_json). Phase 0 worked around with `scripts/canonicalize-schema.mjs`.
  - **Where**: openai/codex GitHub Issues. Include reproduction (`mkdir /tmp/a /tmp/b; codex app-server generate-json-schema --out /tmp/a; codex app-server generate-json-schema --out /tmp/b; diff /tmp/a/codex_app_server_protocol.v2.schemas.json /tmp/b/codex_app_server_protocol.v2.schemas.json`).

## Hygiene (no fixed phase)

- [ ] **CI** (GitHub Actions): pnpm install + typecheck + test + lint + check:codex-version + protocol:check on every PR. Probably want this before Phase 1 is shippable to a remote.
- [ ] **`pnpm audit` periodic check**: ran once at end of Phase 0 (clean). Re-run on dependency bumps.
- [ ] **launchd plist + install script**: Phase 3 work per plan v2 NOT-in-scope. Required before Mac mini "always-on daemon" promise can be kept.
