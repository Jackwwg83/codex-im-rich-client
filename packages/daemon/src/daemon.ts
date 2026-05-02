import { randomBytes, randomUUID } from "node:crypto";
import {
  type ActorPolicy,
  type ApprovalActor,
  type BindResult,
  type IMRoutableApprovalMethod,
  IM_ROUTABLE_APPROVAL_METHODS,
  type PendingApprovalSnapshot,
  type ResolveApprovalInput,
  type ResolveApprovalResult,
  type SecurityPolicyApprovalDestinationDecision,
  type Target,
} from "@codex-im/core";
import { type ApprovalCard, projectApprovalCard } from "@codex-im/render";
import {
  type CallbackTokenAction,
  type CallbackTokenCasFields,
  type CallbackTokenInsert,
  type CallbackTokenRecord,
  type CallbackTokenStatus,
  hashCallbackToken,
} from "@codex-im/storage-sqlite";

type MaybePromise<T> = T | Promise<T>;
type Unsubscribe = () => void;
type CleanupMethod = () => MaybePromise<void>;
export type DaemonSignal = "SIGINT" | "SIGTERM";
const CALLBACK_TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CALLBACK_TOKEN_WIRE_RE = /^v1:([A-Z2-7]{16})$/;
const CALLBACK_TOKEN_FAIL_MESSAGES: Partial<Record<CallbackTokenStatus, string>> = {
  expired: "expired",
  revoked: "stale token",
  used: "already resolved",
  issued: "binding not ready",
};

export interface DaemonBroker {
  attach(): void;
  enablePendingMode(method: IMRoutableApprovalMethod): void;
  bindActorPolicy?(approvalId: string, policy: ActorPolicy): BindResult;
  resolve?(input: ResolveApprovalInput): MaybePromise<ResolveApprovalResult>;
  onPendingCreated?(handler: (snapshot: PendingApprovalSnapshot) => void): Unsubscribe;
}

export interface DaemonBrokerContext {
  readonly config: unknown;
  readonly storage: unknown;
}

export interface DaemonDependencyContext extends DaemonBrokerContext {
  readonly broker: DaemonBroker | undefined;
}

export interface DaemonSessionRouterContext extends DaemonDependencyContext {
  readonly securityPolicy: unknown;
}

export interface DaemonSupervisorContext extends DaemonSessionRouterContext {
  readonly sessionRouter: unknown;
}

export interface DaemonAdapterContext extends DaemonSupervisorContext {
  readonly supervisor: unknown;
}

export interface DaemonAdapter {
  onAction(handler: (action: unknown) => void): Unsubscribe;
  onMessage(handler: (message: unknown) => void): Unsubscribe;
  answerAction?(callbackHandle: string, ack: DaemonActionAck): MaybePromise<void>;
  sendCard?(target: Target, card: ApprovalCard): MaybePromise<DaemonSendCardResult>;
  start?(): MaybePromise<void>;
  stop?(): MaybePromise<void>;
}

export interface DaemonApprovalDestinationPolicy {
  checkApprovalDestination(
    snapshot: PendingApprovalSnapshot,
    target: Target,
  ): SecurityPolicyApprovalDestinationDecision;
}

export interface DaemonCallbackTokenRepository {
  insert(input: CallbackTokenInsert): CallbackTokenRecord | unknown;
  findByHash?(tokenHash: string): CallbackTokenRecord | unknown;
  casUpdate?(
    tokenHash: string,
    fromStatus: CallbackTokenStatus,
    toStatus: CallbackTokenStatus,
    fields?: CallbackTokenCasFields,
  ): CallbackTokenRecord | unknown;
}

export interface DaemonActionAck {
  readonly ok: boolean;
  readonly userMessage: string;
}

export interface DaemonIssuedCallbackToken {
  readonly action: CallbackTokenAction;
  readonly rawToken: string;
  readonly tokenHash: string;
}

export interface DaemonIssuedCallbackTokenBatch {
  readonly callbackNonce: string;
  readonly tokens: readonly DaemonIssuedCallbackToken[];
}

export interface DaemonMessageRef {
  readonly target: Target;
  readonly messageId: string;
}

export interface DaemonSendCardResult {
  readonly messageRef: DaemonMessageRef;
  readonly callbackNonce: string;
}

export interface DaemonOptions {
  readonly loadConfig?: () => MaybePromise<unknown>;
  readonly openStorage?: (config: unknown) => MaybePromise<unknown>;
  readonly createBroker?: (ctx: DaemonBrokerContext) => MaybePromise<DaemonBroker>;
  readonly createSecurityPolicy?: (ctx: DaemonDependencyContext) => MaybePromise<unknown>;
  readonly createSessionRouter?: (ctx: DaemonSessionRouterContext) => MaybePromise<unknown>;
  readonly createSupervisor?: (ctx: DaemonSupervisorContext) => MaybePromise<unknown>;
  readonly createAdapter?: (ctx: DaemonAdapterContext) => MaybePromise<DaemonAdapter>;
  readonly registerSignalHandler?: (signal: DaemonSignal, handler: () => void) => Unsubscribe;
  readonly resolveApprovalTarget?: (
    snapshot: PendingApprovalSnapshot,
  ) => MaybePromise<Target | null | undefined>;
  readonly resolveApprovalActions?: (
    snapshot: PendingApprovalSnapshot,
  ) => MaybePromise<readonly CallbackTokenAction[]>;
  readonly resolveApprovalAllowedActors?: (
    snapshot: PendingApprovalSnapshot,
    target: Target,
  ) => MaybePromise<readonly NonNullable<ApprovalActor>[]>;
  readonly callbackTokenRepository?: DaemonCallbackTokenRepository;
  readonly renderApprovalCard?: (snapshot: PendingApprovalSnapshot) => ApprovalCard;
  readonly onApprovalCardReady?: (target: Target, card: ApprovalCard) => MaybePromise<void>;
  readonly generateCallbackNonce?: () => string;
  readonly generateRawCallbackToken?: () => string;
  readonly now?: () => Date;
}

export class Daemon {
  readonly options: DaemonOptions;
  #started = false;
  #config: unknown;
  #storage: unknown;
  #broker: DaemonBroker | undefined;
  #securityPolicy: unknown;
  #sessionRouter: unknown;
  #supervisor: unknown;
  #adapter: DaemonAdapter | undefined;
  readonly #unsubscribers: Unsubscribe[] = [];

  constructor(options: DaemonOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }

    try {
      this.#config = await this.options.loadConfig?.();
      this.#storage = await this.options.openStorage?.(this.#config);
      this.#broker = await this.options.createBroker?.({
        config: this.#config,
        storage: this.#storage,
      });
      this.#broker?.attach();
      for (const method of IM_ROUTABLE_APPROVAL_METHODS) {
        this.#broker?.enablePendingMode(method);
      }
      const dependencyContext: DaemonDependencyContext = {
        config: this.#config,
        storage: this.#storage,
        broker: this.#broker,
      };
      this.#securityPolicy = await this.options.createSecurityPolicy?.(dependencyContext);
      this.#sessionRouter = await this.options.createSessionRouter?.({
        ...dependencyContext,
        securityPolicy: this.#securityPolicy,
      });
      this.#supervisor = await this.options.createSupervisor?.({
        ...dependencyContext,
        securityPolicy: this.#securityPolicy,
        sessionRouter: this.#sessionRouter,
      });
      const adapterContext: DaemonAdapterContext = {
        ...dependencyContext,
        securityPolicy: this.#securityPolicy,
        sessionRouter: this.#sessionRouter,
        supervisor: this.#supervisor,
      };
      this.#adapter = await this.options.createAdapter?.(adapterContext);
      this.#subscribe(
        this.#broker?.onPendingCreated?.((snapshot) => {
          void this.#handlePendingCreated(snapshot);
        }),
      );
      this.#subscribe(this.#adapter?.onAction((action) => this.#handleAction(action)));
      this.#subscribe(this.#adapter?.onMessage((message) => this.#handleMessage(message)));
      this.#subscribe(this.options.registerSignalHandler?.("SIGTERM", () => this.#handleSignal()));
      this.#subscribe(this.options.registerSignalHandler?.("SIGINT", () => this.#handleSignal()));
      await this.#adapter?.start?.();
      this.#started = true;
    } catch (error) {
      await this.#cleanupPartialStart();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.#started = false;
  }

  isStarted(): boolean {
    return this.#started;
  }

  #subscribe(unsubscribe: Unsubscribe | undefined): void {
    if (unsubscribe !== undefined) {
      this.#unsubscribers.push(unsubscribe);
    }
  }

  async #cleanupPartialStart(): Promise<void> {
    this.#started = false;
    const unsubscribers = this.#unsubscribers.splice(0).reverse();
    for (const unsubscribe of unsubscribers) {
      this.#runSyncCleanup(unsubscribe);
    }

    await this.#runAsyncCleanup(this.#cleanupMethod(this.#adapter, "stop"));
    await this.#runAsyncCleanup(this.#cleanupMethod(this.#supervisor, "stop"));
    await this.#runAsyncCleanup(this.#cleanupMethod(this.#storage, "close"));

    this.#adapter = undefined;
    this.#supervisor = undefined;
    this.#sessionRouter = undefined;
    this.#securityPolicy = undefined;
    this.#broker = undefined;
    this.#storage = undefined;
    this.#config = undefined;
  }

  #runSyncCleanup(cleanup: CleanupMethod): void {
    try {
      void cleanup();
    } catch {
      // Best-effort rollback must not hide the original startup failure.
    }
  }

  async #runAsyncCleanup(cleanup: CleanupMethod | undefined): Promise<void> {
    if (cleanup === undefined) {
      return;
    }
    try {
      await cleanup();
    } catch {
      // Best-effort rollback must not hide the original startup failure.
    }
  }

  #cleanupMethod(value: unknown, methodName: "close" | "stop"): CleanupMethod | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }

    const method = (value as Record<"close" | "stop", unknown>)[methodName];
    if (typeof method !== "function") {
      return undefined;
    }

    return () => (method as CleanupMethod).call(value);
  }

  async #handlePendingCreated(snapshot: PendingApprovalSnapshot): Promise<void> {
    try {
      const target = await this.options.resolveApprovalTarget?.(snapshot);
      if (target === undefined || target === null) {
        return;
      }

      const policy = this.#approvalDestinationPolicy(this.#securityPolicy);
      const decision = policy?.checkApprovalDestination(snapshot, target);
      if (decision?.kind !== "auto_decline") {
        if (decision?.kind === "allow") {
          const baseCard =
            this.options.renderApprovalCard?.(snapshot) ?? projectApprovalCard(snapshot);
          const actions = await this.#approvalActions(snapshot, baseCard);
          const issued = await this.#issueCallbackTokens(snapshot, target, actions);
          if (issued === undefined) {
            return;
          }
          const allowedActors = await this.options.resolveApprovalAllowedActors?.(snapshot, target);
          if (allowedActors === undefined || allowedActors.length === 0) {
            return;
          }
          this.#broker?.bindActorPolicy?.(snapshot.id, {
            allowedActors,
            target,
            callbackNonce: issued.callbackNonce,
          });
          const card = this.#withWirePayloadTokens(baseCard, issued.tokens);
          await this.options.onApprovalCardReady?.(target, card);
          const sendResult = await this.#adapter?.sendCard?.(target, card);
          if (sendResult !== undefined) {
            this.#bindIssuedCallbackTokens(issued.tokens, sendResult.messageRef);
          }
        }
        return;
      }

      const actor = { kind: "system", reason: "policy_auto_decline" } as const;
      const callbackNonce = this.options.generateCallbackNonce?.() ?? randomUUID();
      const bindResult = this.#broker?.bindActorPolicy?.(snapshot.id, {
        allowedActors: [actor],
        target,
        callbackNonce,
      });
      if (bindResult?.kind !== "ok") {
        return;
      }

      await this.#broker?.resolve?.({
        approvalId: snapshot.id,
        decision: { kind: "decline" },
        actor,
        target,
        callbackNonce,
      });
    } catch {
      // Pending-created subscribers must not destabilize the broker.
    }
  }

  async #issueCallbackTokens(
    snapshot: PendingApprovalSnapshot,
    target: Target,
    actions: readonly CallbackTokenAction[],
  ): Promise<DaemonIssuedCallbackTokenBatch | undefined> {
    const repository = this.options.callbackTokenRepository;
    if (repository === undefined || actions.length === 0) {
      return undefined;
    }

    const callbackNonce = this.options.generateCallbackNonce?.() ?? randomUUID();
    const createdAt = (this.options.now?.() ?? new Date()).toISOString();
    const expiresAt = snapshot.expiresAt.toISOString();
    const issued: DaemonIssuedCallbackToken[] = [];
    for (const action of actions) {
      const rawToken = this.options.generateRawCallbackToken?.() ?? generateRawCallbackToken();
      const tokenHash = hashCallbackToken(rawToken);
      repository.insert({
        tokenHash,
        approvalId: snapshot.id,
        action,
        callbackNonce,
        target,
        actor: { kind: "im" },
        status: "issued",
        createdAt,
        expiresAt,
      });
      issued.push({ action, rawToken, tokenHash });
    }
    return { callbackNonce, tokens: issued };
  }

  #handleAction(action: unknown): void {
    void this.#handleInboundAction(action);
  }

  #handleMessage(_message: unknown): void {}

  #handleSignal(): void {
    void this.stop();
  }

  #bindIssuedCallbackTokens(
    issuedTokens: readonly DaemonIssuedCallbackToken[],
    messageRef: DaemonMessageRef,
  ): void {
    const repository = this.options.callbackTokenRepository;
    for (const token of issuedTokens) {
      repository?.casUpdate?.(token.tokenHash, "issued", "bound", {
        messageRef: { chatId: messageRef.target.chatId, messageId: messageRef.messageId },
      });
    }
  }

  async #handleInboundAction(action: unknown): Promise<void> {
    const inbound = this.#inboundAction(action);
    if (inbound === undefined) {
      return;
    }

    const rawToken = this.#decodeRawCallbackToken(inbound.rawCallbackData);
    if (rawToken === undefined) {
      await this.#answerAction(inbound.callbackHandle, "stale or unknown");
      return;
    }

    const record = this.options.callbackTokenRepository?.findByHash?.(hashCallbackToken(rawToken));
    const status = this.#callbackTokenStatus(record);
    if (status === undefined) {
      await this.#answerAction(inbound.callbackHandle, "stale or unknown");
      return;
    }
    if (status !== "bound") {
      await this.#answerAction(
        inbound.callbackHandle,
        CALLBACK_TOKEN_FAIL_MESSAGES[status] ?? "stale or unknown",
      );
    }
  }

  async #answerAction(callbackHandle: string, userMessage: string): Promise<void> {
    await this.#adapter?.answerAction?.(callbackHandle, { ok: false, userMessage });
  }

  #decodeRawCallbackToken(rawCallbackData: string): string | undefined {
    return CALLBACK_TOKEN_WIRE_RE.exec(rawCallbackData)?.[1];
  }

  #callbackTokenStatus(record: unknown): CallbackTokenStatus | undefined {
    if (typeof record !== "object" || record === null) {
      return undefined;
    }
    const status = (record as Partial<CallbackTokenRecord>).status;
    return status === "issued" ||
      status === "bound" ||
      status === "used" ||
      status === "expired" ||
      status === "revoked"
      ? status
      : undefined;
  }

  async #approvalActions(
    snapshot: PendingApprovalSnapshot,
    card: ApprovalCard,
  ): Promise<readonly CallbackTokenAction[]> {
    return (
      this.options.resolveApprovalActions?.(snapshot) ?? card.actions.map((action) => action.kind)
    );
  }

  #withWirePayloadTokens(
    card: ApprovalCard,
    issuedTokens: readonly DaemonIssuedCallbackToken[],
  ): ApprovalCard {
    const tokenByAction = new Map(issuedTokens.map((token) => [token.action, token.rawToken]));
    return {
      ...card,
      actions: card.actions.map((action) => {
        const rawToken = tokenByAction.get(action.kind);
        return rawToken === undefined ? action : { ...action, wirePayload: `v1:${rawToken}` };
      }),
    };
  }

  #approvalDestinationPolicy(value: unknown): DaemonApprovalDestinationPolicy | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    if (
      typeof (value as Partial<DaemonApprovalDestinationPolicy>).checkApprovalDestination !==
      "function"
    ) {
      return undefined;
    }
    return value as DaemonApprovalDestinationPolicy;
  }

  #inboundAction(action: unknown): { rawCallbackData: string; callbackHandle: string } | undefined {
    if (typeof action !== "object" || action === null) {
      return undefined;
    }
    const partial = action as Partial<{ rawCallbackData: unknown; callbackHandle: unknown }>;
    if (typeof partial.rawCallbackData !== "string" || typeof partial.callbackHandle !== "string") {
      return undefined;
    }
    return { rawCallbackData: partial.rawCallbackData, callbackHandle: partial.callbackHandle };
  }
}

function generateRawCallbackToken(): string {
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CALLBACK_TOKEN_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.slice(0, 16);
}
