# Phase 5 Plan v1 Review Response

Generated: 2026-05-02

Review file: `docs/internal/phase-5/plan-v1-codex-review.md`
Verdict: `APPROVE_WITH_CHANGES`

## Findings Closed

| Finding | Response |
|---|---|
| P1 - JAC-89 only env-gated | Plan and live-status now mark JAC-89 as `OPERATOR_GATE + env-gated`. Default runs skip without network; the unattended loop must not set `DINGTALK_LIVE=1` itself. |
| P2 - JAC-83 looked safe before messageRef proof | Plan and live-status now restrict JAC-83 to codec/parser extraction and rejection tests only. No `InboundAction` emission or broker-resolving path may land before JAC-84 proves original-card `MessageRef`. |
| P2 - raw payload sanitization not explicit | Plan now requires a `sanitizeDingTalkRaw`-equivalent test target before message/action fixtures are complete. Adapter `raw` must be bounded and sanitized before crossing the `ChannelAdapter` boundary. |
| P2 - dedup identity not pinned | Target verification and task plan now require fixture evidence for Stream `headers.messageId`, robot `msgId`, card callback delivery/id field, and the chosen idempotency key per event class. |

## Implementation Gate

JAC-79 may start after gates pass because all P1/P2 plan-review findings have
been absorbed into the Phase 5 plan, live-status, and target verification docs.
