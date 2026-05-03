import type { AuditEmitter } from "./audit.js";
import type { ComputerUseCommandResult } from "./computer-use-command.js";
import type { ComputerUsePolicyDecision } from "./computer-use-policy.js";
import { redact } from "./redact.js";

export type ComputerUseAuditEmitter = Pick<AuditEmitter, "emit">;

export type EmitComputerUseTriggerAuditOptions = {
  readonly audit: ComputerUseAuditEmitter;
  readonly intent: ComputerUseCommandResult;
  readonly context: {
    readonly targetKey: string;
    readonly actorKey: string;
    readonly projectId: string;
    readonly threadId?: string;
    readonly turnId?: string;
  };
  readonly policyDecision?: ComputerUsePolicyDecision;
  readonly decision?: "allow" | "deny";
  readonly reason?: string;
};

export function emitComputerUseTriggerAudit(opts: EmitComputerUseTriggerAuditOptions): void {
  opts.audit.emit({
    kind: "computer_use.intent_created",
    metadata: {
      action: opts.intent.action,
      targetKey: opts.context.targetKey,
      actorKey: opts.context.actorKey,
      projectId: opts.context.projectId,
      ...(opts.context.threadId === undefined ? {} : { threadId: opts.context.threadId }),
      ...(opts.context.turnId === undefined ? {} : { turnId: opts.context.turnId }),
      ...(opts.decision === undefined ? {} : { decision: opts.decision }),
      ...(opts.reason === undefined ? {} : { reason: opts.reason }),
      ...(opts.intent.action === "start" ? { task: redact(opts.intent.task) } : {}),
      ...(opts.policyDecision?.kind === "allow"
        ? {
            app: redact(opts.policyDecision.app),
            requiresApproval: opts.policyDecision.requiresApproval,
            approvalReasons: opts.policyDecision.approvalReasons,
          }
        : {}),
      ...(opts.policyDecision?.kind === "deny" ? { denyReason: opts.policyDecision.reason } : {}),
    },
  });
}
