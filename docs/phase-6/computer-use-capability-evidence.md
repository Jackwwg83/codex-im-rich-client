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

## 6. JAC-274 Follow-Up Evidence

Generated: 2026-05-07

JAC-274 re-checked the current `codex-cli 0.128.0` generated protocol and live
smoke behavior before any real provider implementation.

Observed local protocol facts:

- `TurnStartParams` has no field for registering `DynamicToolSpec[]` or any
  Computer Use provider metadata with a turn.
- `ToolsV2` currently exposes only `web_search` and `view_image`.
- `DynamicToolSpec` exists in the generated protocol, but this repository has
  no verified `turn/start` or config surface that wires a daemon-provided
  desktop tool into Codex App Server.
- `codex app-server --help` exposes app-server transport / generation tooling,
  but no documented Computer Use provider registration command.

Observed smoke behavior:

```text
pnpm smoke:computer-use-live
-> status=skip, reason=set COMPUTER_USE_LIVE=1

COMPUTER_USE_LIVE=1 COMPUTER_USE_PROVIDER_VERIFIED=1 \
COMPUTER_USE_LIVE_DRY_RUN=1 COMPUTER_USE_LIVE_APP="Google Chrome" \
COMPUTER_USE_LIVE_TASK="summarize the visible local test page" \
pnpm smoke:computer-use-live
-> status=ready_dry_run, no desktop action executed
```

The non-dry-run path remains intentionally blocked with
`real desktop execution is not implemented in Phase 6 harness`.

JAC-274 therefore keeps the existing product behavior:

- `/cu` from IM creates an explicit, policy-gated Computer Use context.
- Dynamic `item/tool/call` still fails closed unless the session, tool, app, and
  policy gates all pass.
- Production uses `UnsupportedComputerUseProvider` until a current Codex App
  Server capability surface is proven.
- IM output projection of Computer Use-like `dynamicToolCall` items and local
  `inputImage` artifacts remains valid because it is downstream rendering, not
  provider execution.

Next evidence needed before any real provider:

1. A sanitized real App Server trace showing the namespace/tool/argument shape
   for local Computer Use, or official/local protocol evidence that no such
   daemon-facing provider registration exists in the current Codex pin.
2. A reviewed production path for the daemon to execute that provider without
   depending on the interactive Codex session's MCP tools or parsing UI/CLI
   output.
3. A bounded Chrome-only live smoke that returns redacted `DynamicToolCallResponse`
   content and, if screenshots are produced, sends them through the existing IM
   artifact path.
