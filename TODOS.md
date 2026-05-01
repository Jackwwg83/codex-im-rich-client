# TODOS

Pending items deferred from prior phases. Each links to where the rationale lives.
Phase 1 plan-eng-review should ground itself on this file.

## From Phase 0 (closed by tag `phase0-bootstrap-complete`)

### Phase 1 implementation backlog ✅ COMPLETE 2026-05-01

All P1.1-P1.6 items shipped + codex outside-voice reviewed. See
`docs/handoffs/2026-05-01-phase1-to-phase2.md` for the close-out
summary and Phase 2 hand-off.

| Item | Commits | Review |
|---|---|---|
| P1.1 CodexRuntime typed wrappers | `f59205f` T8 + `585235e` review | `codex-review-t8.md` |
| P1.3 EventNormalizer | T7a `649d631` + T7b `040b861` `c4239c7` `85cd22a` `908d640` review | `codex-review-t7b.md` |
| P1.2 ApprovalBroker | T9a `f274aae` `e8d5c1a` `7a05598` `7fe48c6` review + T9b `1ecb394` `4798c02` `decb570` `bf97a49` `e814880` (B-clean blocker fix) `429fc2c` review | `codex-review-t9a.md` + `codex-review-t9b.md` + `codex-review-t9b-blocker-fix.md` |
| P1.4 Daemon supervisor | T11a `e950613` `185b5e8` review + T11b `43223e8` `a4e1bc4` review | `codex-review-t11a.md` + `codex-review-t11b.md` |
| P1.5 categorizeJsonRpcError | Phase 1 T1 (early branch commits) | inline review |
| P1.6 richer wire fixtures | T4 `a4187fc` capture + T4.5 `8f0603d` acceptance gate | `codex-review-t8.md` (gate verified across all subsequent tasks) |
| (mid-phase) Pre-3 AppServerClient JsonRpcResponseError | `c96d36d` docs + `44e2623` code | inline review (T9a needed it for -32601 blocker fix) |
| (mid-phase) T9b broker B-clean blocker fix | `8a14bbe` docs + `e814880` code + `429fc2c` P2 + `f9915f7` review | `codex-review-t9b-blocker-fix.md` |
| (T10) codex-im runtime send CLI | `107af4a` impl + `64c397f` review | `codex-review-t10.md` |

### Phase 1 implementation backlog (historical reference — superseded)

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

## Phase 2 P2 polish backlog (round-3 deep-review deferred, 2026-05-01)

5 P2 test-hardening items surfaced by the post-T3 Codex deep review (`/tmp/phase2-deep-review-output.txt`). User chose Option B+ at round-3: apply 6 P1 + 2 docs-P2 immediately; defer these 5 test-hardening items to organic future tasks. None block T4 / Phase 2 progress; pick up when the relevant task naturally touches them.

- [ ] **P2-poly-1 — Tighten T2 / T3 type-level "exact union" guards.**
  - **Why:** Current array-membership tests in `packages/core/test/approval-request-kind.test.ts` and `packages/core/test/audit.test.ts` would still pass if an 11th `ApprovalRequestKind` or 13th `AuditEventKind` were added. Codex round-3 P2-2 / P2-4.
  - **Where:** Add `Exclude<ApprovalRequestKind, Listed[number]> extends never ? true : never` style guard in both test files (and equivalent for `AuditEventKind`).
  - **Pick up:** when T16 (render per-kind tests) lands — same pattern applies.

- [ ] **P2-poly-2 — Add T2 classifier `Object.hasOwn` prototype-key tests.**
  - **Why:** Implementation correctly rejects `"toString"` / `"constructor"` / `"hasOwnProperty"` etc. via `Object.hasOwn`, but tests don't cover the edge. Codex round-3 P2-3.
  - **Where:** `packages/core/test/approval-request-kind.test.ts` — add 3 assertions.
  - **Pick up:** during T11 actor-validation work (when broker `#handle` is exercised under adversarial fixtures).

- [ ] **P2-poly-3 — T3 audit constructor edge tests.**
  - **Why:** Implementation handles NaN, Infinity, MAX_SAFE_INTEGER, -0 via `Number.isInteger` + `<= 0` checks; tests don't pin. Codex round-3 P2-5.
  - **Where:** `packages/core/test/audit.test.ts` — add 4 assertions in the constructor block.
  - **Pick up:** during T5 audit-redact wiring (when audit.ts is touched again anyway).

- [ ] **P2-poly-4 — T3 multi-cycle FIFO ring stress test.**
  - **Why:** Current FIFO test covers a single overflow; multi-cycle (e.g. ringSize 3 + 10 emits → assert `[7, 8, 9]`) would catch any off-by-one rotate-path bug. Codex round-3 P2-6.
  - **Where:** `packages/core/test/audit.test.ts` — add 1 stress test.
  - **Pick up:** during T5 audit-redact wiring.

- [ ] **P2-poly-5 — Decide `outcome` field placement on AuditEvent (root vs. metadata).**
  - **Why:** D12/D21 pseudocode references `outcome: "lost-race"` as a root field on AuditEvent, but `packages/core/src/audit.ts:88` AuditEvent has no root `outcome` field. Either move under `metadata` or add explicit optional root field. Codex round-3 P2-7a.
  - **Where:** Update `packages/core/src/audit.ts` AuditEvent shape AND the D12/D21 pseudocode in plan §1.
  - **Pick up: BEFORE T7 starts.** T7 wires `#settleEntry` (which emits the `outcome` field); the decision must land before T7 implementation — either as a dedicated task between T6 and T7, or folded into T7.1 as a prerequisite.
  - **Default if unaddressed at T7 time:** put `outcome` under `metadata.outcome` (no AuditEvent shape change; conservative).

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
