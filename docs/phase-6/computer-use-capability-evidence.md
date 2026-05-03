# Computer Use Capability Evidence

Generated: 2026-05-03
Status: JAC-163 evidence update - real provider capability not verified

## 1. Local Protocol Evidence

Current Codex pin: `0.128.0`.

Generated protocol contains:

- `ServerRequest` method `item/tool/call`.
- `DynamicToolCallParams`:
  - `threadId: string`
  - `turnId: string`
  - `callId: string`
  - `namespace: string | null`
  - `tool: string`
  - `arguments: JsonValue`
- `DynamicToolCallResponse`:
  - `contentItems: DynamicToolCallOutputContentItem[]`
  - `success: boolean`

Existing project behavior:

- `packages/core/src/approval-request-kind.ts` classifies `item/tool/call` as
  `tool_call`.
- `packages/core/src/approval-broker.ts` default-rejects `item/tool/call` as
  `{ contentItems: [], success: false }`.
- `packages/render/src/project-approval.ts` currently renders `tool_call` as a
  critical, decline-only Computer Use tool call.

## 2. JAC-163 Evidence Outcome

No controlled real Computer Use dynamic-tool trace was captured in JAC-163.
The implementation therefore records a blocker instead of guessing real
namespace/tool names or argument schemas.

Known local protocol shape remains:

- method: `item/tool/call`
- params: `DynamicToolCallParams`
- response: `DynamicToolCallResponse`

Unverified:

- real Computer Use `namespace`;
- real Computer Use `tool`;
- real argument object shape;
- whether argument payloads can contain screenshot references, visible browser
  text, URLs, form labels, or user-entered values;
- whether the local Codex App Computer Use capability is reachable from this
  daemon process.

JAC-163 implementation therefore lands only:

- broker-owned typed dynamic-tool registration API;
- `ComputerUseProvider` interface;
- `UnsupportedComputerUseProvider` fail-closed fallback;
- `FakeComputerUseProvider` for tests/fake smoke.

## 3. Unknowns To Resolve Before Real Provider

- Exact `namespace` and `tool` values emitted by Codex App Server for local
  Computer Use.
- Exact argument schema for those namespace/tool values.
- Redaction requirements for every argument field, including possible browser
  text, screenshot references, URLs, form labels, and user-entered values.
- Whether the local Codex App Computer Use plugin can be invoked from this
  daemon process, or whether it is only available inside the Codex App client.
- Whether screenshots or browser-visible text can appear in
  `DynamicToolCallParams.arguments`; if yes, what redaction is required before
  audit/Linear/GPT consultation.
- Whether real provider execution can be deterministic enough for a bounded
  Chrome-only smoke.

## 4. Current Decision

Do not implement a real desktop provider until the unknowns above are resolved
and reviewed.

The first implementation should introduce:

- fake provider for unit tests and fake smoke;
- unsupported provider as production fallback;
- policy/session gate before provider execution;
- audit and redaction around every allow/deny/provider result.

This lets Phase 6 implement the security-critical boundary without pretending a
real provider capability is already verified.

## 5. JAC-163 Exit Criteria

JAC-163 must produce one of these outcomes:

1. A controlled trace with observed namespace/tool names, argument schema,
   redaction requirements, and a documented safe path toward a reviewed real
   provider; or
2. A recorded blocker stating that real provider capability is not yet verified.

In either outcome, JAC-163 may still land fake and unsupported providers plus the
broker-owned typed dynamic-tool registration API. It must not land real desktop
control.
