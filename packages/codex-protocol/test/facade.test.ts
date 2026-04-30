// Facade contract test for @codex-im/protocol.
//
// Pre-2 prerequisite (plan §0.4): every export from src/index.ts is a
// deliberate code-review checkpoint. This test imports each Phase 1
// export and uses it in a type-level context, so:
//
//  1. Removing an export from src/index.ts (without coordinated removal
//     here) breaks typecheck — preventing accidental facade shrinkage.
//  2. Renaming a generated arm out from under us breaks typecheck —
//     surfacing protocol drift at facade-test time, not deep inside
//     a runtime consumer.
//
// The test asserts nothing at runtime; the value comes from the type
// system. Vitest still requires at least one expect() call, hence the
// trivial sentinel below.
import { describe, expect, it } from "vitest";
import type {
  AgentMessageDeltaNotification,
  ApplyPatchApprovalParams,
  ApplyPatchApprovalResponse,
  ChatgptAuthTokensRefreshParams,
  ChatgptAuthTokensRefreshResponse,
  ClientInfo,
  ClientNotification,
  ClientRequest,
  CommandExecutionOutputDeltaNotification,
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  ContextCompactedNotification,
  DynamicToolCallParams,
  DynamicToolCallResponse,
  ErrorNotification,
  ExecCommandApprovalParams,
  ExecCommandApprovalResponse,
  FileChangeOutputDeltaNotification,
  FileChangePatchUpdatedNotification,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  GuardianWarningNotification,
  InitializeCapabilities,
  InitializeParams,
  InitializeResponse,
  ItemCompletedNotification,
  ItemStartedNotification,
  McpServerElicitationRequestParams,
  McpServerElicitationRequestResponse,
  ModelReroutedNotification,
  ModelVerificationNotification,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  PlanDeltaNotification,
  ReasoningTextDeltaNotification,
  RequestId,
  ReviewDecision,
  ReviewStartParams,
  ReviewStartResponse,
  ServerNotification,
  ServerRequest,
  ServerRequestResolvedNotification,
  ThreadClosedNotification,
  ThreadForkParams,
  ThreadForkResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadStartedNotification,
  ThreadTokenUsageUpdatedNotification,
  ThreadTurnsListParams,
  ThreadTurnsListResponse,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
  TurnCompletedNotification,
  TurnDiffUpdatedNotification,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnPlanUpdatedNotification,
  TurnStartParams,
  TurnStartResponse,
  TurnStartedNotification,
  TurnSteerParams,
  TurnSteerResponse,
} from "../src/index.js";

describe("@codex-im/protocol facade contract (Pre-2)", () => {
  it("exports the discriminated unions Phase 1 depends on", () => {
    // Type-level only — these references force TS to resolve each name.
    type _DiscriminatedUnions = [
      ServerRequest,
      ServerNotification,
      ClientRequest,
      ClientNotification,
    ];
    type _IdentityAndDecision = [RequestId, ReviewDecision];
    type _Initialize = [ClientInfo, InitializeCapabilities, InitializeParams, InitializeResponse];

    // Sentinel runtime assertion so vitest registers the test as run.
    const exportsResolveAtCompileTime = true;
    expect(exportsResolveAtCompileTime).toBe(true);

    // Suppress "unused type alias" linter complaint; these aliases ARE
    // the test — their presence proves the imports type-resolved.
    const _u: undefined = undefined;
    void _u as unknown as _DiscriminatedUnions | _IdentityAndDecision | _Initialize;
  });

  it("ServerRequest['method'] is a discriminated string union of the 9 known method names", () => {
    // Compile-time partial enumeration. If the generated union loses a
    // method name we use, this fails to typecheck.
    const methodNames: ReadonlySet<ServerRequest["method"]> = new Set<ServerRequest["method"]>([
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
      "item/tool/requestUserInput",
      "item/tool/call",
      "mcpServer/elicitation/request",
      "applyPatchApproval",
      "execCommandApproval",
      "account/chatgptAuthTokens/refresh",
    ]);
    expect(methodNames.size).toBe(9);
  });

  it("exports per-method legacy approval params/responses", () => {
    type _Legacy = [
      ApplyPatchApprovalParams,
      ApplyPatchApprovalResponse,
      ExecCommandApprovalParams,
      ExecCommandApprovalResponse,
    ];
    expect(true).toBe(true);
    void undefined as unknown as _Legacy;
  });

  it("exports per-method v2 thread/turn/review request types (CodexRuntime T8)", () => {
    type _ThreadTurn = [
      ThreadStartParams,
      ThreadStartResponse,
      ThreadResumeParams,
      ThreadResumeResponse,
      ThreadForkParams,
      ThreadForkResponse,
      ThreadTurnsListParams,
      ThreadTurnsListResponse,
      ThreadReadParams,
      ThreadReadResponse,
      TurnStartParams,
      TurnStartResponse,
      TurnSteerParams,
      TurnSteerResponse,
      TurnInterruptParams,
      TurnInterruptResponse,
      ReviewStartParams,
      ReviewStartResponse,
    ];
    expect(true).toBe(true);
    void undefined as unknown as _ThreadTurn;
  });

  it("exports per-method v2 server-initiated request types (ApprovalBroker T9a)", () => {
    type _ServerReq = [
      CommandExecutionRequestApprovalParams,
      CommandExecutionRequestApprovalResponse,
      FileChangeRequestApprovalParams,
      FileChangeRequestApprovalResponse,
      PermissionsRequestApprovalParams,
      PermissionsRequestApprovalResponse,
      ToolRequestUserInputParams,
      ToolRequestUserInputResponse,
      DynamicToolCallParams,
      DynamicToolCallResponse,
      McpServerElicitationRequestParams,
      McpServerElicitationRequestResponse,
      ChatgptAuthTokensRefreshParams,
      ChatgptAuthTokensRefreshResponse,
    ];
    expect(true).toBe(true);
    void undefined as unknown as _ServerReq;
  });

  it("exports per-method v2 notifications consumed by EventNormalizer (T7a/T7b)", () => {
    type _Notif = [
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
    ];
    expect(true).toBe(true);
    void undefined as unknown as _Notif;
  });
});
