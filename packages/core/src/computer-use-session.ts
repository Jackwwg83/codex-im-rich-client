import type { DynamicToolCallParams, DynamicToolCallResponse } from "@codex-im/protocol";
import type { AuditEmitter } from "./audit.js";
import type { ComputerUsePolicy } from "./computer-use-policy.js";
import type { ComputerUseProvider } from "./computer-use-provider.js";

export type ComputerUseSession = {
  readonly sessionId: string;
  readonly targetKey: string;
  readonly actorKey: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly app: string;
  readonly task: string;
  readonly expiresAt: Date;
};

export type ComputerUseSessionInput = Omit<ComputerUseSession, "expiresAt"> & {
  readonly ttlMs?: number;
  readonly now?: Date;
};

export type ComputerUseSessionMatchInput = {
  readonly targetKey: string;
  readonly actorKey: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly app: string;
  readonly now?: Date;
};

export type ComputerUseSessionMatchResult =
  | { readonly kind: "allow"; readonly session: ComputerUseSession }
  | {
      readonly kind: "deny";
      readonly reason:
        | "no_active_session"
        | "target_mismatch"
        | "actor_mismatch"
        | "turn_mismatch"
        | "app_mismatch"
        | "expired";
    };

const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;

export class ComputerUseSessionRegistry {
  readonly #sessionsByThread = new Map<string, ComputerUseSession>();

  start(input: ComputerUseSessionInput): ComputerUseSession {
    const now = input.now ?? new Date();
    const session = Object.freeze({
      sessionId: input.sessionId,
      targetKey: input.targetKey,
      actorKey: input.actorKey,
      projectId: input.projectId,
      threadId: input.threadId,
      turnId: input.turnId,
      app: input.app,
      task: input.task,
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_SESSION_TTL_MS)),
    });
    this.#sessionsByThread.set(input.threadId, session);
    return session;
  }

  clearThread(threadId: string): void {
    this.#sessionsByThread.delete(threadId);
  }

  match(input: ComputerUseSessionMatchInput): ComputerUseSessionMatchResult {
    const session = this.#sessionsByThread.get(input.threadId);
    if (session === undefined) {
      return { kind: "deny", reason: "no_active_session" };
    }
    if (input.now !== undefined && input.now.getTime() >= session.expiresAt.getTime()) {
      this.#sessionsByThread.delete(input.threadId);
      return { kind: "deny", reason: "expired" };
    }
    if (session.targetKey !== input.targetKey) {
      return { kind: "deny", reason: "target_mismatch" };
    }
    if (session.actorKey !== input.actorKey) {
      return { kind: "deny", reason: "actor_mismatch" };
    }
    if (session.turnId !== input.turnId) {
      return { kind: "deny", reason: "turn_mismatch" };
    }
    if (session.app.toLowerCase() !== input.app.trim().toLowerCase()) {
      return { kind: "deny", reason: "app_mismatch" };
    }
    return { kind: "allow", session };
  }
}

export type ComputerUseAllowedTool = {
  readonly namespace: string | null;
  readonly tool: string;
};

export type ComputerUseToolGateInput = {
  readonly targetKey: string;
  readonly actorKey: string;
  readonly app: string;
  readonly params: DynamicToolCallParams;
  readonly now?: Date;
};

export type ComputerUseToolGateOptions = {
  readonly registry: ComputerUseSessionRegistry;
  readonly policy: ComputerUsePolicy;
  readonly provider: ComputerUseProvider;
  readonly audit?: Pick<AuditEmitter, "emit">;
  readonly allowedTools: readonly ComputerUseAllowedTool[];
};

export const COMPUTER_USE_SENSITIVE_STEP_ACTIONS = Object.freeze([
  "allow_once",
  "decline",
] as const);

export class ComputerUseToolGate {
  readonly #registry: ComputerUseSessionRegistry;
  readonly #policy: ComputerUsePolicy;
  readonly #provider: ComputerUseProvider;
  readonly #audit: Pick<AuditEmitter, "emit"> | undefined;
  readonly #allowedTools: readonly ComputerUseAllowedTool[];

  constructor(opts: ComputerUseToolGateOptions) {
    this.#registry = opts.registry;
    this.#policy = opts.policy;
    this.#provider = opts.provider;
    this.#audit = opts.audit;
    this.#allowedTools = opts.allowedTools;
  }

  async handle(input: ComputerUseToolGateInput): Promise<DynamicToolCallResponse> {
    const sessionMatch = this.#registry.match({
      targetKey: input.targetKey,
      actorKey: input.actorKey,
      threadId: input.params.threadId,
      turnId: input.params.turnId,
      app: input.app,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    if (sessionMatch.kind === "deny") {
      this.#auditDeny(sessionMatch.reason, input);
      return failClosed();
    }

    if (!this.#toolAllowed(input.params)) {
      this.#auditDeny("tool_not_allowed", input);
      return failClosed();
    }

    const policyDecision = this.#policy.check({
      app: input.app,
      task: `${sessionMatch.session.task} ${JSON.stringify(input.params.arguments)}`,
    });
    if (policyDecision.kind === "deny") {
      this.#auditDeny(policyDecision.reason, input);
      return failClosed();
    }
    if (policyDecision.requiresApproval) {
      this.#audit?.emit({
        kind: "computer_use.sensitive_step_blocked",
        metadata: {
          app: input.app,
          callId: input.params.callId,
          reasons: policyDecision.approvalReasons,
        },
      });
      return failClosed();
    }

    const response = await this.#provider.execute({ app: input.app, params: input.params });
    this.#audit?.emit({
      kind: "computer_use.tool_executed",
      metadata: {
        app: input.app,
        callId: input.params.callId,
        success: response.success,
      },
    });
    return response;
  }

  #toolAllowed(params: DynamicToolCallParams): boolean {
    return this.#allowedTools.some(
      (allowed) => allowed.namespace === params.namespace && allowed.tool === params.tool,
    );
  }

  #auditDeny(reason: string, input: ComputerUseToolGateInput): void {
    this.#audit?.emit({
      kind: "computer_use.tool_denied",
      metadata: {
        reason,
        app: input.app,
        callId: input.params.callId,
        namespace: input.params.namespace,
        tool: input.params.tool,
      },
    });
  }
}

function failClosed(): DynamicToolCallResponse {
  return { contentItems: [], success: false };
}
