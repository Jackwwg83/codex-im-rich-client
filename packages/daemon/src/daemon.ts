import { randomBytes, randomUUID } from "node:crypto";
import {
  type ActorPolicy,
  type BindResult,
  type IMRoutableApprovalMethod,
  IM_ROUTABLE_APPROVAL_METHODS,
  type PendingApprovalSnapshot,
  type ResolveApprovalInput,
  type ResolveApprovalResult,
  type SecurityPolicyApprovalDestinationDecision,
  type Target,
} from "@codex-im/core";
import {
  type CallbackTokenAction,
  type CallbackTokenInsert,
  type CallbackTokenRecord,
  hashCallbackToken,
} from "@codex-im/storage-sqlite";

type MaybePromise<T> = T | Promise<T>;
type Unsubscribe = () => void;
type CleanupMethod = () => MaybePromise<void>;
export type DaemonSignal = "SIGINT" | "SIGTERM";
const CALLBACK_TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

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
  readonly callbackTokenRepository?: DaemonCallbackTokenRepository;
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
          await this.#issueCallbackTokens(snapshot, target);
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

  async #issueCallbackTokens(snapshot: PendingApprovalSnapshot, target: Target): Promise<void> {
    const repository = this.options.callbackTokenRepository;
    const actions = await this.options.resolveApprovalActions?.(snapshot);
    if (repository === undefined || actions === undefined || actions.length === 0) {
      return;
    }

    const callbackNonce = this.options.generateCallbackNonce?.() ?? randomUUID();
    const createdAt = (this.options.now?.() ?? new Date()).toISOString();
    const expiresAt = snapshot.expiresAt.toISOString();
    for (const action of actions) {
      const rawToken = this.options.generateRawCallbackToken?.() ?? generateRawCallbackToken();
      repository.insert({
        tokenHash: hashCallbackToken(rawToken),
        approvalId: snapshot.id,
        action,
        callbackNonce,
        target,
        actor: { kind: "im" },
        status: "issued",
        createdAt,
        expiresAt,
      });
    }
  }

  #handleAction(_action: unknown): void {}

  #handleMessage(_message: unknown): void {}

  #handleSignal(): void {
    void this.stop();
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
