import type { SessionBindingInput, SessionRoute } from "./session-router.js";
import type {
  TeamOperatorActor,
  TeamOperatorDenyReason,
  TeamOperatorPolicy,
} from "./team-operator-policy.js";
import type { Target } from "./types.js";

type BoundSessionRoute = Extract<SessionRoute, { readonly kind: "bound" }>;

export interface SessionHandoffRouter {
  resolve(target: Target): SessionRoute;
  bind?(target: Target, input: SessionBindingInput): SessionRoute;
}

export interface SessionHandoffInput {
  readonly router: SessionHandoffRouter;
  readonly operatorPolicy: TeamOperatorPolicy;
  readonly actor: TeamOperatorActor;
  readonly fromTarget: Target;
  readonly toTarget: Target;
}

export type SessionHandoffDenyReason =
  | "same_target"
  | "source_unbound"
  | "source_policy_denied"
  | "destination_policy_denied"
  | "destination_already_bound"
  | "binding_unavailable";

export type SessionHandoffResult =
  | { readonly kind: "bound"; readonly route: BoundSessionRoute }
  | {
      readonly kind: "deny";
      readonly reason: "source_policy_denied" | "destination_policy_denied";
      readonly policyReason: TeamOperatorDenyReason;
    }
  | {
      readonly kind: "deny";
      readonly reason: Exclude<
        SessionHandoffDenyReason,
        "source_policy_denied" | "destination_policy_denied"
      >;
    };

export function handoffSession(input: SessionHandoffInput): SessionHandoffResult {
  if (targetEqual(input.fromTarget, input.toTarget)) {
    return { kind: "deny", reason: "same_target" };
  }

  const source = input.router.resolve(input.fromTarget);
  if (source.kind !== "bound") {
    return { kind: "deny", reason: "source_unbound" };
  }

  const sourcePolicy = input.operatorPolicy.check({
    actor: input.actor,
    action: "handoff_session",
    projectId: source.projectId,
    target: input.fromTarget,
  });
  if (sourcePolicy.kind === "deny") {
    return {
      kind: "deny",
      reason: "source_policy_denied",
      policyReason: sourcePolicy.reason,
    };
  }

  const destinationPolicy = input.operatorPolicy.check({
    actor: input.actor,
    action: "handoff_session",
    projectId: source.projectId,
    target: input.toTarget,
  });
  if (destinationPolicy.kind === "deny") {
    return {
      kind: "deny",
      reason: "destination_policy_denied",
      policyReason: destinationPolicy.reason,
    };
  }

  const existingDestination = input.router.resolve(input.toTarget);
  if (existingDestination.kind === "bound") {
    if (sameBinding(source, existingDestination)) {
      return { kind: "bound", route: existingDestination };
    }
    return { kind: "deny", reason: "destination_already_bound" };
  }

  if (input.router.bind === undefined) {
    return { kind: "deny", reason: "binding_unavailable" };
  }

  const route = input.router.bind(input.toTarget, bindingFromRoute(source));
  if (route.kind !== "bound") {
    return { kind: "deny", reason: "binding_unavailable" };
  }
  return { kind: "bound", route };
}

function bindingFromRoute(route: BoundSessionRoute): SessionBindingInput {
  return {
    projectId: route.projectId,
    cwd: route.cwd,
    ...(route.codexThreadId !== undefined ? { codexThreadId: route.codexThreadId } : {}),
    ...(route.defaultModel !== undefined ? { defaultModel: route.defaultModel } : {}),
    ...(route.activeTurnId !== undefined ? { activeTurnId: route.activeTurnId } : {}),
  };
}

function sameBinding(a: BoundSessionRoute, b: BoundSessionRoute): boolean {
  return (
    a.projectId === b.projectId &&
    a.cwd === b.cwd &&
    a.codexThreadId === b.codexThreadId &&
    a.defaultModel === b.defaultModel &&
    a.activeTurnId === b.activeTurnId
  );
}

function targetEqual(a: Target, b: Target): boolean {
  return (
    a.platform === b.platform &&
    a.chatId === b.chatId &&
    a.threadKey === b.threadKey &&
    a.topicId === b.topicId
  );
}
