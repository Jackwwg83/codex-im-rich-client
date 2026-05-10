VERDICT: REJECT
SUMMARY: The mission shape is right, but v1 has blocking approval/callback design gaps that would either fail to render real approvals or leave required Telegram security bindings unimplemented.

P0 (blocks Phase 3 implementation start):
  - [§7 D29 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:343-352; packages/core/src/approval-broker.ts:596-607] D29 never enables broker pending mode before production use — without `enablePendingMode(...)`, server requests stay default-reject and no `onPendingCreated` card path exists — make pending-mode enablement for the IM-routable methods an explicit pre-supervisor start step and test it in `Daemon.start`.

  - [§10.2 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:520-531; packages/core/src/approval-broker.ts:941-952] The `auto_decline` path calls `broker.resolve` without first binding an actor policy, so the broker returns `binding_required` and leaves Codex hanging — bind a synthetic system actor policy with a daemon-generated nonce before resolving, or add a reviewed broker API that still routes through `resolve`.

  - [§7 D29 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:350-352; packages/core/test/phase2-e2e-rig.ts:115-130] The plan preserves the Phase 2 `sendCard → bindActorPolicy` race; a real Telegram user can click after the message lands but before binding exists — change to a two-phase/daemon-owned callback token flow where nonce + actor/target/message binding exists before remote send, then send the card.

  - [§7 D30 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:353-357; packages/core/src/approval-broker.ts:721-724; packages/core/test/phase2-e2e-callback-bounds.test.ts:14-17] `${approvalId}|${kind}|${nonce}` does not fit for plausible real IDs; current broker IDs are `approval-${req.id}`, and Phase 2 only proved 6-digit numeric ids — replace callback_data with a short opaque token persisted to SQLite and mapped to `{approvalId, action, nonce, target, messageRef}`.

  - [§22 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:1129-1132; packages/core/src/types.ts:329-333; packages/channel-core/src/types.ts:102-116] The plan claims callback actions bind message/card id, but neither `ActorPolicy` nor `InboundAction` carries a message/card reference — extend the daemon callback table and/or types so Telegram callback `message_id` is validated before `broker.resolve`.

  - [§10.4 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:555-568; packages/render/src/project-approval.ts:127-132; packages/core/test/phase2-e2e-approval-flow.test.ts:454-478] The attack table omits required Phase 3 cases: replay after daemon restart, expire-sweep vs click race, click-before-bind race, and renderer-defensive unknown snapshot — add T-Sec rows and daemon-level tests for each before implementation starts.

P1 (required changes before T1):
  - [§11 P3.T19 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:672-673; packages/daemon/src/supervisor.ts:133-158; packages/daemon/src/supervisor.ts:463-472] SIGTERM shutdown is under-specified, and current `Supervisor.stop()` detaches the close handler before `client.stop()`, so pending approvals are not marked `transport_lost` — make `Daemon.stop()` call `broker.failPendingAsTransportLost()` before supervisor teardown and test pending approval settlement.

  - [§7 D23 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:304-309] SessionRouter “async write-through” conflicts with restart-preserved bindings — binding writes must commit durably before `/use`/`/new` is acknowledged or before a turn depends on them.

  - [§16 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:818-822,836-845,856-867,876-885,892-909] Several “2–5 minute” tasks are multi-test chunks — split T2, T9, T13, T17, T19, T22, and T28 into one failing behavior each.

  - [§23 R5 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:1182-1186] The native SQLite mitigation is not real as written; `sqlite3` is not a pure-JS fallback — make T1 a hard install/load preflight and name a proven fallback before storage work proceeds.

  - [§16 T28 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:907-909; 06-IM-ADAPTERS.md:207-209] The grammY contract test is too abstract to catch real update-shape divergence — add raw Telegram/grammY update fixture tests for private, group, forum-topic, missing-message, and stale callback cases.

  - [§13.1 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:738-742; 07-SECURITY-AND-COMPUTER-USE.md:165-170] The launchd template risks writing the bot token into a plist — use an env-var name in config and a Keychain/env loader at daemon start; do not render the token into installed files.

P2 (nice-to-have):
  - [§5 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:218-232; docs/phase-2/codex-review-deferred.md:37-49] The plan still describes Phase 2 review as deferred, while the prompt says `phase-2-codex-reviewed` exists — refresh the snapshot and ensure the `.md` review outputs, not only `.stderr`, are present.

  - [§6 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:250-253] “No Telegram-specific code outside im-telegram” is too broad for config and docs — narrow it to no Telegram SDK/raw update types outside the adapter, with config allowed to contain adapter keys and env-var names.

  - [§13.1 / docs/superpowers/plans/2026-05-02-phase-3-plan.md:723-727] The launchd sample hardcodes `/usr/local/bin/node` and `/Users/mini` despite R7’s `$HOME` strategy — make the sample templated or omit concrete user paths.

NOTES:
  - Scope is directionally correct: PRD P0 requires Telegram, approvals, project bindings, and basic security (01-PRD.md:13-20), and Computer Use remains later (09-ROADMAP.md:206-226).
  - The architecture redlines are mostly honored on package boundaries; the main blockers are callback identity, binding order, and settlement semantics.
  - Phase 4/Lark prep is not over-scoped; it stays handoff-only.
