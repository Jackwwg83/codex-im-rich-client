# Codex outside-voice review — Phase 2 T18–T22 (DEFERRED BACKFILL)

You are an independent reviewer running the deferred backfill review for
Phase 2 T18-T22. The implementer's local Codex CLI was hung when these
landed (2026-05-02); the implementation tag `phase-2-approval-im-surface-complete`
was applied at `0fa0c94` with explicit deferral note. This review is
the backfill.

## Scope (these commits / files)

Commits (most recent first):
- d452391 T22 — Supervisor pre-attached-broker invariant (D16 / Codex Q6)
- 0a121e2 T21 — full e2e (P2.10) — 14 paths + secondary-index stress + bounds
- 27c3c76 T20 — method-literal grep guard scope extension (gstack A3 / R2 + C1)
- acea679 T19 — ChannelAdapter (D14) + TelegramShapeFakeChannelAdapter (D17 / Codex P2)
- a08cc81 T18 — channel-core skeleton + types + boundary tests (F13)

Production files:
- packages/channel-core/package.json + tsconfig.json
- packages/channel-core/src/{index.ts, types.ts, capabilities.ts, adapter.ts, fake.ts}
- packages/daemon/src/supervisor.ts (T22 head-of-#spawnFresh assertion)
- packages/core/test/no-method-literals.test.ts (T20 mechanism replacement + scope extension + decision-mapper assertion)
- packages/codex-runtime/test/no-raw-client-request.test.ts (T20 mechanism replacement + scope extension)

Test files (validate behavior, not for finding bugs):
- packages/channel-core/test/{types,capabilities,no-broker-import,no-protocol-import,fake-adapter-roundtrip,fake-adapter-callback-bounds,fake-adapter-callback-deadline}.test.ts
- packages/daemon/test/supervisor-pre-attached-broker.test.ts
- packages/core/test/phase2-e2e-{rig,approval-flow,secondary-index,callback-bounds}.test.ts (rig is .ts, not .test.ts)

## Plan reference

docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md
- §2.1 file structure (channel-core)
- §3 module boundaries (F1 method-literal, F13 channel-core boundary)
- §5 task bodies T18 through T22
- D14 closed ChannelAdapter
- D16 Supervisor pre-attached-broker invariant + Codex Q6
- D17 / Codex P2 TelegramShapeFakeChannelAdapter
- C-P1 renderer-defensive unknown-snapshot

Already-verified-GO upstream reviews (do NOT re-flag findings from these):
- T7-T12 broker public surface: GO after fix arc `231f653`
- T13-T17 render package: GO after fix arc `7f6b6a1`

## Look hard for

P0 (would block tag promotion `0.1.0-phase2-draft` → `0.1.0-phase2`):
1. F13 boundary breach — any runtime import of @codex-im/core,
   @codex-im/codex-runtime, or @codex-im/app-server-client from
   channel-core src.
2. F1 boundary breach — any of the 9 ServerRequest method strings
   appearing in render or channel-core src (or anywhere outside
   approval-broker.ts + approval-request-kind.ts).
3. T19 fake adapter does NOT enforce callback_data ≤62B synchronously,
   OR enforces it incorrectly (silent coercion, off-by-one, wrong
   measurement).
4. T19 fake adapter answerCallbackQuery deadline is wrong (off-by-one
   on the 60s comparison; > vs >=).
5. T22 supervisor invariant fires AFTER any side effect (transport
   construction, etc.) — should be the very first statement.
6. T22 invariant message is missing the "production = Supervisor;
   runtime-send = dev/operator only" reference (Codex Q6).
7. T20 grep guard scope is missing render/ or channel-core/, OR allows
   decision-mapper.ts to contain method literals.
8. T21 e2e fixtures don't actually contain bad-payload (Telegram bot
   token + abs path + AWS-key shape) AND/OR audit redaction assertion
   is weak (doesn't check the full audit JSON for raw bad-payload
   strings).
9. T21 secondary-index stress test (Codex missing #6) doesn't actually
   stress concurrently — N=1 or sequential disguised as concurrent.

P1 (composition issues that per-task review missed):
- How T22 invariant interacts with Phase 1 supervisor cleanup (the
  Phase 1 test was updated; verify the cleanup contract still holds
  for OTHER spawn-failure paths, not just unattached broker).
- Whether the e2e rig's daemon-wireup function correctly handles the
  `disableAutoBind` test option without leaking state across tests.
- TelegramShapeFakeChannelAdapter's `_messageIdSeq` is module-scoped;
  does test isolation suffer if tests mutate global state implicitly?
- Channel-core `Target` type duplicates core's `Target` shape verbatim
  — is the duplication documented? Will future shape drift between the
  two be detected by tests?

P2:
- Style nits, JSDoc gaps, comment correctness, test gaps.

## Out of scope

- T2-T17 (already reviewed and GO).
- Phase 3 work (im-telegram, daemon wire-up, SecurityPolicy ACL).
- The plan document itself (already polished through 3 round reviews).

## Output format (strict)

```
VERDICT: GO | GO_WITH_LOW_NITS | NO_GO
SUMMARY: <one sentence>

P0 (blocks 0.1.0-phase2-draft → 0.1.0-phase2 promotion):
  - [file:line] <issue> — <why P0> — <suggested fix>
  (or "none")

P1 (fix on a phase-2-review-nits branch before promotion):
  - [file:line] <issue> — <why P1> — <suggested fix>
  (or "none")

P2 (nice-to-have):
  - [file:line] <issue> — <suggested fix>
  (or "none")

NOTES:
  - <anything notable>
```

Read on disk; don't speculate. Cite line numbers from the working tree.
