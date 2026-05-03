import type {
  ApprovalUiAction,
  ResolveApprovalInput,
  ResolveApprovalResult,
  Target,
  TeamOperatorActor,
  TeamOperatorDenyReason,
  TeamOperatorPolicy,
} from "@codex-im/core";
import type { DaemonMessageRef } from "./daemon.js";

export interface WebApprovalDecisionBroker {
  resolve(input: ResolveApprovalInput): ResolveApprovalResult | Promise<ResolveApprovalResult>;
}

export interface WebApprovalBoundApproval {
  readonly approvalId: string;
  readonly target: Target;
  readonly messageRef?: DaemonMessageRef;
  readonly callbackNonce: string;
}

export interface WebApprovalDecisionInput {
  readonly broker: WebApprovalDecisionBroker;
  readonly operatorPolicy: TeamOperatorPolicy;
  readonly actor: TeamOperatorActor;
  readonly projectId: string;
  /**
   * Server-side binding record for the approval card being resolved.
   * UI/request payloads must not be treated as proof of messageRef,
   * target, approvalId, or callbackNonce.
   */
  readonly boundApproval?: WebApprovalBoundApproval;
  readonly decision: ApprovalUiAction;
}

export type WebApprovalDecisionDenyReason =
  | "operator_policy_denied"
  | "bound_approval_required"
  | "approval_id_required"
  | "message_ref_required"
  | "message_ref_target_mismatch"
  | "callback_nonce_required";

export type WebApprovalDecisionResult =
  | {
      readonly kind: "deny";
      readonly reason: "operator_policy_denied";
      readonly policyReason: TeamOperatorDenyReason;
    }
  | {
      readonly kind: "deny";
      readonly reason: Exclude<WebApprovalDecisionDenyReason, "operator_policy_denied">;
    }
  | { readonly kind: "resolved"; readonly result: ResolveApprovalResult };

export async function resolveWebApprovalDecision(
  input: WebApprovalDecisionInput,
): Promise<WebApprovalDecisionResult> {
  const boundApproval = input.boundApproval;
  if (boundApproval === undefined) {
    return { kind: "deny", reason: "bound_approval_required" };
  }

  const policyDecision = input.operatorPolicy.check({
    actor: input.actor,
    action: "resolve_approval",
    projectId: input.projectId,
    target: boundApproval.target,
  });
  if (policyDecision.kind === "deny") {
    return {
      kind: "deny",
      reason: "operator_policy_denied",
      policyReason: policyDecision.reason,
    };
  }

  if (boundApproval.approvalId.length === 0) {
    return { kind: "deny", reason: "approval_id_required" };
  }
  if (boundApproval.messageRef === undefined || boundApproval.messageRef.messageId.length === 0) {
    return { kind: "deny", reason: "message_ref_required" };
  }
  if (!targetEqual(boundApproval.messageRef.target, boundApproval.target)) {
    return { kind: "deny", reason: "message_ref_target_mismatch" };
  }
  if (boundApproval.callbackNonce.length === 0) {
    return { kind: "deny", reason: "callback_nonce_required" };
  }

  const resolveInput: ResolveApprovalInput = {
    approvalId: boundApproval.approvalId,
    decision: input.decision,
    actor: input.actor,
    target: boundApproval.target,
    callbackNonce: boundApproval.callbackNonce,
  };
  return { kind: "resolved", result: await input.broker.resolve(resolveInput) };
}

function targetEqual(a: Target, b: Target): boolean {
  return (
    a.platform === b.platform &&
    a.chatId === b.chatId &&
    a.threadKey === b.threadKey &&
    a.topicId === b.topicId
  );
}
