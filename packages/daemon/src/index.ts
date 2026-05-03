// @codex-im/daemon — public surface (T11a skeleton).
//
// Phase 1 fills this in incrementally:
//   - T11a (this commit): Supervisor skeleton — owns transport spawn,
//     subscribes to transport.onClose, constructs the
//     {transport, client, runtime, broker} quartet on every spawn.
//   - T11b: close-handling edges — idempotence, exponential backoff,
//     halt-on-cascade, audit on fatal.
//
// Each new export is a deliberate code-review checkpoint, mirroring the
// facade rule from @codex-im/protocol.

export { Daemon } from "./daemon.js";
export { createDaemonLogger, planDaemonLogger } from "./logger.js";
export {
  planDaemonWebStatusConsole,
  renderDaemonWebStatusView,
  writeDaemonStatusSnapshot,
} from "./status.js";
export { resolveWebApprovalDecision } from "./web-approval.js";
export type {
  DaemonActionAck,
  DaemonAdapter,
  DaemonAdapterContext,
  DaemonApprovalDestinationPolicy,
  DaemonBroker,
  DaemonBrokerContext,
  DaemonCallbackTokenRepository,
  DaemonDependencyContext,
  DaemonIssuedCallbackToken,
  DaemonIssuedCallbackTokenBatch,
  DaemonMessageRef,
  DaemonOptions,
  DaemonSendCardResult,
  DaemonSignal,
  DaemonSessionRouterContext,
  DaemonSupervisorContext,
  DaemonUserChatPolicy,
} from "./daemon.js";
export type {
  DaemonLoggerOptions,
  DaemonLoggerPlan,
  DaemonLoggerPlanOptions,
  DaemonPinoFactory,
  DaemonPinoLoggerOptions,
  DaemonPinoRollTransportConfig,
  DaemonRotatingFileLoggerPlan,
  DaemonStdoutLoggerPlan,
  DaemonTransportFactory,
} from "./logger.js";
export type {
  DaemonStatusFatal,
  DaemonStatusSnapshot,
  DaemonStatusSnapshotIo,
  DaemonWebStatusConsoleOptions,
  DaemonWebStatusConsolePlan,
  DaemonWebStatusView,
  DaemonWebStatusViewOptions,
} from "./status.js";
export type {
  WebApprovalBoundApproval,
  WebApprovalDecisionBroker,
  WebApprovalDecisionDenyReason,
  WebApprovalDecisionInput,
  WebApprovalDecisionResult,
} from "./web-approval.js";
export { Supervisor } from "./supervisor.js";
export type { SupervisorAudit, SupervisorOptions } from "./types.js";
