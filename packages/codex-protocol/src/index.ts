// Facade: only named exports, never export *. See README.md.
//
// Phase 0 surface — only types consumed by the initialize handshake
// (Section H Task 7.1 `performInitializeHandshake`). Add a new export
// ONLY when a downstream package starts importing it; every new export
// is a deliberate code-review checkpoint.
//
// Phase 1 expansion (Pre-2 prerequisite, plan §0.4) — adds the
// discriminated unions and per-method types consumed by codex-runtime,
// core (ApprovalBroker), daemon, and cli for the runtime kernel work.
// Each new export was checked against
// packages/codex-protocol/src/generated/{index,v2/index}.ts before
// landing.
//
// Note on naming: ts-rs emits `InitializeResponse` (not `InitializeResult`
// as some older drafts of 05-PROTOCOL.md may suggest). The wire spike at
// docs/phase-0/host-environment.md confirms this is the canonical name.

// ─── Phase 0 (initialize handshake) ───────────────────────────────────
export type {
  ClientInfo,
  InitializeCapabilities,
  InitializeParams,
  InitializeResponse,
} from "./generated/index.js";

// ─── Phase 1 — discriminated unions used for type-level method dispatch
// (D7 in plan; Codex outside-voice B5/B6 require Record<…["method"]> tables)
export type {
  ClientNotification,
  ClientRequest,
  RequestId,
  ReviewDecision,
  ServerNotification,
  ServerRequest,
} from "./generated/index.js";

// ─── Phase 1 — legacy server-initiated approval params/responses
// (top-level in generated; not under v2/)
export type {
  ApplyPatchApprovalParams,
  ApplyPatchApprovalResponse,
  ExecCommandApprovalParams,
  ExecCommandApprovalResponse,
} from "./generated/index.js";

// ─── Phase 1 — v2 thread/turn/review request params + responses
// (consumed by CodexRuntime typed wrappers — plan T8 / TODOS P1.1)
export type {
  AppsListParams,
  AppsListResponse,
  GetAccountRateLimitsResponse,
  ListMcpServerStatusParams,
  ListMcpServerStatusResponse,
  McpServerOauthLoginParams,
  McpServerOauthLoginResponse,
  McpServerRefreshResponse,
  ModelListParams,
  ModelListResponse,
  ModelProviderCapabilitiesReadParams,
  ModelProviderCapabilitiesReadResponse,
  PluginListParams,
  PluginListResponse,
  ReviewStartParams,
  ReviewStartResponse,
  SkillsListParams,
  SkillsListResponse,
  ThreadCompactStartParams,
  ThreadCompactStartResponse,
  ThreadArchiveParams,
  ThreadArchiveResponse,
  ThreadForkParams,
  ThreadForkResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadSetNameParams,
  ThreadSetNameResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadTurnsListParams,
  ThreadTurnsListResponse,
  ThreadUnarchiveParams,
  ThreadUnarchiveResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
} from "./generated/v2/index.js";

// ─── Phase 1 — v2 server-initiated request params + responses
// (consumed by ApprovalBroker exhaustive dispatch table — plan T9a /
// TODOS P1.2; Codex B6 fix uses these per-method response shapes
// rather than assuming legacy { decision: ReviewDecision } applies)
export type {
  ChatgptAuthTokensRefreshParams,
  ChatgptAuthTokensRefreshResponse,
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  DynamicToolCallParams,
  DynamicToolCallResponse,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  McpServerElicitationRequestParams,
  McpServerElicitationRequestResponse,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
} from "./generated/v2/index.js";

// ─── Phase 1 — v2 notifications consumed by EventNormalizer
// (plan T7a/T7b / TODOS P1.3 — only the arms the runtime maps explicitly;
// other arms reach the runtime via the ServerNotification union and are
// handled either by classification table or unknown fall-open)
export type {
  AgentMessageDeltaNotification,
  CommandExecutionOutputDeltaNotification,
  ContextCompactedNotification,
  ErrorNotification,
  FileChangeOutputDeltaNotification,
  FileChangePatchUpdatedNotification,
  GuardianWarningNotification,
  ItemCompletedNotification,
  ItemStartedNotification,
  ModelReroutedNotification,
  ModelVerificationNotification,
  PlanDeltaNotification,
  ReasoningTextDeltaNotification,
  ServerRequestResolvedNotification,
  ThreadClosedNotification,
  ThreadStartedNotification,
  ThreadTokenUsageUpdatedNotification,
  TurnCompletedNotification,
  TurnDiffUpdatedNotification,
  TurnPlanUpdatedNotification,
  TurnStartedNotification,
} from "./generated/v2/index.js";
