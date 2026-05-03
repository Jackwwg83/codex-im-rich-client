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

## Phase 2 implementation backlog ✅ COMPLETE 2026-05-02

All T2-T22 implementation shipped. T7-T12 + T13-T17 codex outside-voice
reviewed (verdict GO after fix arcs). T18-T22 outside-voice review
deferred — codex CLI hung in implementer's environment when these landed.
T24 will run integrated review across `phase-1-runtime-complete..HEAD`.
Test count 320 → 720. See
`docs/handoffs/2026-05-02-phase2-to-phase3.md` for full close-out summary.

| Item | Commits | Review |
|---|---|---|
| T2 ApprovalRequestKind classifier | `89968ee` | folded into T7-T12 review |
| T3 AuditEmitter + 12 kinds | `bd99dd1` | folded into T7-T12 review |
| T4 redact relocated to core (14 patterns) | `782ecdb` | `codex-review-t4.md` |
| T5 audit emit applies redact | `6530665` + `bc7de48` polish | `codex-review-t5.md` |
| T6 Phase 2 type surface | `4e95f50` | folded into T7-T12 review |
| T7 broker public surface (#pendingById + emitters + #settleEntry) | `9109e91` | T7-T12 combined |
| T8 enablePendingMode (D18 three-mode dispatcher) | `a2092c7` | T7-T12 combined |
| T9 bindActorPolicy storage | `1b16471` | T7-T12 combined |
| T10 decision-mapper + actionToDecision | `34a3c2c` | T7-T12 combined |
| T11 broker.resolve centerpiece (9 ResolveError + lazy expiry + actor binding) | `0a6a477` | T7-T12 combined |
| T12 fake e2e happy path | `704ed28` | T7-T12 combined |
| **T7-T12 Codex review fixes** (P0 toSnapshot defensive copy + 3xP1 + P2 ttl) | `231f653` | re-review GO |
| T13 render package skeleton | `4da5842` | T13-T17 combined |
| T14 RichBlock + ApprovalCard + ApprovalAction | `e1993dd` | T13-T17 combined |
| T15 truncate + redact re-export | `092e8dc` | T13-T17 combined |
| T16 project-approval per-kind | `3f04f86` | T13-T17 combined |
| T17 plain-text capability fallback | `6e3516f` | T13-T17 combined |
| **T13-T17 Codex review fixes** (P1 command field + P1 createdAt copy + P2 frozen arrays + P2 T-G1 expansion + P2 dropped protocol dep) | `7f6b6a1` | re-review GO |
| T18 channel-core skeleton + types + boundary tests | `a08cc81` | deferred to T24 |
| T19 ChannelAdapter (D14 closed) + TelegramShapeFakeChannelAdapter | `acea679` | deferred to T24 |
| T20 method-literal grep guard scope extension | `27c3c76` | deferred to T24 |
| T21 full e2e (14 paths + index stress + bounds) | `0a121e2` | deferred to T24 |
| T22 supervisor pre-attached-broker invariant (D16) | `d452391` | deferred to T24 |

## Phase 3 backlog candidates (not yet planned — picked by /plan-eng-review)

These are the natural Phase 3 candidates surfaced during Phase 2. Phase 3
mission picks a subset; full list maintained in
`docs/handoffs/2026-05-02-phase2-to-phase3.md` §"Recommended Phase 3 mission".

- [ ] **`@codex-im/im-telegram`** — real Telegram adapter implementing the closed `ChannelAdapter` interface (uses grammY or native Bot API; respects `TelegramShapeFakeChannelAdapter` constraints).
- [ ] **Production daemon wire-up** — replace test-only `phase2-e2e-rig.ts` daemon-wireup function with a real `@codex-im/daemon` module subscribing broker.onPendingCreated → projectAsRichBlock → adapter.sendCard → bindActorPolicy.
- [ ] **SecurityPolicy ACL** — Phase 2 left `SecurityPolicy` as `phase1-noop`. Phase 3 fills in: per-target/actor allowlist before bindActorPolicy; deny-app/deny-command lists.
- [ ] **Audit log SQLite migration** — Phase 2 ring buffer is in-memory only. Phase 3 adds durable SQLite-backed audit + ring-as-cache + prune sweep for terminal records (#pendingById grows unbounded otherwise).
- [ ] **launchd integration** — daemon as a macOS launchd service for Mac mini deployment.
- [ ] **Synthesized turn_failed events** — when transport closes mid-turn, EventNormalizer should synthesize a `turn_failed` event for the IM layer.
- [ ] **Computer Use approval flow** (Phase 6) — `tool_call` kind currently default-rejects.
- [ ] **Supervisor reattach + stale request test (T21.2.12 deferred)** — full daemon-side test of "old approvalId resolve returns transport_lost across generation reattach". Phase 2 covered the broker side; Phase 3 wires the supervisor.
- [ ] **Lazy-prune sweep for terminal records** — `#pendingById` retains terminal records for audit lookup; Phase 3 sweep prevents unbounded growth.
- [ ] **Structured secret detector** — current `redact.ts` is regex-based. Phase 3 may add structured detection for known credential prefixes with parsed-context awareness.
- [ ] **Per-kind risk-level computation from params** — Phase 2 KIND_TABLE has fixed risk levels; Phase 3 may derive from params content (e.g. `command_execution` with `rm -rf` in argv → critical).
- [ ] **Localization for plain-text fallback** — Phase 2 ships English defaults; Phase 3 + adapter scope owns i18n.
- [ ] **MaxListenersExceededWarning during stress test** — `phase2-e2e-secondary-index.test.ts` triggers 100 concurrent emitServerRequests; bump max listeners on InMemoryTransport.

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

## Phase 3 implementation progress (closed at JAC-64 tag gate, 2026-05-02)

Active branch: `phase-3-implementation`. Plan-of-record:
`docs/superpowers/plans/2026-05-02-phase-3-plan.md` v2.4. Live status:
`docs/handoffs/phase3-live-status.md` (always the canonical reference for
current state — this index is just a checkpoint). Phase 3 -> Phase 4 handoff:
`docs/handoffs/2026-05-02-phase3-to-phase4.md`.

| Item | Commits | Review |
|---|---|---|
| T1-T8 storage/config foundation | `3ada728` → `d549e92` | impl-t1-t2c review closed by `04a92fe` |
| T9-T13 policy/router/core foundation | `ec68bc7` → `ad44918` | live-status checkpoint |
| D41 channel boundary amendment | `10e898e`, `c2648f3` | live-status checkpoint |
| T14-T19 daemon production wire-up | `6d1b4ae` → `83015c0` | mid-phase review closed by `b5c4441` |
| T20-T28 real Telegram adapter fake/contract slice | `d073ce1` → `fa5909f` | final review scope |
| T29-T36 ops + launchd + smoke harnesses | `b707f28` → `36d8903` | final review scope |
| T38 final review fixes | `28adc64`, `f57acc0`, `938a917`, `0b0eb98`, `eb05753` | response recorded in `docs/phase-3/impl-t1-t36-final-review-response.md` |

## Phase 4 implementation progress (closed at JAC-162 tag gate, 2026-05-02)

Active branch: `codex/phase-4-planning`. Plan-of-record:
`docs/superpowers/plans/2026-05-02-phase-4-lark-plan.md`. Live status:
`docs/handoffs/phase4-live-status.md`. Phase 4 -> Phase 5 handoff:
`docs/handoffs/2026-05-02-phase4-to-phase5.md`.

| Item | Commits | Review |
|---|---|---|
| T0/T0a plan + Lark action transport verification | `1d076ab`, `ceabfd4` | plan v1.2 GO_WITH_LOW_NITS |
| T1-T4 package skeleton, config, lifecycle, receive fixtures | `9865e39` → `f3bf5b3` | final review scope |
| T5-T8 text/card/action/ack surfaces | `23e5d14` → `77d6b56` | final review scope |
| T9-T11 contract + fake smoke + env-gated live smoke | `681a0dd` → `f51c7c6` | final review scope |
| T12 final review fixes | `50a90c4`, `c289a7a` | re-review GO_WITH_LOW_NITS; P2 low nits closed before tag |

## Phase 5 implementation progress (closed at JAC-90 tag gate, 2026-05-02)

Active branch: `codex/phase-5-dingtalk`. Plan-of-record:
`docs/superpowers/plans/2026-05-02-phase-5-dingtalk-plan.md`. Live status:
`docs/handoffs/phase5-live-status.md`. Phase 5 -> Phase 6 handoff:
`docs/handoffs/2026-05-02-phase5-to-phase6.md`.

- [x] **JAC-78 / Phase 5 DingTalk plan gate** — write/review the DingTalk Stream-mode plan-of-record before implementing `@codex-im/im-dingtalk`. Review result: v1 APPROVE_WITH_CHANGES, v1.1 GO. Current docs: `docs/superpowers/plans/2026-05-02-phase-5-dingtalk-plan.md`, `docs/phase-5/dingtalk-target-verification.md`, and `docs/handoffs/phase5-live-status.md`.
- [x] **JAC-79 / T1** — `@codex-im/im-dingtalk` skeleton + boundary tests after JAC-78 review gate.
- [x] **JAC-80 / T2** — Stream lifecycle fake test and injected `DWClient` wrapper; no live network or credentials.
- [x] **JAC-81 / T3** — DingTalk message receive fixtures and normalization; no card send/update or callback action mapping.
- [x] **JAC-82 / T4** — card send/update through injectable DingTalk card client; no callback action mapping.
- [x] **JAC-83 / T5** — callback codec/parser only; do not emit `InboundAction` before JAC-84 proves messageRef validation.
- [x] **JAC-84 / T6** — messageRef validation + gated `InboundAction` emission.
- [x] **JAC-85 / T7** — fake approval round-trip through DingTalk adapter action surface; no live network.
- [x] **JAC-86 / T8** — reconnect behavior and duplicate callback/message idempotency tests.
- [x] **JAC-87 / T9** — DingTalk adapter contract suite and boundary/secret guard coverage.
- [x] **JAC-88 / T10** — fake DingTalk smoke through daemon routing; no live network or credentials.
- [x] **JAC-89 / T11** — env-gated live DingTalk smoke harness; default skip, no unattended live network.
- [x] **JAC-90 / T12** — final review/handoff/tag per Phase 5 plan. Final review first returned APPROVE_WITH_CHANGES; `4a308d2` closed P1/P2 blockers; re-review returned GO with no P0/P1/P2 findings.

## Phase 6 implementation progress (active, 2026-05-03)

Active branch: `codex/phase-6-computer-use`. Plan-of-record:
`docs/superpowers/plans/2026-05-03-phase-6-computer-use-plan.md`. Live status:
`docs/handoffs/phase6-live-status.md`. Phase 5 -> Phase 6 handoff:
`docs/handoffs/2026-05-02-phase5-to-phase6.md`.

- [x] **JAC-91 / T0** — Computer Use plan review gate. Plan v1 returned APPROVE_WITH_CHANGES; v1.1 Codex re-review returned GO with no remaining P0/P1/P2.
- [x] **JAC-92 / T1** — explicit `/cu` command parser only; no desktop action/provider.
- [x] **JAC-93 / T2** — ComputerUsePolicy schema/evaluator.
- [x] **JAC-94 / T3** — `allowed_apps` / `deny_apps` config.
- [x] **JAC-95 / T4** — explicit `/cu` prompt wrapper.
- [x] **JAC-96 / T5** — normal prompt cannot create Computer Use intent; full dynamic-tool gate is JAC-97.
- [ ] **JAC-163 / T6** — Computer Use capability evidence and fake/unsupported provider boundary. **Current.**
- [ ] **JAC-97 / T7** — dynamic tool gate + sensitive-step approval model.
- [ ] **JAC-98 / T8** — audit events for Computer Use trigger/tool-call outcomes.
- [ ] **JAC-99 / T9** — Chrome-only fake/manual smoke docs.
- [ ] **JAC-100 / T10** — operator-gated live Computer Use smoke harness/default skip.
- [ ] **JAC-101 / T11** — final review/handoff/tag.
