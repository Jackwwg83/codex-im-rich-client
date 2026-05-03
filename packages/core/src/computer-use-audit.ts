import type { AuditEmitter } from "./audit.js";
import type { ComputerUseCommandResult } from "./computer-use-command.js";
import type { ComputerUsePolicyDecision } from "./computer-use-policy.js";
import { redact } from "./redact.js";

export type ComputerUseAuditEmitter = Pick<AuditEmitter, "emit">;

export type EmitComputerUseTriggerAuditOptions = {
  readonly audit: ComputerUseAuditEmitter;
  readonly intent: ComputerUseCommandResult;
  readonly policyDecision?: ComputerUsePolicyDecision;
};

export function emitComputerUseTriggerAudit(opts: EmitComputerUseTriggerAuditOptions): void {
  opts.audit.emit({
    kind: "computer_use.intent_created",
    metadata: {
      action: opts.intent.action,
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
