# Phase 4 Plan v1.1 Review Response

Generated: 2026-05-02
Review: `docs/internal/phase-4/plan-v1.1-codex-review.md`
Verdict: APPROVE_WITH_CHANGES

## Summary

Codex found no P0 blockers and five P1 plan-hardening items. All P1 items are absorbed in `docs/internal/superpowers/plans/2026-05-02-phase-4-lark-plan.md` and `docs/internal/phase-4/lark-action-transport-decision.md`.

## P1 Closure

| Finding | Closure |
|---|---|
| T0 must record exact app/domain/callback setting before card/action work | T0 now requires domain, app type, developer-console callback subscription setting, `card.action.trigger` long-connection enablement, and original messageRef availability before T6/T8. |
| Lark action `messageRef` rules too loose | Plan now requires original card/message `MessageRef`; missing, ambiguous, synthesized, or non-original refs fail closed before broker resolution. |
| Ack semantics missing | Plan now states Lark ack means platform-event received only; user-visible success/failure is daemon-owned, and replay/stale/wrong-message/wrong-chat/expired/malformed/broker-error paths fail closed. |
| Callback payload extraction constraints missing | Plan now accepts only exact `v1:<opaque-token>` Phase 3 `wirePayload`; rejects raw approval ids, action enums, actor ids, target tuples, JSON payloads, and legacy shapes. |
| Linear slicing missing T7 and T8 too broad | Proposed child issues now include Phase4-T7 and split T8a/T8b/T8c. |

## P2 Closure

- Redaction wording now includes `tenant_key`, `open_id`, `union_id`, and `message_id`.
- T6/T7 now require payload-size and update-rate assumptions to be pinned by tests/constants.
- T11 live smoke is explicitly non-blocking for tag if credentials are unavailable and fake smoke plus operator docs are complete.

## Remaining Gate

JAC-65 may close after the updated plan is committed and Linear child issues are created/updated. T1-T5 may begin after JAC-65 closes. T6/T8 remain blocked until T0 target verification is recorded.
