import { randomBytes, randomUUID } from "node:crypto";
import type { CodexRichEvent } from "@codex-im/codex-runtime";
import {
  type ActorPolicy,
  type ApprovalActor,
  type ApprovalUiAction,
  type BindResult,
  type CommandRouterResult,
  type ComputerUseAllowedTool,
  type ComputerUseCommandResult,
  ComputerUsePolicy,
  type ComputerUsePolicyConfig,
  type ComputerUseProvider,
  ComputerUseSessionRegistry,
  ComputerUseToolGate,
  type DynamicToolCallHandler,
  type IMRoutableApprovalMethod,
  IM_ROUTABLE_APPROVAL_METHODS,
  type PendingApprovalSnapshot,
  type ResolveApprovalInput,
  type ResolveApprovalResult,
  type ResolveError,
  type SecurityPolicyApprovalDestinationDecision,
  type SecurityPolicyCommandDecision,
  type SecurityPolicyProjectDecision,
  type SecurityPolicySender,
  type SecurityPolicyUserChatDecision,
  type SessionBindingInput,
  type SessionRoute,
  SessionRouter,
  type Target,
  UnsupportedComputerUseProvider,
  classifyApprovalRequest,
  redact,
  routeInboundCommand,
  wrapComputerUsePrompt,
} from "@codex-im/core";
import { type ApprovalCard, projectApprovalCard } from "@codex-im/render";
import {
  type AuditInsert,
  BindingRepository,
  type CallbackTokenAction,
  type CallbackTokenCasFields,
  type CallbackTokenInsert,
  type CallbackTokenRecord,
  type CallbackTokenStatus,
  type DatabaseHandle,
  hashCallbackToken,
} from "@codex-im/storage-sqlite";
import { type DaemonStatusSnapshot, writeDaemonStatusSnapshot } from "./status.js";

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
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;
const DEFAULT_TERMINAL_RECORD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TERMINAL_RECORD_MAX_COUNT = 10_000;
const DEFAULT_PRUNE_BATCH_SIZE = 100;
const DEFAULT_STUCK_ISSUED_GRACE_MS = 5_000;
const DEFAULT_BIND_RETRY_DELAYS_MS = [50, 150, 350] as const;
const DEFAULT_COMPUTER_USE_ALLOWED_TOOLS = Object.freeze([
  { namespace: null, tool: "computer_use.synthetic" },
] as const satisfies readonly ComputerUseAllowedTool[]);
const EAGER_PRUNE_RATIO = 0.8;
const MAX_IM_TEXT_CHARS = 3_800;

export interface DaemonBroker {
  attach(): void;
  enablePendingMode(method: IMRoutableApprovalMethod): void;
  registerDynamicToolCallHandler?(handler: DynamicToolCallHandler): void;
  bindActorPolicy?(approvalId: string, policy: ActorPolicy): BindResult;
  resolve?(input: ResolveApprovalInput): MaybePromise<ResolveApprovalResult>;
  onPendingCreated?(handler: (snapshot: PendingApprovalSnapshot) => void): Unsubscribe;
  failPendingAsTransportLost?(): void;
  failPendingApprovalAsTransportLost?(approvalId: string): void;
  expirePending?(maxAgeMs?: number): number;
  pruneTerminalRecords?(options: DaemonPruneTerminalRecordsOptions): number;
  listPending?(): readonly PendingApprovalSnapshot[];
  approvalRecordCount?(): number;
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
  pauseInbound?(): MaybePromise<void>;
  answerAction?(callbackHandle: string, ack: DaemonActionAck): MaybePromise<void>;
  sendCard?(target: Target, card: ApprovalCard): MaybePromise<DaemonSendCardResult>;
  updateCard?(ref: DaemonMessageRef, card: ApprovalCard): MaybePromise<void>;
  editText?(ref: DaemonMessageRef, body: string): MaybePromise<void>;
  sendText?(target: Target, body: string): MaybePromise<DaemonMessageRef>;
  start?(): MaybePromise<void>;
  stop?(): MaybePromise<void>;
}

export interface DaemonApprovalDestinationPolicy {
  checkApprovalDestination(
    snapshot: PendingApprovalSnapshot,
    target: Target,
  ): SecurityPolicyApprovalDestinationDecision;
}

export interface DaemonCommandPolicy {
  checkCommand(command: string, cwd: string): SecurityPolicyCommandDecision;
}

export interface DaemonProjectPolicy {
  checkProjectAccess(
    projectId: string,
    target: Target,
    sender: SecurityPolicySender,
  ): SecurityPolicyProjectDecision;
}

export interface DaemonAuditRepository {
  insertBestEffort(input: AuditInsert): unknown;
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
  forceMarkUsed?(tokenHash: string, fields?: CallbackTokenCasFields): CallbackTokenRecord | unknown;
  revokeBoundSiblings?(approvalId: string, exceptTokenHash: string): readonly CallbackTokenRecord[];
  revokeBound?(): readonly CallbackTokenRecord[];
  pruneExpired?(now: string, limit?: number): readonly CallbackTokenRecord[];
  revokeStuckIssued?(
    cutoff: string,
    approvalIds: readonly string[],
    limit?: number,
  ): readonly CallbackTokenRecord[];
}

export interface DaemonPruneTerminalRecordsOptions {
  readonly maxAgeMs: number;
  readonly maxCount: number;
  readonly batchSize: number;
  readonly now: Date;
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

export interface DaemonUserChatPolicy {
  checkUserAndChat(target: Target, sender: SecurityPolicySender): SecurityPolicyUserChatDecision;
}

interface DaemonSessionRouter {
  resolve(target: Target): SessionRoute;
  bind?(target: Target, input: SessionBindingInput): SessionRoute;
  bindThread?(target: Target, codexThreadId: string): SessionRoute;
}

interface DaemonTextInput {
  readonly type: "text";
  readonly text: string;
  readonly text_elements: [];
}

interface DaemonCodexRuntime {
  readonly events?: {
    events(): AsyncIterableIterator<CodexRichEvent>;
  };
  threadStart(params: DaemonThreadStartParams): MaybePromise<DaemonThreadStartResult>;
  turnStart(params: DaemonTurnStartParams): MaybePromise<DaemonTurnStartResult>;
  turnSteer(params: DaemonTurnSteerParams): MaybePromise<unknown>;
  turnInterrupt?(params: DaemonTurnInterruptParams): MaybePromise<unknown>;
}

interface DaemonRuntimeProvider {
  currentRuntime(): DaemonCodexRuntime | null | undefined;
}

interface DaemonTurnOutputState {
  readonly target: Target;
  readonly turnId: string;
  messageRef?: DaemonMessageRef;
  text: string;
}

interface DaemonProjectConfig {
  readonly cwd: string;
  readonly defaultModel?: string;
}

interface DaemonThreadStartParams {
  readonly cwd?: string | null;
  readonly model?: string | null;
}

interface DaemonThreadStartResult {
  readonly thread?: { readonly id?: string };
}

interface DaemonTurnStartParams {
  readonly threadId: string;
  readonly input: DaemonTextInput[];
  readonly cwd?: string | null;
  readonly model?: string | null;
}

interface DaemonTurnStartResult {
  readonly turn?: { readonly id?: string };
  readonly turnId?: string;
}

interface DaemonTurnSteerParams {
  readonly threadId: string;
  readonly input: DaemonTextInput[];
  readonly expectedTurnId: string;
}

interface DaemonTurnInterruptParams {
  readonly threadId: string;
  readonly turnId: string;
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
  readonly auditRepository?: DaemonAuditRepository;
  readonly computerUseProvider?: ComputerUseProvider;
  readonly computerUseAllowedTools?: readonly ComputerUseAllowedTool[];
  readonly renderApprovalCard?: (snapshot: PendingApprovalSnapshot) => ApprovalCard;
  readonly renderResolvedApprovalCard?: (record: CallbackTokenRecord) => ApprovalCard;
  readonly onApprovalCardReady?: (target: Target, card: ApprovalCard) => MaybePromise<void>;
  readonly generateAuditId?: () => string;
  readonly generateCallbackNonce?: () => string;
  readonly generateRawCallbackToken?: () => string;
  readonly generateComputerUseSessionId?: () => string;
  readonly schedulePrune?: (handler: () => void, intervalMs: number) => Unsubscribe | undefined;
  readonly pruneIntervalMs?: number;
  readonly terminalRecordMaxAgeMs?: number;
  readonly terminalRecordMaxCount?: number;
  readonly pruneBatchSize?: number;
  readonly stuckIssuedGraceMs?: number;
  readonly bindIssuedRetryDelaysMs?: readonly number[];
  readonly now?: () => Date;
  readonly statusPath?: string;
  readonly writeStatusSnapshot?: (snapshot: DaemonStatusSnapshot) => MaybePromise<void>;
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
  #computerUsePolicy: ComputerUsePolicy | undefined;
  #computerUseRegistry: ComputerUseSessionRegistry | undefined;
  #stopPromise: Promise<void> | undefined;
  #startedAt: Date | undefined;
  #lastFatal: { at: string; message: string } | undefined;
  #supervisorFailureCount = 0;
  #pruneInFlight = false;
  readonly #stuckIssuedApprovalIds = new Set<string>();
  readonly #transportLostStuckIssuedApprovalIds = new Set<string>();
  readonly #unsubscribers: Unsubscribe[] = [];
  readonly #runtimeEventPumps = new WeakSet<object>();
  readonly #turnOutputs = new Map<string, DaemonTurnOutputState>();

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
      this.#setupComputerUseToolGate();
      const dependencyContext: DaemonDependencyContext = {
        config: this.#config,
        storage: this.#storage,
        broker: this.#broker,
      };
      this.#securityPolicy = await this.options.createSecurityPolicy?.(dependencyContext);
      this.#sessionRouter =
        (await this.options.createSessionRouter?.({
          ...dependencyContext,
          securityPolicy: this.#securityPolicy,
        })) ?? this.#defaultSessionRouter(this.#storage);
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
      this.#revokeStartupCallbackTokens();
      this.#subscribe(
        this.#broker?.onPendingCreated?.((snapshot) => {
          this.#maybeTriggerEagerPrune();
          void this.#handlePendingCreated(snapshot);
        }),
      );
      this.#subscribe(this.#adapter?.onAction((action) => this.#handleAction(action)));
      this.#subscribe(this.#adapter?.onMessage((message) => this.#handleMessage(message)));
      this.#subscribe(this.options.registerSignalHandler?.("SIGTERM", () => this.#handleSignal()));
      this.#subscribe(this.options.registerSignalHandler?.("SIGINT", () => this.#handleSignal()));
      this.#subscribe(this.#schedulePruneSweep());
      await this.#adapter?.start?.();
      this.#startedAt = this.options.now?.() ?? new Date();
      this.#started = true;
      await this.#writeStatusSnapshot();
    } catch (error) {
      const now = this.options.now?.() ?? new Date();
      this.#lastFatal = { at: now.toISOString(), message: this.#errorMessage(error) };
      await this.#cleanupPartialStart();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.#started = false;
    if (this.#stopPromise !== undefined) {
      return this.#stopPromise;
    }

    this.#stopPromise = this.#stopOnce();
    try {
      await this.#stopPromise;
    } finally {
      this.#stopPromise = undefined;
    }
  }

  async #stopOnce(): Promise<void> {
    this.#started = false;
    await this.#runAsyncCleanup(this.#cleanupMethod(this.#adapter, "pauseInbound"));
    this.#runSyncCleanup(() => this.#broker?.failPendingAsTransportLost?.());
    await drainShutdown();
    await this.#runAsyncCleanup(this.#cleanupMethod(this.#supervisor, "stop"));
    await this.#runAsyncCleanup(this.#cleanupMethod(this.#adapter, "stop"));
    this.#unsubscribeAll();
    await this.#runAsyncCleanup(this.#cleanupMethod(this.#storage, "close"));

    this.#adapter = undefined;
    this.#supervisor = undefined;
    this.#sessionRouter = undefined;
    this.#securityPolicy = undefined;
    this.#broker = undefined;
    this.#computerUsePolicy = undefined;
    this.#computerUseRegistry = undefined;
    this.#storage = undefined;
    this.#config = undefined;
    this.#stuckIssuedApprovalIds.clear();
    this.#transportLostStuckIssuedApprovalIds.clear();
    this.#turnOutputs.clear();
  }

  isStarted(): boolean {
    return this.#started;
  }

  #subscribe(unsubscribe: Unsubscribe | undefined): void {
    if (unsubscribe !== undefined) {
      this.#unsubscribers.push(unsubscribe);
    }
  }

  #unsubscribeAll(): void {
    const unsubscribers = this.#unsubscribers.splice(0).reverse();
    for (const unsubscribe of unsubscribers) {
      this.#runSyncCleanup(unsubscribe);
    }
  }

  #setupComputerUseToolGate(): void {
    const registry = new ComputerUseSessionRegistry();
    const policyConfig = this.#computerUsePolicyConfig(this.#config);
    const policy =
      policyConfig === undefined ? new ComputerUsePolicy() : new ComputerUsePolicy(policyConfig);
    const audit = this.#computerUseAuditEmitter();
    const gate = new ComputerUseToolGate({
      registry,
      policy,
      provider: this.options.computerUseProvider ?? new UnsupportedComputerUseProvider({ audit }),
      audit,
      allowedTools: this.options.computerUseAllowedTools ?? DEFAULT_COMPUTER_USE_ALLOWED_TOOLS,
    });

    this.#computerUseRegistry = registry;
    this.#computerUsePolicy = policy;
    this.#broker?.registerDynamicToolCallHandler?.((req) =>
      gate.handleToolCall({ params: req.params }),
    );
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
    this.#computerUsePolicy = undefined;
    this.#computerUseRegistry = undefined;
    this.#storage = undefined;
    this.#config = undefined;
    this.#stuckIssuedApprovalIds.clear();
    this.#transportLostStuckIssuedApprovalIds.clear();
    this.#turnOutputs.clear();
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

  #cleanupMethod(
    value: unknown,
    methodName: "close" | "pauseInbound" | "stop",
  ): CleanupMethod | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }

    const method = (value as Record<"close" | "pauseInbound" | "stop", unknown>)[methodName];
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
          const commandDecision = this.#commandApprovalDecision(snapshot);
          if (commandDecision !== undefined && commandDecision.kind !== "allow") {
            await this.#autoDeclineApproval(
              snapshot,
              target,
              `security_policy_${commandDecision.reason}`,
            );
            return;
          }

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
            await this.#bindIssuedCallbackTokens(snapshot.id, issued.tokens, sendResult.messageRef);
          }
        }
        return;
      }

      await this.#autoDeclineApproval(snapshot, target, "policy_auto_decline");
    } catch {
      // Pending-created subscribers must not destabilize the broker.
    }
  }

  #revokeStartupCallbackTokens(): void {
    const records = this.options.callbackTokenRepository?.revokeBound?.() ?? [];
    for (const record of records) {
      this.#emitAuditEvent("approval.callback_startup_revoked", {
        approvalId: record.approvalId,
        target: record.target,
        result: "revoked",
      });
    }
  }

  async #autoDeclineApproval(
    snapshot: PendingApprovalSnapshot,
    target: Target,
    reason: string,
  ): Promise<void> {
    const actor = { kind: "system", reason } as const;
    const callbackNonce = this.options.generateCallbackNonce?.() ?? randomUUID();
    const bindResult = this.#broker?.bindActorPolicy?.(snapshot.id, {
      allowedActors: [actor],
      target,
      callbackNonce,
    });
    if (bindResult?.kind !== "ok") {
      return;
    }

    this.#emitAuditEvent("approval.policy_auto_decline", {
      approvalId: snapshot.id,
      target,
      result: reason,
      metadata: { reason },
    });
    await this.#broker?.resolve?.({
      approvalId: snapshot.id,
      decision: { kind: "decline" },
      actor,
      target,
      callbackNonce,
    });
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
    void this.#handleInboundAction(action).catch((error: unknown) => {
      this.#emitAuditEvent("approval.callback_handler_failed", {
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
    });
  }

  #handleMessage(message: unknown): void {
    void this.#handleInboundMessage(message);
  }

  async #handleInboundMessage(message: unknown): Promise<void> {
    try {
      const inbound = this.#inboundMessage(message);
      if (inbound === undefined) {
        return;
      }

      const policy = this.#userChatPolicy(this.#securityPolicy);
      if (policy?.checkUserAndChat(inbound.target, inbound.sender)?.kind !== "allow") {
        return;
      }

      const routed = routeInboundCommand(inbound.text);
      if (routed.kind === "prompt") {
        await this.#routePrompt(inbound, routed.text);
        return;
      }

      if (routed.kind === "command") {
        await this.#routeCommand(inbound, routed);
        return;
      }

      if (routed.kind === "computer_use") {
        await this.#routeComputerUse(inbound, routed);
        return;
      }

      if (routed.kind === "rejected") {
        await this.#editInboundMessage(inbound.messageRef, routed.message);
      }
    } catch {
      // Inbound message handling must fail closed without destabilizing daemon subscriptions.
    }
  }

  #handleSignal(): void {
    void this.stop();
  }

  async #bindIssuedCallbackTokens(
    approvalId: string,
    issuedTokens: readonly DaemonIssuedCallbackToken[],
    messageRef: DaemonMessageRef,
  ): Promise<void> {
    let failed = false;
    for (const token of issuedTokens) {
      const bound = await this.#bindIssuedCallbackToken(token.tokenHash, messageRef);
      failed ||= !bound;
    }
    if (failed) {
      this.#stuckIssuedApprovalIds.add(approvalId);
    }
  }

  async #bindIssuedCallbackToken(
    tokenHash: string,
    messageRef: DaemonMessageRef,
  ): Promise<boolean> {
    const repository = this.options.callbackTokenRepository;
    const fields = {
      messageRef: { chatId: messageRef.target.chatId, messageId: messageRef.messageId },
    };
    if (repository?.casUpdate?.(tokenHash, "issued", "bound", fields) !== undefined) {
      return true;
    }
    for (const delayMs of this.#bindIssuedRetryDelaysMs()) {
      await sleep(delayMs);
      if (repository?.casUpdate?.(tokenHash, "issued", "bound", fields) !== undefined) {
        return true;
      }
    }
    return false;
  }

  async #handleInboundAction(action: unknown): Promise<void> {
    const inbound = this.#inboundAction(action);
    if (inbound === undefined) {
      return;
    }

    const rawToken = this.#decodeRawCallbackToken(inbound.rawCallbackData);
    if (rawToken === undefined) {
      this.#emitAuditEvent("approval.callback_malformed", {
        result: "failed",
        metadata: { reason: "malformed_wire_payload" },
      });
      await this.#answerAction(inbound.callbackHandle, "stale or unknown");
      return;
    }

    const record = this.options.callbackTokenRepository?.findByHash?.(hashCallbackToken(rawToken));
    const status = this.#callbackTokenStatus(record);
    if (status === undefined) {
      this.#emitAuditEvent("approval.callback_unknown", {
        result: "failed",
        metadata: { tokenHash: hashCallbackToken(rawToken) },
      });
      await this.#answerAction(inbound.callbackHandle, "stale or unknown");
      return;
    }
    if (status !== "bound") {
      this.#emitAuditEvent("approval.callback_not_bound", {
        approvalId: this.#recordApprovalId(record),
        result: status,
      });
      await this.#answerAction(
        inbound.callbackHandle,
        CALLBACK_TOKEN_FAIL_MESSAGES[status] ?? "stale or unknown",
      );
      return;
    }

    const messageRefFailure = this.#messageRefFailure(record, inbound.messageRef);
    if (messageRefFailure !== undefined) {
      this.#emitAuditEvent(
        messageRefFailure.includes("cannot validate")
          ? "approval.message_ref_unknown"
          : "approval.message_ref_mismatch",
        {
          approvalId: this.#recordApprovalId(record),
          result: "failed",
          metadata: { reason: messageRefFailure },
        },
      );
      await this.#answerAction(inbound.callbackHandle, messageRefFailure);
      return;
    }

    const actor = this.#inboundActor(inbound);
    if (actor === undefined || inbound.target === undefined || inbound.sender === undefined) {
      this.#emitAuditEvent("approval.callback_unauthorized", {
        approvalId: this.#recordApprovalId(record),
        result: "failed",
        metadata: { reason: "missing_actor_target_or_sender" },
      });
      await this.#answerAction(inbound.callbackHandle, "unauthorized");
      return;
    }

    const policy = this.#userChatPolicy(this.#securityPolicy);
    if (policy?.checkUserAndChat(inbound.target, inbound.sender)?.kind !== "allow") {
      this.#emitAuditEvent("approval.callback_unauthorized", {
        approvalId: this.#recordApprovalId(record),
        target: inbound.target,
        result: "failed",
        metadata: { reason: "security_policy_denied" },
      });
      await this.#answerAction(inbound.callbackHandle, "unauthorized");
      return;
    }

    const resolvableRecord = this.#resolvableCallbackRecord(record);
    if (resolvableRecord === undefined) {
      this.#emitAuditEvent("approval.callback_unknown", {
        approvalId: this.#recordApprovalId(record),
        result: "failed",
        metadata: { reason: "record_not_resolvable" },
      });
      await this.#answerAction(inbound.callbackHandle, "stale or unknown");
      return;
    }

    if (!targetEqual(resolvableRecord.target, inbound.target)) {
      this.#emitAuditEvent("approval.callback_target_mismatch", {
        approvalId: resolvableRecord.approvalId,
        target: inbound.target,
        result: "failed",
      });
      await this.#answerAction(inbound.callbackHandle, "wrong target");
      return;
    }

    const result = await this.#broker?.resolve?.({
      approvalId: resolvableRecord.approvalId,
      decision: { kind: resolvableRecord.action } as ApprovalUiAction,
      actor,
      target: resolvableRecord.target,
      callbackNonce: resolvableRecord.callbackNonce,
    });
    if (result?.kind === "ok") {
      await this.#handleAcceptedCallback(inbound.callbackHandle, resolvableRecord, actor);
      return;
    }
    if (result?.kind === "error") {
      await this.#answerAction(inbound.callbackHandle, this.#resolveErrorMessage(result.error));
    }
  }

  async #handleAcceptedCallback(
    callbackHandle: string,
    record: CallbackTokenRecord,
    actor: NonNullable<ApprovalActor>,
  ): Promise<void> {
    const repository = this.options.callbackTokenRepository;
    const used = repository?.casUpdate?.(record.tokenHash, "bound", "used", { actor });
    if (used === undefined) {
      this.#emitAuditEvent("audit.cas_unreachable_after_resolve", {
        approvalId: record.approvalId,
        target: record.target,
        result: "forced_used",
        metadata: { tokenHash: record.tokenHash },
      });
      repository?.forceMarkUsed?.(record.tokenHash, { actor });
    }

    try {
      await this.#answerAction(callbackHandle, "decision recorded", true);
    } catch (error) {
      this.#emitAuditEvent("approval.callback_ack_failed", {
        approvalId: record.approvalId,
        target: record.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
    }
    const terminalCard = this.options.renderResolvedApprovalCard?.(record);
    if (terminalCard !== undefined && record.messageRef !== undefined) {
      try {
        await this.#adapter?.updateCard?.(
          { target: record.target, messageId: record.messageRef.messageId },
          terminalCard,
        );
      } catch (error) {
        this.#emitAuditEvent("approval.callback_update_failed", {
          approvalId: record.approvalId,
          target: record.target,
          result: "failed",
          metadata: { error: errorMessage(error) },
        });
      }
    }
    try {
      repository?.revokeBoundSiblings?.(record.approvalId, record.tokenHash);
    } catch (error) {
      this.#emitAuditEvent("approval.callback_sibling_revoke_failed", {
        approvalId: record.approvalId,
        target: record.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
    }
  }

  async #answerAction(callbackHandle: string, userMessage: string, ok = false): Promise<void> {
    await this.#adapter?.answerAction?.(callbackHandle, { ok, userMessage });
  }

  #emitAuditEvent(
    action: string,
    input: {
      readonly approvalId?: string | undefined;
      readonly target?: Target | undefined;
      readonly result?: string | undefined;
      readonly metadata?: Record<string, unknown> | undefined;
    } = {},
  ): void {
    const repository = this.options.auditRepository;
    if (repository === undefined) {
      return;
    }
    try {
      const metadataJson =
        input.metadata === undefined ? undefined : JSON.stringify(input.metadata);
      repository.insertBestEffort({
        id: this.options.generateAuditId?.() ?? randomUUID(),
        action,
        ...(input.target === undefined ? {} : { targetKey: targetKey(input.target) }),
        ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
        ...(input.result === undefined ? {} : { result: input.result }),
        ...(metadataJson === undefined ? {} : { metadataJson }),
        createdAt: (this.options.now?.() ?? new Date()).toISOString(),
      });
    } catch {
      // Daemon-level audit is best-effort and must not mutate control flow.
    }
  }

  #emitComputerUseAudit(
    action: string,
    input: {
      readonly inbound: { target: Target; sender: SecurityPolicySender };
      readonly route?: Extract<SessionRoute, { kind: "bound" }> | undefined;
      readonly intent?: ComputerUseCommandResult | undefined;
      readonly result?: string | undefined;
      readonly metadata?: Record<string, unknown> | undefined;
    },
  ): void {
    this.#emitAuditEvent(action, {
      target: input.inbound.target,
      result: input.result,
      metadata: {
        targetKey: targetKey(input.inbound.target),
        actorKey: actorKey(input.inbound.target, input.inbound.sender),
        ...(input.route === undefined ? {} : { projectId: input.route.projectId }),
        ...(input.intent === undefined ? {} : { intentAction: input.intent.action }),
        ...(input.intent?.action === "start" ? { task: redact(input.intent.task) } : {}),
        ...redactMetadata(input.metadata),
      },
    });
  }

  #computerUseAuditEmitter(): {
    emit: (event: { kind: string; metadata?: Record<string, unknown> }) => void;
  } {
    return {
      emit: (event) => {
        this.#emitAuditEvent(event.kind, { metadata: redactMetadata(event.metadata) });
      },
    };
  }

  #computerUseStatusText(policy: ComputerUsePolicy): string {
    const snapshot = policy.snapshot;
    const enabled = snapshot.enabled && snapshot.valid ? "enabled" : "disabled";
    const defaultApp = snapshot.defaultApp ?? "<none>";
    const allowedApps =
      snapshot.allowedApps.length === 0 ? "<none>" : snapshot.allowedApps.join(", ");
    return [
      `Computer Use: ${enabled}`,
      `Default app: ${defaultApp}`,
      `Allowed apps: ${allowedApps}`,
      `Live smoke: ${snapshot.liveSmokeEnabled ? "enabled" : "disabled"}`,
    ].join("\n");
  }

  #resolveErrorMessage(error: ResolveError): string {
    switch (error.kind) {
      case "wrong_actor":
        return "wrong actor";
      case "stale_callback":
        return "stale nonce";
      case "wrong_target":
        return "wrong target";
      case "expired":
        return "expired";
      case "transport_lost":
        return "codex restarted, retry";
      case "binding_required":
        return "internal: missing bind";
      case "already_resolved":
        return `already resolved (decision: ${error.priorDecision.kind})`;
      case "unsupported_decision":
        return "invalid action";
      case "unknown_approval_id":
        return "approval not found";
    }
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

  #messageRefFailure(
    record: unknown,
    messageRef: DaemonMessageRef | undefined,
  ): string | undefined {
    if (messageRef === undefined || messageRef.messageId === "<unknown>") {
      return "stale message (cannot validate)";
    }

    const recordMessageRef = this.#recordMessageRef(record);
    if (recordMessageRef === undefined) {
      return "stale message (cannot validate)";
    }

    return recordMessageRef.chatId === messageRef.target.chatId &&
      recordMessageRef.messageId === messageRef.messageId
      ? undefined
      : "stale message";
  }

  #recordMessageRef(record: unknown): { chatId: string; messageId: string } | undefined {
    if (typeof record !== "object" || record === null) {
      return undefined;
    }
    const messageRef = (record as Partial<CallbackTokenRecord>).messageRef;
    if (
      typeof messageRef !== "object" ||
      messageRef === null ||
      typeof messageRef.chatId !== "string" ||
      typeof messageRef.messageId !== "string"
    ) {
      return undefined;
    }
    return { chatId: messageRef.chatId, messageId: messageRef.messageId };
  }

  #recordApprovalId(record: unknown): string | undefined {
    if (typeof record !== "object" || record === null) {
      return undefined;
    }
    const approvalId = (record as Partial<CallbackTokenRecord>).approvalId;
    return typeof approvalId === "string" ? approvalId : undefined;
  }

  #resolvableCallbackRecord(record: unknown): CallbackTokenRecord | undefined {
    if (typeof record !== "object" || record === null) {
      return undefined;
    }
    const partial = record as Partial<CallbackTokenRecord>;
    if (
      typeof partial.tokenHash !== "string" ||
      typeof partial.approvalId !== "string" ||
      typeof partial.callbackNonce !== "string" ||
      partial.status !== "bound" ||
      !this.#isCallbackTokenAction(partial.action) ||
      this.#daemonTarget(partial.target) === undefined
    ) {
      return undefined;
    }
    return partial as CallbackTokenRecord;
  }

  #isCallbackTokenAction(action: unknown): action is CallbackTokenAction {
    return (
      action === "allow_once" ||
      action === "allow_session" ||
      action === "decline" ||
      action === "abort"
    );
  }

  async #approvalActions(
    snapshot: PendingApprovalSnapshot,
    card: ApprovalCard,
  ): Promise<readonly CallbackTokenAction[]> {
    return (
      this.options.resolveApprovalActions?.(snapshot) ?? card.actions.map((action) => action.kind)
    );
  }

  #commandApprovalDecision(
    snapshot: PendingApprovalSnapshot,
  ): SecurityPolicyCommandDecision | undefined {
    const kind = classifyApprovalRequest(snapshot.method);
    if (kind !== "command_execution" && kind !== "legacy_exec_command") {
      return undefined;
    }
    const command =
      readStringField(snapshot.params, "command") ??
      readStringField(snapshot.params, "commandLineExpanded") ??
      readStringField(snapshot.params, "commandLine");
    if (command === undefined) {
      return undefined;
    }
    const cwd =
      readStringField(snapshot.params, "cwd") ?? readStringField(snapshot.params, "workdir") ?? "";
    return this.#commandPolicy(this.#securityPolicy)?.checkCommand(command, cwd);
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

  #userChatPolicy(value: unknown): DaemonUserChatPolicy | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    if (typeof (value as Partial<DaemonUserChatPolicy>).checkUserAndChat !== "function") {
      return undefined;
    }
    return value as DaemonUserChatPolicy;
  }

  #commandPolicy(value: unknown): DaemonCommandPolicy | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    if (typeof (value as Partial<DaemonCommandPolicy>).checkCommand !== "function") {
      return undefined;
    }
    return value as DaemonCommandPolicy;
  }

  #projectPolicy(value: unknown): DaemonProjectPolicy | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    if (typeof (value as Partial<DaemonProjectPolicy>).checkProjectAccess !== "function") {
      return undefined;
    }
    return value as DaemonProjectPolicy;
  }

  #projectAllowed(projectId: string, target: Target, sender: SecurityPolicySender): boolean {
    const policy = this.#projectPolicy(this.#securityPolicy);
    return policy?.checkProjectAccess(projectId, target, sender).kind !== "deny";
  }

  async #routePrompt(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    text: string,
  ): Promise<void> {
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const runtime = this.#currentRuntime();
    if (sessionRouter === undefined || runtime === undefined) {
      return;
    }
    this.#ensureRuntimeEventPump(runtime);

    const initialRoute = sessionRouter.resolve(inbound.target);
    if (initialRoute.kind !== "bound") {
      return;
    }
    if (!this.#projectAllowed(initialRoute.projectId, inbound.target, inbound.sender)) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return;
    }

    const hadPersistedThread = initialRoute.codexThreadId !== undefined;
    let route = await this.#ensureBoundCodexThread(sessionRouter, runtime, inbound, initialRoute);
    if (route === undefined) {
      return;
    }

    const input = textInput(text);
    if (route.activeTurnId !== undefined) {
      await runtime.turnSteer({
        threadId: route.codexThreadId,
        input,
        expectedTurnId: route.activeTurnId,
      });
      return;
    }

    let startedTurn: DaemonTurnStartResult;
    try {
      startedTurn = await this.#startPromptTurn(runtime, route, input);
    } catch (error) {
      this.#emitAuditEvent("runtime.turn_start_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId: route.codexThreadId },
      });
      if (!hadPersistedThread) {
        await this.#editInboundMessage(inbound.messageRef, "Codex turn failed to start.");
        return;
      }
      const freshRoute = await this.#startFreshCodexThread(sessionRouter, runtime, inbound, route);
      if (freshRoute === undefined) {
        return;
      }
      try {
        startedTurn = await this.#startPromptTurn(runtime, freshRoute, input);
        route = freshRoute;
      } catch (retryError) {
        this.#emitAuditEvent("runtime.turn_start_retry_failed", {
          target: inbound.target,
          result: "failed",
          metadata: { error: errorMessage(retryError), threadId: freshRoute.codexThreadId },
        });
        await this.#editInboundMessage(inbound.messageRef, "Codex turn failed to start.");
        return;
      }
    }
    const activeTurnId = this.#turnId(startedTurn);
    if (activeTurnId !== undefined) {
      this.#bindActiveTurn(sessionRouter, route, activeTurnId);
      await this.#openTurnOutput(inbound.target, route.codexThreadId, activeTurnId);
    }
  }

  async #ensureBoundCodexThread(
    sessionRouter: DaemonSessionRouter,
    runtime: DaemonCodexRuntime,
    inbound: { target: Target; messageRef?: DaemonMessageRef },
    route: Extract<SessionRoute, { kind: "bound" }>,
  ): Promise<(Extract<SessionRoute, { kind: "bound" }> & { codexThreadId: string }) | undefined> {
    if (route.codexThreadId !== undefined) {
      return { ...route, codexThreadId: route.codexThreadId };
    }
    return await this.#startFreshCodexThread(sessionRouter, runtime, inbound, route);
  }

  async #startFreshCodexThread(
    sessionRouter: DaemonSessionRouter,
    runtime: DaemonCodexRuntime,
    inbound: { target: Target; messageRef?: DaemonMessageRef },
    route: Extract<SessionRoute, { kind: "bound" }>,
  ): Promise<(Extract<SessionRoute, { kind: "bound" }> & { codexThreadId: string }) | undefined> {
    try {
      const startedThread = await runtime.threadStart(this.#threadStartParams(route));
      const threadId = this.#threadId(startedThread);
      if (threadId === undefined || sessionRouter.bindThread === undefined) {
        await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to start.");
        return undefined;
      }
      const rebound = sessionRouter.bindThread(inbound.target, threadId);
      if (rebound.kind !== "bound" || rebound.codexThreadId === undefined) {
        await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to bind.");
        return undefined;
      }
      return { ...rebound, codexThreadId: rebound.codexThreadId };
    } catch (error) {
      this.#emitAuditEvent("runtime.thread_start_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to start.");
      return undefined;
    }
  }

  #startPromptTurn(
    runtime: DaemonCodexRuntime,
    route: Extract<SessionRoute, { kind: "bound" }> & { codexThreadId: string },
    input: DaemonTextInput[],
  ): Promise<DaemonTurnStartResult> {
    return Promise.resolve(
      runtime.turnStart({
        threadId: route.codexThreadId,
        input,
        cwd: route.cwd,
        ...(route.defaultModel === undefined ? {} : { model: route.defaultModel }),
      }),
    );
  }

  #ensureRuntimeEventPump(runtime: DaemonCodexRuntime): void {
    const events = runtime.events?.events;
    if (events === undefined || typeof events !== "function" || typeof runtime !== "object") {
      return;
    }
    if (this.#runtimeEventPumps.has(runtime)) {
      return;
    }
    this.#runtimeEventPumps.add(runtime);
    void this.#consumeRuntimeEvents(events.call(runtime.events)).catch((error: unknown) => {
      this.#emitAuditEvent("runtime.event_pump_failed", {
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
    });
  }

  async #consumeRuntimeEvents(events: AsyncIterable<CodexRichEvent>): Promise<void> {
    for await (const event of events) {
      await this.#handleRuntimeEvent(event);
    }
  }

  async #handleRuntimeEvent(event: CodexRichEvent): Promise<void> {
    if (event.type === "agent_message_delta") {
      const state = this.#turnOutputs.get(turnOutputKey(event.threadId, event.turnId));
      if (state !== undefined) {
        state.text = truncateImText(`${state.text}${event.deltaText}`);
      }
      return;
    }

    if (
      event.type !== "turn_completed" &&
      event.type !== "turn_failed" &&
      event.type !== "turn_interrupted"
    ) {
      return;
    }

    const key = turnOutputKey(event.threadId, event.turnId);
    const state = this.#turnOutputs.get(key);
    if (state === undefined) {
      return;
    }
    this.#turnOutputs.delete(key);
    this.#clearTerminalActiveTurn(state.target, event.threadId, event.turnId);
    await this.#editTurnOutput(state, this.#terminalTurnOutputBody(event, state.text));
  }

  #clearTerminalActiveTurn(target: Target, threadId: string, turnId: string): void {
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    if (sessionRouter?.bind === undefined) {
      return;
    }

    const route = sessionRouter.resolve(target);
    if (
      route.kind !== "bound" ||
      route.codexThreadId !== threadId ||
      route.activeTurnId !== turnId
    ) {
      return;
    }

    sessionRouter.bind(target, {
      projectId: route.projectId,
      cwd: route.cwd,
      codexThreadId: route.codexThreadId,
      ...(route.defaultModel === undefined ? {} : { defaultModel: route.defaultModel }),
    });
  }

  async #openTurnOutput(target: Target, threadId: string, turnId: string): Promise<void> {
    const state: DaemonTurnOutputState = { target, turnId, text: "" };
    this.#turnOutputs.set(turnOutputKey(threadId, turnId), state);
    if (this.#adapter?.sendText === undefined) {
      return;
    }
    try {
      state.messageRef = await this.#adapter.sendText(target, "Codex is working...");
    } catch (error) {
      this.#emitAuditEvent("runtime.turn_output_send_failed", {
        target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
    }
  }

  async #editTurnOutput(state: DaemonTurnOutputState, body: string): Promise<void> {
    if (state.messageRef === undefined || this.#adapter?.editText === undefined) {
      return;
    }
    try {
      await this.#adapter.editText(state.messageRef, body);
    } catch (error) {
      this.#emitAuditEvent("runtime.turn_output_edit_failed", {
        target: state.target,
        result: "failed",
        metadata: { error: errorMessage(error), turnId: state.turnId },
      });
    }
  }

  #terminalTurnOutputBody(event: CodexRichEvent, text: string): string {
    if (event.type === "turn_completed") {
      return text.length === 0 ? "Codex turn completed." : text;
    }
    if (event.type === "turn_interrupted") {
      return text.length === 0 ? "Codex turn interrupted." : `${text}\n\n[turn interrupted]`;
    }
    return text.length === 0 ? "Codex turn failed." : `${text}\n\n[turn failed]`;
  }

  async #routeComputerUse(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: ComputerUseCommandResult,
  ): Promise<void> {
    const policy = this.#computerUsePolicy ?? new ComputerUsePolicy();
    if (command.action === "status") {
      await this.#editInboundMessage(inbound.messageRef, this.#computerUseStatusText(policy));
      return;
    }

    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const runtime = this.#currentRuntime();
    const registry = this.#computerUseRegistry;
    if (sessionRouter === undefined || runtime === undefined || registry === undefined) {
      this.#emitComputerUseAudit("computer_use.intent_denied", {
        inbound,
        intent: command,
        result: "unavailable",
        metadata: { reason: "daemon_not_ready" },
      });
      return;
    }

    let route = sessionRouter.resolve(inbound.target);
    if (route.kind !== "bound") {
      this.#emitComputerUseAudit("computer_use.intent_denied", {
        inbound,
        intent: command,
        result: "unbound_target",
        metadata: { reason: "unbound_target" },
      });
      return;
    }
    if (!this.#projectAllowed(route.projectId, inbound.target, inbound.sender)) {
      this.#emitComputerUseAudit("computer_use.intent_denied", {
        inbound,
        route,
        intent: command,
        result: "project_denied",
        metadata: { reason: "project_denied" },
      });
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return;
    }

    const policyDecision = policy.check({ task: command.task });
    if (policyDecision.kind === "deny") {
      this.#emitComputerUseAudit("computer_use.intent_denied", {
        inbound,
        route,
        intent: command,
        result: policyDecision.reason,
        metadata: { reason: policyDecision.reason },
      });
      await this.#editInboundMessage(
        inbound.messageRef,
        `Computer Use denied: ${policyDecision.reason}`,
      );
      return;
    }
    if (policyDecision.requiresApproval) {
      this.#emitComputerUseAudit("computer_use.intent_denied", {
        inbound,
        route,
        intent: command,
        result: "sensitive_step_requires_approval",
        metadata: {
          reason: "sensitive_step_requires_approval",
          approvalReasons: policyDecision.approvalReasons,
        },
      });
      await this.#editInboundMessage(
        inbound.messageRef,
        "Computer Use stopped before a sensitive step; explicit sensitive-step approval is not enabled yet.",
      );
      return;
    }

    if (route.codexThreadId === undefined) {
      const startedThread = await runtime.threadStart(this.#threadStartParams(route));
      const threadId = this.#threadId(startedThread);
      if (threadId === undefined || sessionRouter.bindThread === undefined) {
        return;
      }
      route = sessionRouter.bindThread(inbound.target, threadId);
    }
    if (route.kind !== "bound" || route.codexThreadId === undefined) {
      return;
    }

    const wrapped = wrapComputerUsePrompt(command, policyDecision);
    const input = textInput(wrapped.prompt);
    let activeTurnId = route.activeTurnId;
    if (activeTurnId !== undefined) {
      await runtime.turnSteer({
        threadId: route.codexThreadId,
        input,
        expectedTurnId: activeTurnId,
      });
    } else {
      const startedTurn = await runtime.turnStart({
        threadId: route.codexThreadId,
        input,
        cwd: route.cwd,
        ...(route.defaultModel === undefined ? {} : { model: route.defaultModel }),
      });
      activeTurnId = this.#turnId(startedTurn);
      if (activeTurnId !== undefined) {
        this.#bindActiveTurn(sessionRouter, route, activeTurnId);
      }
    }
    if (activeTurnId === undefined) {
      return;
    }

    registry.start({
      sessionId: this.options.generateComputerUseSessionId?.() ?? randomUUID(),
      targetKey: targetKey(inbound.target),
      actorKey: actorKey(inbound.target, inbound.sender),
      projectId: route.projectId,
      threadId: route.codexThreadId,
      turnId: activeTurnId,
      app: policyDecision.app,
      task: command.task,
      now: this.options.now?.() ?? new Date(),
    });
    this.#emitComputerUseAudit("computer_use.intent_created", {
      inbound,
      route,
      intent: command,
      result: "allow",
      metadata: {
        decision: "allow",
        app: policyDecision.app,
        task: command.task,
        threadId: route.codexThreadId,
        turnId: activeTurnId,
      },
    });
    this.#emitComputerUseAudit("computer_use.prompt_wrapped", {
      inbound,
      route,
      intent: command,
      result: "wrapped",
      metadata: {
        app: wrapped.app,
        threadId: route.codexThreadId,
        turnId: activeTurnId,
      },
    });
  }

  async #routeCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    const blocked = this.#controlPlaneBlockMessage(inbound.target, command.name);
    if (blocked !== undefined) {
      await this.#editInboundMessage(inbound.messageRef, blocked);
      return;
    }

    if (command.name === "use") {
      await this.#routeUseCommand(inbound, command);
      return;
    }

    if (command.name === "stop") {
      await this.#routeStopCommand(inbound);
      return;
    }

    if (command.name === "new" || command.name === "switch" || command.name === "fork") {
      await this.#editInboundMessage(
        inbound.messageRef,
        `/${command.name} is not implemented yet.`,
      );
    }
  }

  #controlPlaneBlockMessage(target: Target, commandName: string): string | undefined {
    if (
      commandName !== "use" &&
      commandName !== "new" &&
      commandName !== "switch" &&
      commandName !== "fork"
    ) {
      return undefined;
    }

    const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(target);
    if (route?.kind === "bound" && route.activeTurnId !== undefined) {
      return "Cannot change project or thread while a Codex turn is active. Send /stop first or wait for it to finish.";
    }

    if (this.#pendingApprovalCount() > 0) {
      return "Cannot change project or thread while an approval is pending. Resolve or decline the approval first.";
    }

    return undefined;
  }

  #pendingApprovalCount(): number {
    const pending = this.#broker?.listPending?.();
    if (pending !== undefined) {
      return pending.length;
    }
    return this.#broker?.approvalRecordCount?.() ?? 0;
  }

  async #routeStopCommand(inbound: {
    target: Target;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const runtime = this.#currentRuntime();
    if (sessionRouter === undefined || runtime?.turnInterrupt === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex turn interrupt unavailable.");
      return;
    }

    const route = sessionRouter.resolve(inbound.target);
    if (
      route.kind !== "bound" ||
      route.codexThreadId === undefined ||
      route.activeTurnId === undefined
    ) {
      await this.#editInboundMessage(inbound.messageRef, "No active Codex turn.");
      return;
    }

    await runtime.turnInterrupt({
      threadId: route.codexThreadId,
      turnId: route.activeTurnId,
    });
    this.#clearTerminalActiveTurn(inbound.target, route.codexThreadId, route.activeTurnId);
    await this.#interruptTurnOutput(route.codexThreadId, route.activeTurnId);
  }

  async #interruptTurnOutput(threadId: string, turnId: string): Promise<void> {
    const key = turnOutputKey(threadId, turnId);
    const state = this.#turnOutputs.get(key);
    if (state === undefined) {
      return;
    }
    this.#turnOutputs.delete(key);
    await this.#editTurnOutput(
      state,
      this.#terminalTurnOutputBody(
        { type: "turn_interrupted", threadId, turnId, raw: {}, terminal: true },
        state.text,
      ),
    );
  }

  async #routeUseCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    const [projectId] = command.args;
    if (projectId === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Usage: /use <project>");
      return;
    }

    const project = this.#projectConfig(projectId);
    if (project === undefined) {
      await this.#editInboundMessage(inbound.messageRef, `Unknown project: ${projectId}`);
      return;
    }
    if (!this.#projectAllowed(projectId, inbound.target, inbound.sender)) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return;
    }

    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    if (sessionRouter?.bind === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Binding store unavailable");
      return;
    }

    try {
      sessionRouter.bind(inbound.target, {
        projectId,
        cwd: project.cwd,
        ...(project.defaultModel === undefined ? {} : { defaultModel: project.defaultModel }),
      });
    } catch {
      await this.#editInboundMessage(
        inbound.messageRef,
        `Failed to bind project ${projectId}: storage write failed`,
      );
      return;
    }

    await this.#editInboundMessage(inbound.messageRef, `Using project ${projectId}`);
  }

  async #editInboundMessage(messageRef: DaemonMessageRef | undefined, body: string): Promise<void> {
    if (messageRef === undefined) {
      return;
    }
    try {
      await this.#adapter?.editText?.(messageRef, body);
      return;
    } catch (error) {
      this.#emitAuditEvent("inbound.reply_edit_failed", {
        target: messageRef.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
    }

    if (this.#adapter?.sendText === undefined) {
      return;
    }
    try {
      await this.#adapter.sendText(messageRef.target, body);
    } catch (error) {
      this.#emitAuditEvent("inbound.reply_send_failed", {
        target: messageRef.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
    }
  }

  #schedulePruneSweep(): Unsubscribe | undefined {
    const intervalMs = this.#positiveInteger(
      this.options.pruneIntervalMs,
      DEFAULT_PRUNE_INTERVAL_MS,
    );
    const handler = () => this.#runPruneSweep();
    const scheduled = this.options.schedulePrune?.(handler, intervalMs);
    if (scheduled !== undefined) {
      return scheduled;
    }

    const timer = setInterval(handler, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  #maybeTriggerEagerPrune(): void {
    const maxCount = this.#nonNegativeInteger(
      this.options.terminalRecordMaxCount,
      DEFAULT_TERMINAL_RECORD_MAX_COUNT,
    );
    if (maxCount === 0) {
      this.#runPruneSweep();
      return;
    }
    const count = this.#broker?.approvalRecordCount?.();
    if (count !== undefined && count >= Math.floor(maxCount * EAGER_PRUNE_RATIO)) {
      this.#runPruneSweep();
    }
  }

  #runPruneSweep(): void {
    if (this.#pruneInFlight) {
      return;
    }
    this.#pruneInFlight = true;
    try {
      const now = this.options.now?.() ?? new Date();
      const batchSize = this.#positiveInteger(
        this.options.pruneBatchSize,
        DEFAULT_PRUNE_BATCH_SIZE,
      );

      this.options.callbackTokenRepository?.pruneExpired?.(now.toISOString(), batchSize);
      const flaggedApprovalIds = Array.from(this.#stuckIssuedApprovalIds);
      if (flaggedApprovalIds.length > 0) {
        const cutoff = new Date(
          now.getTime() -
            this.#positiveInteger(this.options.stuckIssuedGraceMs, DEFAULT_STUCK_ISSUED_GRACE_MS),
        ).toISOString();
        const revoked =
          this.options.callbackTokenRepository?.revokeStuckIssued?.(
            cutoff,
            flaggedApprovalIds,
            batchSize,
          ) ?? [];
        const revokedIds = new Set(revoked.map((record) => record.approvalId));
        for (const record of revoked) {
          if (!this.#transportLostStuckIssuedApprovalIds.has(record.approvalId)) {
            this.#broker?.failPendingApprovalAsTransportLost?.(record.approvalId);
            this.#transportLostStuckIssuedApprovalIds.add(record.approvalId);
          }
        }
        if (revoked.length === 0) {
          for (const approvalId of flaggedApprovalIds) {
            this.#stuckIssuedApprovalIds.delete(approvalId);
            this.#transportLostStuckIssuedApprovalIds.delete(approvalId);
          }
        } else if (revoked.length < batchSize) {
          for (const approvalId of flaggedApprovalIds) {
            if (!revokedIds.has(approvalId)) {
              this.#stuckIssuedApprovalIds.delete(approvalId);
              this.#transportLostStuckIssuedApprovalIds.delete(approvalId);
            }
          }
        }
      }

      this.#broker?.expirePending?.();
      this.#broker?.pruneTerminalRecords?.({
        maxAgeMs: this.#positiveInteger(
          this.options.terminalRecordMaxAgeMs,
          DEFAULT_TERMINAL_RECORD_MAX_AGE_MS,
        ),
        maxCount: this.#nonNegativeInteger(
          this.options.terminalRecordMaxCount,
          DEFAULT_TERMINAL_RECORD_MAX_COUNT,
        ),
        batchSize,
        now,
      });
    } catch (error) {
      this.#emitAuditEvent("approval.prune_sweep_failed", {
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
    } finally {
      this.#pruneInFlight = false;
    }
  }

  async #writeStatusSnapshot(): Promise<void> {
    const writer = this.options.writeStatusSnapshot ?? this.#statusPathWriter();
    if (writer === undefined) {
      return;
    }
    const now = this.options.now?.() ?? new Date();
    const startedAt = this.#startedAt ?? now;
    await writer({
      pid: process.pid,
      startedAt: startedAt.toISOString(),
      currentCodexThreadCount: this.#currentCodexThreadCount(),
      pendingApprovalCount: this.#broker?.approvalRecordCount?.() ?? 0,
      lastCodexSpawnAt: null,
      supervisorFailureCount: this.#supervisorFailureCount,
      lastFatal: this.#lastFatal ?? null,
    });
  }

  #statusPathWriter(): ((snapshot: DaemonStatusSnapshot) => Promise<void>) | undefined {
    const statusPath = this.options.statusPath;
    if (statusPath === undefined) {
      return undefined;
    }
    return (snapshot) => writeDaemonStatusSnapshot(statusPath, snapshot);
  }

  #currentCodexThreadCount(): number {
    const maybeRoutes = (
      this.#sessionRouter as { list?: () => readonly SessionRoute[] } | undefined
    )?.list?.();
    if (maybeRoutes === undefined) {
      return 0;
    }
    return maybeRoutes.filter(
      (route) => route.kind === "bound" && route.codexThreadId !== undefined,
    ).length;
  }

  #errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  #threadStartParams(route: Extract<SessionRoute, { kind: "bound" }>): DaemonThreadStartParams {
    return {
      cwd: route.cwd,
      ...(route.defaultModel === undefined ? {} : { model: route.defaultModel }),
    };
  }

  #bindActiveTurn(
    sessionRouter: DaemonSessionRouter,
    route: Extract<SessionRoute, { kind: "bound" }>,
    activeTurnId: string,
  ): void {
    if (sessionRouter.bind === undefined || route.codexThreadId === undefined) {
      return;
    }

    sessionRouter.bind(route.target, {
      projectId: route.projectId,
      cwd: route.cwd,
      codexThreadId: route.codexThreadId,
      ...(route.defaultModel === undefined ? {} : { defaultModel: route.defaultModel }),
      activeTurnId,
    });
  }

  #threadId(result: DaemonThreadStartResult): string | undefined {
    return typeof result.thread?.id === "string" ? result.thread.id : undefined;
  }

  #turnId(result: DaemonTurnStartResult): string | undefined {
    if (typeof result.turn?.id === "string") {
      return result.turn.id;
    }
    return typeof result.turnId === "string" ? result.turnId : undefined;
  }

  #currentRuntime(): DaemonCodexRuntime | undefined {
    const provider = this.#runtimeProvider(this.#supervisor);
    return provider?.currentRuntime() ?? undefined;
  }

  #bindIssuedRetryDelaysMs(): readonly number[] {
    return this.options.bindIssuedRetryDelaysMs ?? DEFAULT_BIND_RETRY_DELAYS_MS;
  }

  #positiveInteger(value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < 1) return fallback;
    return value;
  }

  #nonNegativeInteger(value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < 0) return fallback;
    return value;
  }

  #runtimeProvider(value: unknown): DaemonRuntimeProvider | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    if (typeof (value as Partial<DaemonRuntimeProvider>).currentRuntime !== "function") {
      return undefined;
    }
    return value as DaemonRuntimeProvider;
  }

  #daemonSessionRouter(value: unknown): DaemonSessionRouter | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    if (typeof (value as Partial<DaemonSessionRouter>).resolve !== "function") {
      return undefined;
    }
    return value as DaemonSessionRouter;
  }

  #defaultSessionRouter(storage: unknown): SessionRouter | undefined {
    const db = this.#databaseHandle(storage);
    return db === undefined
      ? undefined
      : new SessionRouter({ bindings: new BindingRepository(db) });
  }

  #databaseHandle(value: unknown): DatabaseHandle | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    return typeof (value as Partial<DatabaseHandle>).prepare === "function"
      ? (value as DatabaseHandle)
      : undefined;
  }

  #projectConfig(projectId: string): DaemonProjectConfig | undefined {
    if (typeof this.#config !== "object" || this.#config === null) {
      return undefined;
    }
    const projects = (this.#config as { projects?: unknown }).projects;
    if (typeof projects !== "object" || projects === null) {
      return undefined;
    }
    const project = (projects as Record<string, unknown>)[projectId];
    if (typeof project !== "object" || project === null) {
      return undefined;
    }
    const partial = project as Partial<DaemonProjectConfig>;
    if (typeof partial.cwd !== "string") {
      return undefined;
    }
    return {
      cwd: partial.cwd,
      ...(typeof partial.defaultModel === "string" ? { defaultModel: partial.defaultModel } : {}),
    };
  }

  #computerUsePolicyConfig(config: unknown): ComputerUsePolicyConfig | undefined {
    if (typeof config !== "object" || config === null) {
      return undefined;
    }
    const raw = (config as { computerUse?: unknown }).computerUse;
    if (typeof raw !== "object" || raw === null) {
      return undefined;
    }
    const candidate = raw as Partial<{
      enabled: unknown;
      requireExplicitPrefix: unknown;
      defaultApp: unknown;
      allowedApps: unknown;
      denyApps: unknown;
      unknownAppPolicy: unknown;
      requireApprovalKeywords: unknown;
      liveSmokeEnabled: unknown;
    }>;

    return {
      enabled: candidate.enabled === true,
      requireExplicitPrefix:
        typeof candidate.requireExplicitPrefix === "boolean"
          ? candidate.requireExplicitPrefix
          : true,
      ...(typeof candidate.defaultApp === "string" ? { defaultApp: candidate.defaultApp } : {}),
      allowedApps: stringArray(candidate.allowedApps),
      ...(candidate.denyApps === undefined ? {} : { denyApps: stringArray(candidate.denyApps) }),
      unknownAppPolicy: "deny",
      ...(candidate.requireApprovalKeywords === undefined
        ? {}
        : { requireApprovalKeywords: stringArray(candidate.requireApprovalKeywords) }),
      liveSmokeEnabled:
        typeof candidate.liveSmokeEnabled === "boolean" ? candidate.liveSmokeEnabled : false,
    };
  }

  #inboundAction(action: unknown):
    | {
        rawCallbackData: string;
        callbackHandle: string;
        messageRef?: DaemonMessageRef;
        target?: Target;
        sender?: SecurityPolicySender;
      }
    | undefined {
    if (typeof action !== "object" || action === null) {
      return undefined;
    }
    const partial = action as Partial<{
      rawCallbackData: unknown;
      callbackHandle: unknown;
      messageRef: unknown;
      target: unknown;
      sender: unknown;
    }>;
    if (typeof partial.rawCallbackData !== "string" || typeof partial.callbackHandle !== "string") {
      return undefined;
    }
    const messageRef = this.#daemonMessageRef(partial.messageRef);
    const target = this.#daemonTarget(partial.target);
    const sender = this.#daemonSender(partial.sender);
    return {
      rawCallbackData: partial.rawCallbackData,
      callbackHandle: partial.callbackHandle,
      ...(messageRef === undefined ? {} : { messageRef }),
      ...(target === undefined ? {} : { target }),
      ...(sender === undefined ? {} : { sender }),
    };
  }

  #inboundMessage(message: unknown):
    | {
        target: Target;
        sender: SecurityPolicySender;
        text: string;
        messageRef?: DaemonMessageRef;
      }
    | undefined {
    if (typeof message !== "object" || message === null) {
      return undefined;
    }
    const partial = message as Partial<{
      target: unknown;
      sender: unknown;
      text: unknown;
      messageRef: unknown;
    }>;
    const target = this.#daemonTarget(partial.target);
    const sender = this.#daemonSender(partial.sender);
    if (target === undefined || sender === undefined || typeof partial.text !== "string") {
      return undefined;
    }
    const messageRef = this.#daemonMessageRef(partial.messageRef);
    return {
      target,
      sender,
      text: partial.text,
      ...(messageRef === undefined ? {} : { messageRef }),
    };
  }

  #daemonMessageRef(value: unknown): DaemonMessageRef | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const partial = value as Partial<{ target: unknown; messageId: unknown }>;
    if (typeof partial.target !== "object" || partial.target === null) {
      return undefined;
    }
    const target = this.#daemonTarget(partial.target);
    if (target === undefined || typeof partial.messageId !== "string") {
      return undefined;
    }
    return {
      target,
      messageId: partial.messageId,
    };
  }

  #daemonTarget(value: unknown): Target | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const target = value as Partial<Target>;
    if (typeof target.platform !== "string" || typeof target.chatId !== "string") {
      return undefined;
    }
    return {
      platform: target.platform,
      chatId: target.chatId,
      ...(typeof target.threadKey === "string" ? { threadKey: target.threadKey } : {}),
      ...(typeof target.topicId === "string" ? { topicId: target.topicId } : {}),
    };
  }

  #daemonSender(value: unknown): SecurityPolicySender | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const sender = value as Partial<SecurityPolicySender>;
    if (typeof sender.userId !== "string") {
      return undefined;
    }
    return {
      userId: sender.userId,
      ...(typeof sender.displayName === "string" ? { displayName: sender.displayName } : {}),
    };
  }

  #inboundActor(inbound: { target?: Target; sender?: SecurityPolicySender }):
    | NonNullable<ApprovalActor>
    | undefined {
    if (inbound.target === undefined || inbound.sender === undefined) {
      return undefined;
    }
    return { kind: "im", platform: inbound.target.platform, userId: inbound.sender.userId };
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

function textInput(text: string): DaemonTextInput[] {
  return [{ type: "text", text, text_elements: [] }];
}

function turnOutputKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`;
}

function truncateImText(text: string): string {
  if (text.length <= MAX_IM_TEXT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_IM_TEXT_CHARS - 24)}\n\n[truncated for IM]`;
}

function readStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function targetEqual(a: Target, b: Target): boolean {
  return (
    a.platform === b.platform &&
    a.chatId === b.chatId &&
    (a.threadKey ?? null) === (b.threadKey ?? null) &&
    (a.topicId ?? null) === (b.topicId ?? null)
  );
}

function targetKey(target: Target): string {
  return JSON.stringify([
    target.platform,
    target.chatId,
    target.threadKey ?? null,
    target.topicId ?? null,
  ]);
}

function actorKey(target: Target, sender: SecurityPolicySender): string {
  return `${target.platform}:${sender.userId}`;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function redactMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (metadata === undefined) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    out[key] = typeof value === "string" ? redact(value) : value;
  }
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function drainShutdown(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    await Promise.resolve();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
