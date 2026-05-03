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

export interface WebApprovalDecisionInput {
  readonly broker: WebApprovalDecisionBroker;
  readonly operatorPolicy: TeamOperatorPolicy;
  readonly actor: TeamOperatorActor;
  readonly projectId: string;
  readonly target: Target;
  readonly messageRef?: DaemonMessageRef;
  readonly approvalId: string;
  readonly decision: ApprovalUiAction;
  readonly callbackNonce: string;
}

export type WebApprovalDecisionDenyReason =
  | "operator_policy_denied"
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
  const policyDecision = input.operatorPolicy.check({
    actor: input.actor,
    action: "resolve_approval",
    projectId: input.projectId,
    target: input.target,
  });
  if (policyDecision.kind === "deny") {
    return {
      kind: "deny",
      reason: "operator_policy_denied",
      policyReason: policyDecision.reason,
    };
  }

  if (input.messageRef === undefined || input.messageRef.messageId.length === 0) {
    return { kind: "deny", reason: "message_ref_required" };
  }
  if (!targetEqual(input.messageRef.target, input.target)) {
    return { kind: "deny", reason: "message_ref_target_mismatch" };
  }
  if (input.callbackNonce.length === 0) {
    return { kind: "deny", reason: "callback_nonce_required" };
  }

  const resolveInput: ResolveApprovalInput = {
    approvalId: input.approvalId,
    decision: input.decision,
    actor: input.actor,
    target: input.target,
    callbackNonce: input.callbackNonce,
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
