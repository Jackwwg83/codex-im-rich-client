import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
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
  type CallbackTokenApprovalTargetActionLookup,
  type CallbackTokenCasFields,
  type CallbackTokenInsert,
  type CallbackTokenMessageRefActionLookup,
  type CallbackTokenRecord,
  type CallbackTokenStatus,
  type DatabaseHandle,
  type ThreadSessionListOptions,
  type ThreadSessionRecord,
  ThreadSessionRepository,
  type ThreadSessionSwitchCurrent,
  type ThreadSessionSwitchResult,
  type ThreadSessionUpsert,
  hashCallbackToken,
} from "@codex-im/storage-sqlite";
import { type DaemonStatusSnapshot, writeDaemonStatusSnapshot } from "./status.js";

type MaybePromise<T> = T | Promise<T>;
type Unsubscribe = () => void;
type CleanupMethod = () => MaybePromise<void>;
export type DaemonSignal = "SIGINT" | "SIGTERM";
const CALLBACK_TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CALLBACK_TOKEN_WIRE_RE = /^v1:([A-Z2-7]{16})$/;
const DINGTALK_TEMPLATE_ACTION_RE = /^dingtalk-template-action:(allow_once|decline)$/;
const CALLBACK_TOKEN_FAIL_MESSAGES: Partial<Record<CallbackTokenStatus, string>> = {
  expired: "expired",
  revoked: "stale token",
  used: "already resolved",
  issued: "binding not ready",
};
const TEXT_FALLBACK_APPROVAL_ACTIONS = Object.freeze([
  "allow_once",
  "allow_session",
  "decline",
  "abort",
] as const satisfies readonly CallbackTokenAction[]);
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
const MAX_IM_TEXT_CHUNKS = 6;
const MAX_IM_TEXT_BUFFER_CHARS = MAX_IM_TEXT_CHARS * MAX_IM_TEXT_CHUNKS;
const MAX_IM_ITEM_SUMMARIES = 6;
const MAX_IM_ARTIFACT_FILES = 3;
const MAX_IM_ARTIFACT_FILE_BYTES = 10 * 1024 * 1024;
const PROGRESS_EDIT_INTERVAL_MS = 1_500;

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
  sendFile?(target: Target, file: DaemonOutboundFile): MaybePromise<DaemonMessageRef>;
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
  findBoundByMessageRefAction?(
    input: CallbackTokenMessageRefActionLookup,
  ): CallbackTokenRecord | unknown;
  findBoundByApprovalTargetAction?(
    input: CallbackTokenApprovalTargetActionLookup,
  ): CallbackTokenRecord | unknown;
  casUpdate?(
    tokenHash: string,
    fromStatus: CallbackTokenStatus,
    toStatus: CallbackTokenStatus,
    fields?: CallbackTokenCasFields,
  ): CallbackTokenRecord | unknown;
  forceMarkUsed?(tokenHash: string, fields?: CallbackTokenCasFields): CallbackTokenRecord | unknown;
  revokeBoundSiblings?(approvalId: string, exceptTokenHash: string): readonly CallbackTokenRecord[];
  revokeBound?(): readonly CallbackTokenRecord[];
  revokeActive?(): readonly CallbackTokenRecord[];
  pruneExpired?(now: string, limit?: number): readonly CallbackTokenRecord[];
  revokeStuckIssued?(
    cutoff: string,
    approvalIds: readonly string[],
    limit?: number,
  ): readonly CallbackTokenRecord[];
}

export interface DaemonThreadSessionRepository {
  upsert(input: ThreadSessionUpsert): ThreadSessionRecord;
  listForTarget?(
    target: Target,
    options?: ThreadSessionListOptions,
  ): readonly ThreadSessionRecord[];
  findByTargetAndThread?(target: Target, codexThreadId: string): ThreadSessionRecord | undefined;
  touch?(target: Target, codexThreadId: string, now?: string): ThreadSessionRecord | undefined;
  rename?(
    target: Target,
    codexThreadId: string,
    title: string | undefined,
    now?: string,
  ): ThreadSessionRecord | undefined;
  switchCurrent?(input: ThreadSessionSwitchCurrent): ThreadSessionSwitchResult;
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
  readonly kind?: DaemonMessageRefKind;
  readonly textUpdateMode?: DaemonMessageRefTextUpdateMode;
}

export interface DaemonOutboundFile {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface DaemonSendCardResult {
  readonly messageRef: DaemonMessageRef;
  readonly callbackNonce: string;
}

export type DaemonMessageRefKind = "inbound" | "text" | "approval_card" | "file";
export type DaemonMessageRefTextUpdateMode = "edit" | "append";

export interface DaemonUserChatPolicy {
  checkUserAndChat(target: Target, sender: SecurityPolicySender): SecurityPolicyUserChatDecision;
}

interface DaemonInboundMessagePolicy {
  checkUserAndChat?(target: Target, sender: SecurityPolicySender): SecurityPolicyUserChatDecision;
  checkInboundMessage?(
    target: Target,
    sender: SecurityPolicySender,
    text: string,
  ): SecurityPolicyUserChatDecision;
}

interface DaemonSessionRouter {
  resolve(target: Target): SessionRoute;
  bind?(target: Target, input: SessionBindingInput): SessionRoute;
  bindThread?(target: Target, codexThreadId: string): SessionRoute;
  replaceCachedBinding?(target: Target, input: SessionBindingInput): SessionRoute;
}

interface DaemonTextInput {
  readonly type: "text";
  readonly text: string;
  readonly text_elements: [];
}

interface DaemonLocalImageInput {
  readonly type: "localImage";
  readonly path: string;
}

type DaemonUserInput = DaemonTextInput | DaemonLocalImageInput;

interface DaemonInboundAttachment {
  readonly kind: "image" | "file";
  readonly filename: string;
  readonly contentType: string;
  readonly localPath: string;
  readonly sizeBytes?: number;
}

interface DaemonCodexRuntime {
  readonly events?: {
    events(): AsyncIterableIterator<CodexRichEvent>;
  };
  threadStart(params: DaemonThreadStartParams): MaybePromise<DaemonThreadStartResult>;
  threadResume?(params: DaemonThreadResumeParams): MaybePromise<unknown>;
  threadFork?(params: DaemonThreadForkParams): MaybePromise<DaemonThreadStartResult>;
  threadCompactStart?(params: { readonly threadId: string }): MaybePromise<unknown>;
  turnStart(params: DaemonTurnStartParams): MaybePromise<DaemonTurnStartResult>;
  turnSteer(params: DaemonTurnSteerParams): MaybePromise<unknown>;
  turnInterrupt?(params: DaemonTurnInterruptParams): MaybePromise<unknown>;
  modelList?(params: {
    readonly limit?: number;
    readonly includeHidden?: boolean;
  }): MaybePromise<unknown>;
  modelProviderCapabilitiesRead?(params: Record<string, never>): MaybePromise<unknown>;
  skillsList?(params: {
    readonly cwds?: readonly string[];
    readonly forceReload?: boolean;
  }): MaybePromise<unknown>;
  pluginList?(params: { readonly cwds?: readonly string[] | null }): MaybePromise<unknown>;
  appsList?(params: {
    readonly limit?: number;
    readonly threadId?: string | null;
    readonly forceRefetch?: boolean;
  }): MaybePromise<unknown>;
  mcpServerStatusList?(params: {
    readonly limit?: number;
    readonly detail?: unknown;
  }): MaybePromise<unknown>;
  accountRateLimitsRead?(): MaybePromise<unknown>;
}

interface DaemonRuntimeProvider {
  currentRuntime(): DaemonCodexRuntime | null | undefined;
}

interface DaemonTurnOutputState {
  readonly target: Target;
  readonly turnId: string;
  readonly itemSummaries: string[];
  readonly files: DaemonTurnOutputFile[];
  messageRef?: DaemonMessageRef;
  lastProgressEditAtMs?: number;
  text: string;
}

interface DaemonTurnOutputFile {
  readonly path: string;
  readonly filename: string;
  readonly contentType: string;
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

interface DaemonThreadResumeParams {
  readonly threadId: string;
  readonly cwd?: string | null;
  readonly model?: string | null;
  readonly excludeTurns?: boolean;
}

interface DaemonThreadForkParams {
  readonly threadId: string;
  readonly cwd?: string | null;
  readonly model?: string | null;
  readonly excludeTurns?: boolean;
}

interface DaemonTurnStartParams {
  readonly threadId: string;
  readonly input: DaemonUserInput[];
  readonly cwd?: string | null;
  readonly model?: string | null;
}

interface DaemonTurnStartResult {
  readonly turn?: { readonly id?: string };
  readonly turnId?: string;
}

interface DaemonTurnSteerParams {
  readonly threadId: string;
  readonly input: DaemonUserInput[];
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
  readonly threadSessionRepository?: DaemonThreadSessionRepository;
  readonly computerUseProvider?: ComputerUseProvider;
  readonly computerUseAllowedTools?: readonly ComputerUseAllowedTool[];
  readonly renderApprovalCard?: (snapshot: PendingApprovalSnapshot) => ApprovalCard;
  readonly renderResolvedApprovalCard?: (
    record: CallbackTokenRecord,
    originalCard?: ApprovalCard,
  ) => ApprovalCard;
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
  readonly readArtifactFile?: (path: string) => MaybePromise<Uint8Array>;
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
  readonly #approvalCardsById = new Map<string, ApprovalCard>();

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
            this.#approvalCardsById.set(snapshot.id, baseCard);
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
    const records =
      this.options.callbackTokenRepository?.revokeActive?.() ??
      this.options.callbackTokenRepository?.revokeBound?.() ??
      [];
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
    let inbound:
      | {
          target: Target;
          sender: SecurityPolicySender;
          text: string;
          attachments: readonly DaemonInboundAttachment[];
          messageRef?: DaemonMessageRef;
        }
      | undefined;
    try {
      inbound = this.#inboundMessage(message);
      if (inbound === undefined) {
        this.#emitAuditEvent("inbound.message_invalid", {
          result: "failed",
          metadata: { reason: "invalid_shape" },
        });
        return;
      }

      const policy = this.#inboundMessagePolicy(this.#securityPolicy);
      const decision =
        policy?.checkInboundMessage?.(inbound.target, inbound.sender, inbound.text) ??
        policy?.checkUserAndChat?.(inbound.target, inbound.sender);
      if (decision?.kind !== "allow") {
        this.#emitAuditEvent("inbound.message_denied", {
          target: inbound.target,
          result: "denied",
          metadata: {
            actorKey: actorKey(inbound.target, inbound.sender),
            reason: decision?.reason ?? "policy_unavailable",
          },
        });
        return;
      }

      const routed = routeInboundCommand(inbound.text, { attachments: inbound.attachments });
      this.#emitAuditEvent("inbound.message_allowed", {
        target: inbound.target,
        result: "allowed",
        metadata: {
          actorKey: actorKey(inbound.target, inbound.sender),
          routeKind: routed.kind,
          textLength: inbound.text.length,
          attachmentCount: inbound.attachments.length,
          imageAttachmentCount: inbound.attachments.filter(
            (attachment) => attachment.kind === "image",
          ).length,
          fileAttachmentCount: inbound.attachments.filter(
            (attachment) => attachment.kind === "file",
          ).length,
        },
      });
      if (routed.kind === "prompt") {
        await this.#routePrompt(inbound, routed.text, routed.attachments);
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
    } catch (error) {
      this.#emitAuditEvent("inbound.message_handler_failed", {
        target: inbound?.target,
        result: "failed",
        metadata: {
          ...(inbound === undefined ? {} : { actorKey: actorKey(inbound.target, inbound.sender) }),
          error: errorMessage(error),
        },
      });
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
    const templateAction =
      rawToken === undefined
        ? this.#decodeDingTalkTemplateAction(inbound.rawCallbackData)
        : undefined;
    let record: CallbackTokenRecord | unknown;
    if (rawToken !== undefined) {
      record = this.options.callbackTokenRepository?.findByHash?.(hashCallbackToken(rawToken));
    } else if (
      templateAction !== undefined &&
      inbound.messageRef !== undefined &&
      inbound.target !== undefined
    ) {
      record = this.options.callbackTokenRepository?.findBoundByMessageRefAction?.({
        target: inbound.target,
        messageRef: {
          chatId: inbound.messageRef.target.chatId,
          messageId: inbound.messageRef.messageId,
        },
        action: templateAction,
      });
    } else {
      this.#emitAuditEvent("approval.callback_malformed", {
        result: "failed",
        metadata: { reason: "malformed_wire_payload" },
      });
      await this.#answerAction(inbound.callbackHandle, "stale or unknown");
      return;
    }
    const status = this.#callbackTokenStatus(record);
    if (status === undefined) {
      this.#emitAuditEvent("approval.callback_unknown", {
        result: "failed",
        metadata:
          rawToken === undefined
            ? { reason: "message_ref_action_not_found" }
            : { tokenHash: hashCallbackToken(rawToken) },
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
    this.#markAcceptedApprovalRecord(record, actor);
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
    await this.#finalizeAcceptedApproval(record);
  }

  #markAcceptedApprovalRecord(
    record: CallbackTokenRecord,
    actor: NonNullable<ApprovalActor>,
  ): void {
    const repository = this.options.callbackTokenRepository;
    const used = repository?.casUpdate?.(record.tokenHash, "bound", "used", { actor });
    if (used !== undefined) {
      return;
    }

    this.#emitAuditEvent("audit.cas_unreachable_after_resolve", {
      approvalId: record.approvalId,
      target: record.target,
      result: "forced_used",
      metadata: { tokenHash: record.tokenHash },
    });
    repository?.forceMarkUsed?.(record.tokenHash, { actor });
  }

  async #finalizeAcceptedApproval(record: CallbackTokenRecord): Promise<void> {
    const repository = this.options.callbackTokenRepository;
    const terminalCard = this.options.renderResolvedApprovalCard?.(
      record,
      this.#approvalCardsById.get(record.approvalId),
    );
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
    this.#approvalCardsById.delete(record.approvalId);
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

  #computerUseStatusLine(policy: ComputerUsePolicy): string {
    const snapshot = policy.snapshot;
    const enabled = snapshot.enabled && snapshot.valid ? "enabled" : "disabled";
    const defaultApp = snapshot.defaultApp ?? "<none>";
    return `${enabled}, default app ${defaultApp}, live smoke ${
      snapshot.liveSmokeEnabled ? "enabled" : "disabled"
    }`;
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

  #decodeDingTalkTemplateAction(rawCallbackData: string): CallbackTokenAction | undefined {
    const action = DINGTALK_TEMPLATE_ACTION_RE.exec(rawCallbackData)?.[1];
    return action === "allow_once" || action === "decline" ? action : undefined;
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

  #inboundMessagePolicy(value: unknown): DaemonInboundMessagePolicy | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const candidate = value as Partial<DaemonInboundMessagePolicy>;
    if (
      typeof candidate.checkInboundMessage !== "function" &&
      typeof candidate.checkUserAndChat !== "function"
    ) {
      return undefined;
    }
    return candidate as DaemonInboundMessagePolicy;
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
    inbound: {
      target: Target;
      sender: SecurityPolicySender;
      messageRef?: DaemonMessageRef;
    },
    text: string,
    attachments: readonly DaemonInboundAttachment[],
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

    const input = promptInput(text, attachments);
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
      this.#persistThreadSessionBestEffort(inbound.target, route, threadId);
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

  #persistThreadSessionBestEffort(
    target: Target,
    route: Extract<SessionRoute, { kind: "bound" }>,
    codexThreadId: string,
  ): void {
    const repository = this.#threadSessionRepository();
    if (repository === undefined) {
      return;
    }
    try {
      repository.upsert({
        target,
        projectId: route.projectId,
        codexThreadId,
        now: this.#nowIso(),
      });
    } catch (error) {
      this.#emitAuditEvent("thread_session.best_effort_write_failed", {
        target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId: codexThreadId },
      });
    }
  }

  #startPromptTurn(
    runtime: DaemonCodexRuntime,
    route: Extract<SessionRoute, { kind: "bound" }> & { codexThreadId: string },
    input: DaemonUserInput[],
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
        state.text = appendImText(state.text, event.deltaText);
        await this.#maybeEditTurnProgress(state);
      }
      return;
    }

    if (event.type === "item_completed") {
      const state = this.#turnOutputs.get(turnOutputKey(event.threadId, event.turnId));
      const summary = summarizeCodexItem(event.raw);
      if (
        state !== undefined &&
        summary !== undefined &&
        state.itemSummaries.length < MAX_IM_ITEM_SUMMARIES &&
        !state.itemSummaries.includes(summary)
      ) {
        state.itemSummaries.push(summary);
      }
      const file = extractCodexItemFile(event.raw);
      if (
        state !== undefined &&
        file !== undefined &&
        state.files.length < MAX_IM_ARTIFACT_FILES &&
        !state.files.some((candidate) => candidate.path === file.path)
      ) {
        state.files.push(file);
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
    await this.#publishTerminalTurnOutput(
      state,
      this.#terminalTurnOutputBody(event, state.text, state.itemSummaries),
    );
    await this.#publishTerminalTurnFiles(state);
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
    const state: DaemonTurnOutputState = {
      target,
      turnId,
      itemSummaries: [],
      files: [],
      text: "",
    };
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

  async #editTurnOutput(state: DaemonTurnOutputState, body: string): Promise<boolean> {
    if (state.messageRef === undefined || this.#adapter?.editText === undefined) {
      return false;
    }
    try {
      await this.#adapter.editText(state.messageRef, body);
      return true;
    } catch (error) {
      this.#emitAuditEvent("runtime.turn_output_edit_failed", {
        target: state.target,
        result: "failed",
        metadata: { error: errorMessage(error), turnId: state.turnId },
      });
      return false;
    }
  }

  async #publishTerminalTurnOutput(state: DaemonTurnOutputState, body: string): Promise<void> {
    const chunks = splitImText(body);
    const [firstChunk, ...continuationChunks] = chunks;
    if (firstChunk !== undefined) {
      const edited = isAppendOnlyTextRef(state.messageRef)
        ? false
        : await this.#editTurnOutput(state, firstChunk);
      if (!edited && !(await this.#sendTurnOutputChunk(state, firstChunk))) {
        return;
      }
    }
    if (continuationChunks.length === 0 || this.#adapter?.sendText === undefined) {
      return;
    }
    for (const chunk of continuationChunks) {
      if (!(await this.#sendTurnOutputChunk(state, chunk))) {
        return;
      }
    }
  }

  async #sendTurnOutputChunk(state: DaemonTurnOutputState, body: string): Promise<boolean> {
    if (this.#adapter?.sendText === undefined) {
      return false;
    }
    try {
      await this.#adapter.sendText(state.target, body);
      return true;
    } catch (error) {
      this.#emitAuditEvent("runtime.turn_output_send_failed", {
        target: state.target,
        result: "failed",
        metadata: { error: errorMessage(error), turnId: state.turnId },
      });
      return false;
    }
  }

  async #publishTerminalTurnFiles(state: DaemonTurnOutputState): Promise<void> {
    if (state.files.length === 0) {
      return;
    }
    if (this.#adapter?.sendFile === undefined) {
      this.#emitAuditEvent("runtime.turn_output_file_skipped", {
        target: state.target,
        result: "skipped",
        metadata: { reason: "adapter_unsupported", turnId: state.turnId },
      });
      return;
    }
    for (const file of state.files) {
      await this.#sendTurnOutputFile(state, file);
    }
  }

  async #sendTurnOutputFile(
    state: DaemonTurnOutputState,
    file: DaemonTurnOutputFile,
  ): Promise<void> {
    try {
      const bytes = await this.#readArtifactFile(file.path);
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IM_ARTIFACT_FILE_BYTES) {
        this.#emitAuditEvent("runtime.turn_output_file_skipped", {
          target: state.target,
          result: "skipped",
          metadata: {
            reason: bytes.byteLength === 0 ? "empty_file" : "file_too_large",
            filename: file.filename,
            turnId: state.turnId,
          },
        });
        return;
      }
      await this.#adapter?.sendFile?.(state.target, {
        filename: file.filename,
        bytes,
        contentType: file.contentType,
      });
    } catch (error) {
      this.#emitAuditEvent("runtime.turn_output_file_send_failed", {
        target: state.target,
        result: "failed",
        metadata: { error: errorMessage(error), filename: file.filename, turnId: state.turnId },
      });
    }
  }

  async #readArtifactFile(path: string): Promise<Uint8Array> {
    return this.options.readArtifactFile?.(path) ?? readFile(path);
  }

  async #maybeEditTurnProgress(state: DaemonTurnOutputState): Promise<void> {
    if (state.text.length === 0) {
      return;
    }
    if (isAppendOnlyTextRef(state.messageRef)) {
      return;
    }
    const nowMs = (this.options.now?.() ?? new Date()).getTime();
    if (
      state.lastProgressEditAtMs !== undefined &&
      nowMs - state.lastProgressEditAtMs < PROGRESS_EDIT_INTERVAL_MS
    ) {
      return;
    }
    state.lastProgressEditAtMs = nowMs;
    await this.#editTurnOutput(state, this.#inProgressTurnOutputBody(state));
  }

  #inProgressTurnOutputBody(state: DaemonTurnOutputState): string {
    if (state.itemSummaries.length === 0) {
      return state.text.length === 0 ? "Codex is working..." : truncateImText(state.text);
    }
    return truncateImText(
      `${state.text.length === 0 ? "Codex is working..." : state.text}\n\nCodex items:\n${state.itemSummaries
        .map((summary) => `- ${summary}`)
        .join("\n")}`,
    );
  }

  #terminalTurnOutputBody(
    event: CodexRichEvent,
    text: string,
    itemSummaries: readonly string[] = [],
  ): string {
    let body: string;
    if (event.type === "turn_completed") {
      body = text.length === 0 ? "Codex turn completed." : text;
    } else if (event.type === "turn_interrupted") {
      body = text.length === 0 ? "Codex turn interrupted." : `${text}\n\n[turn interrupted]`;
    } else {
      body = text.length === 0 ? "Codex turn failed." : `${text}\n\n[turn failed]`;
    }
    if (itemSummaries.length === 0) {
      return body;
    }
    return truncateImText(
      `${body}\n\nCodex items:\n${itemSummaries.map((summary) => `- ${summary}`).join("\n")}`,
    );
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

    if (command.name === "start" || command.name === "help") {
      await this.#routeHelpCommand(inbound);
      return;
    }

    if (command.name === "projects") {
      await this.#routeProjectsCommand(inbound);
      return;
    }

    if (command.name === "threads") {
      await this.#routeThreadsCommand(inbound, command);
      return;
    }

    if (command.name === "status") {
      await this.#routeStatusCommand(inbound);
      return;
    }

    if (command.name === "whoami") {
      await this.#routeWhoamiCommand(inbound);
      return;
    }

    if (command.name === "new") {
      await this.#routeNewCommand(inbound, command);
      return;
    }

    if (command.name === "switch") {
      await this.#routeSwitchCommand(inbound, command);
      return;
    }

    if (command.name === "alias") {
      await this.#routeAliasCommand(inbound, command);
      return;
    }

    if (command.name === "fork") {
      await this.#routeForkCommand(inbound, command);
      return;
    }

    if (command.name === "stop") {
      await this.#routeStopCommand(inbound);
      return;
    }

    if (command.name === "model") {
      await this.#routeModelCommand(inbound);
      return;
    }

    if (command.name === "compact") {
      await this.#routeCompactCommand(inbound);
      return;
    }

    if (command.name === "usage") {
      await this.#routeUsageCommand(inbound);
      return;
    }

    if (command.name === "diagnostics") {
      await this.#routeDiagnosticsCommand(inbound);
      return;
    }

    if (command.name === "tools") {
      await this.#routeToolsCommand(inbound);
      return;
    }

    if (command.name === "skills") {
      await this.#routeSkillsCommand(inbound);
      return;
    }

    if (command.name === "plugins") {
      await this.#routePluginsCommand(inbound);
      return;
    }

    if (command.name === "apps") {
      await this.#routeAppsCommand(inbound);
      return;
    }

    if (command.name === "mcp") {
      await this.#routeMcpCommand(inbound);
      return;
    }

    if (command.name === "approvals") {
      await this.#routeApprovalsCommand(inbound);
      return;
    }

    if (command.name === "approve") {
      await this.#routeApproveCommand(inbound, command);
      return;
    }
  }

  async #routeHelpCommand(inbound: { messageRef?: DaemonMessageRef }): Promise<void> {
    await this.#editInboundMessage(
      inbound.messageRef,
      [
        "Commands:",
        "Send any non-command message as a Codex prompt for the current project/thread.",
        "/start - Show these commands.",
        "/projects - List available projects.",
        "/use <project> - Bind this chat to a project.",
        "/status - Show current Codex IM status.",
        "/whoami - Show redacted IM identity and current binding.",
        "/new [title] - Start a new Codex thread.",
        "/threads [project] - List known Codex threads.",
        "/switch <thread> - Resume and switch to a known Codex thread.",
        "/alias <title> - Rename current thread for IM display.",
        "/fork [thread] - Fork the current or selected Codex thread.",
        "/stop - Interrupt the active Codex turn.",
        "/model - List available Codex models.",
        "/compact - Start Codex compaction for the current thread.",
        "/usage - Show Codex account usage/rate-limit status.",
        "/diagnostics - Show runtime, IM, tool, and Computer Use readiness.",
        "/tools - Show model-provider and MCP tool capabilities.",
        "/skills - List Codex skills visible to the current project.",
        "/plugins - List Codex plugins visible to the current project.",
        "/apps - List Codex app/connectors visible to the current thread.",
        "/mcp - List MCP server status and exposed tool counts.",
        "/approvals - List pending approvals for this chat.",
        "/approve <id> <action> - Text fallback for approval buttons.",
        "Completed file, command, and tool activity may appear as Codex items.",
      ].join("\n"),
    );
  }

  async #routeProjectsCommand(inbound: {
    target: Target;
    sender: SecurityPolicySender;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
    const projects = this.#projectEntries().filter(([projectId]) =>
      this.#projectAllowed(projectId, inbound.target, inbound.sender),
    );

    if (projects.length === 0) {
      await this.#editInboundMessage(inbound.messageRef, "No projects available.");
      return;
    }

    await this.#editInboundMessage(
      inbound.messageRef,
      [
        "Projects:",
        ...projects.map(([projectId, project]) => {
          const marker = route?.kind === "bound" && route.projectId === projectId ? "*" : " ";
          const model =
            project.defaultModel === undefined ? "" : ` (model ${project.defaultModel})`;
          return `${marker} ${projectId}${model}`;
        }),
      ].join("\n"),
    );
  }

  async #routeThreadsCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    const repository = this.#threadSessionRepository();
    if (repository?.listForTarget === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Thread session store unavailable.");
      return;
    }

    const [projectId] = command.args;
    if (
      projectId !== undefined &&
      !this.#projectAllowed(projectId, inbound.target, inbound.sender)
    ) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return;
    }

    const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
    const listOptions: ThreadSessionListOptions =
      projectId === undefined ? { limit: 20 } : { projectId, limit: 20 };
    const records = repository
      .listForTarget(inbound.target, listOptions)
      .filter((record) => this.#projectAllowed(record.projectId, inbound.target, inbound.sender));

    if (records.length === 0) {
      await this.#editInboundMessage(inbound.messageRef, "No known Codex threads.");
      return;
    }

    await this.#editInboundMessage(
      inbound.messageRef,
      [
        "Threads:",
        ...records.map((record, index) => this.#formatThreadListLine(index + 1, record, route)),
      ].join("\n"),
    );
  }

  async #routeSwitchCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    const [selector] = command.args;
    if (selector === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Usage: /switch <thread>");
      return;
    }

    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const runtime = this.#currentRuntime();
    const repository = this.#threadSessionRepository();
    if (
      sessionRouter?.replaceCachedBinding === undefined ||
      repository?.listForTarget === undefined ||
      repository.switchCurrent === undefined
    ) {
      await this.#editInboundMessage(inbound.messageRef, "Thread switch store unavailable.");
      return;
    }
    if (runtime?.threadResume === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex thread resume unavailable.");
      return;
    }

    const records = repository
      .listForTarget(inbound.target, { limit: 20 })
      .filter((record) => this.#projectAllowed(record.projectId, inbound.target, inbound.sender));
    const selected = this.#selectThreadRecord(records, selector);
    if (selected.kind === "missing") {
      await this.#editInboundMessage(
        inbound.messageRef,
        "Unknown thread selector. Send /threads first.",
      );
      return;
    }
    if (selected.kind === "ambiguous") {
      await this.#editInboundMessage(
        inbound.messageRef,
        "Ambiguous thread selector. Use the number from /threads.",
      );
      return;
    }

    const project = this.#projectConfig(selected.record.projectId);
    if (project === undefined) {
      await this.#editInboundMessage(
        inbound.messageRef,
        `Unknown project: ${selected.record.projectId}`,
      );
      return;
    }
    if (!this.#projectAllowed(selected.record.projectId, inbound.target, inbound.sender)) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return;
    }

    const currentRoute = sessionRouter.resolve(inbound.target);
    const selectedIsCurrent =
      currentRoute.kind === "bound" &&
      currentRoute.projectId === selected.record.projectId &&
      currentRoute.codexThreadId === selected.record.codexThreadId;
    if (!selectedIsCurrent) {
      try {
        await runtime.threadResume({
          threadId: selected.record.codexThreadId,
          cwd: project.cwd,
          ...(project.defaultModel === undefined ? {} : { model: project.defaultModel }),
          excludeTurns: true,
        });
      } catch (error) {
        this.#emitAuditEvent("runtime.thread_resume_failed", {
          target: inbound.target,
          result: "failed",
          metadata: { error: errorMessage(error), threadId: selected.record.codexThreadId },
        });
        await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to resume.");
        return;
      }
    }

    try {
      repository.switchCurrent({
        target: inbound.target,
        projectId: selected.record.projectId,
        codexThreadId: selected.record.codexThreadId,
        cwd: project.cwd,
        ...(project.defaultModel === undefined ? {} : { defaultModel: project.defaultModel }),
        now: this.#nowIso(),
      });
      sessionRouter.replaceCachedBinding(inbound.target, {
        projectId: selected.record.projectId,
        cwd: project.cwd,
        codexThreadId: selected.record.codexThreadId,
        ...(project.defaultModel === undefined ? {} : { defaultModel: project.defaultModel }),
      });
    } catch (error) {
      this.#emitAuditEvent("thread_session.switch_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId: selected.record.codexThreadId },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to switch.");
      return;
    }

    await this.#editInboundMessage(
      inbound.messageRef,
      `Switched to ${selected.index + 1} ${selected.record.projectId} (${this.#shortId(
        selected.record.codexThreadId,
      )})`,
    );
  }

  async #routeStatusCommand(inbound: {
    target: Target;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
    const lines = ["Status:", `target: ${this.#targetLabel(inbound.target)}`];
    if (route?.kind !== "bound") {
      lines.push("binding: unbound");
      lines.push(`pending approvals: ${this.#pendingApprovalCount()}`);
      await this.#editInboundMessage(inbound.messageRef, lines.join("\n"));
      return;
    }

    lines.push("binding: bound");
    lines.push(`project: ${route.projectId}`);
    lines.push(`thread: ${this.#shortId(route.codexThreadId)}`);
    const title = this.#threadTitleForRoute(inbound.target, route);
    if (title !== undefined) {
      lines.push(`title: ${title}`);
    }
    lines.push(`active turn: ${this.#shortId(route.activeTurnId)}`);
    lines.push(`pending approvals: ${this.#pendingApprovalCount()}`);
    await this.#editInboundMessage(inbound.messageRef, lines.join("\n"));
  }

  async #routeWhoamiCommand(inbound: {
    target: Target;
    sender: SecurityPolicySender;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
    const lines = [
      "Who am I:",
      `platform: ${inbound.target.platform}`,
      `chat id: ${presence(inbound.target.chatId)}`,
      `thread key: ${presence(inbound.target.threadKey)}`,
      `topic id: ${presence(inbound.target.topicId)}`,
      `sender id: ${presence(inbound.sender.userId)}`,
      `binding: ${route?.kind === "bound" ? "bound" : "unbound"}`,
    ];
    if (route?.kind === "bound") {
      lines.push(`project: ${route.projectId}`);
      lines.push(`thread: ${this.#shortId(route.codexThreadId)}`);
    }
    await this.#editInboundMessage(inbound.messageRef, lines.join("\n"));
  }

  async #routeModelCommand(inbound: {
    target: Target;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const runtime = this.#currentRuntime();
    if (runtime?.modelList === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex model list unavailable.");
      return;
    }

    try {
      const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
      const response = await runtime.modelList({ limit: 20, includeHidden: false });
      await this.#editInboundMessage(
        inbound.messageRef,
        formatModelList(response, route?.kind === "bound" ? route.defaultModel : undefined),
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.model_list_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex model list failed.");
    }
  }

  async #routeCompactCommand(inbound: {
    target: Target;
    sender: SecurityPolicySender;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const runtime = this.#currentRuntime();
    if (runtime?.threadCompactStart === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex thread compaction unavailable.");
      return;
    }
    const route = sessionRouter?.resolve(inbound.target);
    if (route?.kind !== "bound" || route.codexThreadId === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "No current Codex thread.");
      return;
    }
    if (!this.#projectAllowed(route.projectId, inbound.target, inbound.sender)) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return;
    }

    try {
      await runtime.threadCompactStart({ threadId: route.codexThreadId });
      await this.#editInboundMessage(
        inbound.messageRef,
        `Codex compaction started for ${this.#shortId(route.codexThreadId)}.`,
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.thread_compact_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId: route.codexThreadId },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex compaction failed to start.");
    }
  }

  async #routeUsageCommand(inbound: {
    target: Target;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const runtime = this.#currentRuntime();
    if (runtime?.accountRateLimitsRead === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex usage status unavailable.");
      return;
    }

    try {
      await this.#editInboundMessage(
        inbound.messageRef,
        formatUsage(await runtime.accountRateLimitsRead()),
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.usage_read_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex usage status failed.");
    }
  }

  async #routeDiagnosticsCommand(inbound: {
    target: Target;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const runtime = this.#currentRuntime();
    const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
    const lines = [
      "Diagnostics:",
      `target: ${this.#targetLabel(inbound.target)}`,
      `binding: ${route?.kind === "bound" ? "bound" : "unbound"}`,
      `runtime: ${runtime === undefined ? "unavailable" : "available"}`,
      `pending approvals: ${this.#pendingApprovalCount()}`,
      `computer use: ${this.#computerUseStatusLine(this.#computerUsePolicy ?? new ComputerUsePolicy())}`,
    ];
    if (route?.kind === "bound") {
      lines.push(`project: ${route.projectId}`);
      lines.push(`thread: ${this.#shortId(route.codexThreadId)}`);
      lines.push(`active turn: ${this.#shortId(route.activeTurnId)}`);
    }

    if (runtime?.modelProviderCapabilitiesRead !== undefined) {
      try {
        lines.push(
          `capabilities: ${formatModelProviderCapabilities(await runtime.modelProviderCapabilitiesRead({}))}`,
        );
      } catch (error) {
        this.#emitAuditEvent("runtime.capabilities_read_failed", {
          target: inbound.target,
          result: "failed",
          metadata: { error: errorMessage(error) },
        });
        lines.push("capabilities: unavailable");
      }
    }

    if (runtime?.mcpServerStatusList !== undefined) {
      try {
        const servers = readArrayField(
          await runtime.mcpServerStatusList({ limit: 20, detail: "toolsAndAuthOnly" }),
          "data",
        );
        lines.push(`mcp servers: ${servers.length}`);
      } catch (error) {
        this.#emitAuditEvent("runtime.mcp_status_failed", {
          target: inbound.target,
          result: "failed",
          metadata: { error: errorMessage(error) },
        });
        lines.push("mcp servers: unavailable");
      }
    }

    await this.#editInboundMessage(inbound.messageRef, lines.join("\n"));
  }

  async #routeToolsCommand(inbound: {
    target: Target;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const runtime = this.#currentRuntime();
    const lines = ["Tools:"];
    if (runtime?.modelProviderCapabilitiesRead !== undefined) {
      try {
        lines.push(
          `model provider: ${formatModelProviderCapabilities(
            await runtime.modelProviderCapabilitiesRead({}),
          )}`,
        );
      } catch (error) {
        this.#emitAuditEvent("runtime.capabilities_read_failed", {
          target: inbound.target,
          result: "failed",
          metadata: { error: errorMessage(error) },
        });
        lines.push("model provider: unavailable");
      }
    } else {
      lines.push("model provider: unavailable");
    }

    if (runtime?.mcpServerStatusList !== undefined) {
      try {
        lines.push(
          ...formatMcpToolLines(
            await runtime.mcpServerStatusList({ limit: 20, detail: "toolsAndAuthOnly" }),
          ),
        );
      } catch (error) {
        this.#emitAuditEvent("runtime.mcp_status_failed", {
          target: inbound.target,
          result: "failed",
          metadata: { error: errorMessage(error) },
        });
        lines.push("MCP: unavailable");
      }
    } else {
      lines.push("MCP: unavailable");
    }

    await this.#editInboundMessage(inbound.messageRef, lines.join("\n"));
  }

  async #routeSkillsCommand(inbound: {
    target: Target;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const runtime = this.#currentRuntime();
    if (runtime?.skillsList === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex skills list unavailable.");
      return;
    }

    try {
      const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
      const cwds = route?.kind === "bound" ? [route.cwd] : undefined;
      await this.#editInboundMessage(
        inbound.messageRef,
        formatSkillsList(await runtime.skillsList({ ...(cwds === undefined ? {} : { cwds }) })),
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.skills_list_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex skills list failed.");
    }
  }

  async #routePluginsCommand(inbound: {
    target: Target;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const runtime = this.#currentRuntime();
    if (runtime?.pluginList === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex plugin list unavailable.");
      return;
    }

    try {
      const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
      const cwds = route?.kind === "bound" ? [route.cwd] : undefined;
      await this.#editInboundMessage(
        inbound.messageRef,
        formatPluginList(await runtime.pluginList({ ...(cwds === undefined ? {} : { cwds }) })),
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.plugin_list_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex plugin list failed.");
    }
  }

  async #routeAppsCommand(inbound: {
    target: Target;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const runtime = this.#currentRuntime();
    if (runtime?.appsList === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex app list unavailable.");
      return;
    }

    try {
      const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
      await this.#editInboundMessage(
        inbound.messageRef,
        formatAppsList(
          await runtime.appsList({
            limit: 20,
            ...(route?.kind === "bound" && route.codexThreadId !== undefined
              ? { threadId: route.codexThreadId }
              : {}),
          }),
        ),
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.apps_list_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex app list failed.");
    }
  }

  async #routeMcpCommand(inbound: {
    target: Target;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const runtime = this.#currentRuntime();
    if (runtime?.mcpServerStatusList === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex MCP status unavailable.");
      return;
    }

    try {
      await this.#editInboundMessage(
        inbound.messageRef,
        formatMcpStatus(
          await runtime.mcpServerStatusList({ limit: 20, detail: "toolsAndAuthOnly" }),
        ),
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.mcp_status_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex MCP status failed.");
    }
  }

  async #routeApprovalsCommand(inbound: {
    target: Target;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const pending = this.#broker?.listPending?.();
    if (pending === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Pending approval list unavailable.");
      return;
    }
    if (this.options.callbackTokenRepository?.findBoundByApprovalTargetAction === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Approval fallback unavailable.");
      return;
    }

    const lines: string[] = [];
    for (const snapshot of pending) {
      const actions = this.#fallbackApprovalActionsForTarget(snapshot, inbound.target);
      if (actions.length === 0) {
        continue;
      }
      lines.push(
        `- ${snapshot.id} ${classifyApprovalRequest(snapshot.method)} actions: ${actions.join(", ")} expires: ${snapshot.expiresAt.toISOString()}`,
      );
    }

    await this.#editInboundMessage(
      inbound.messageRef,
      lines.length === 0
        ? "No pending approvals for this chat."
        : ["Pending approvals:", ...lines].join("\n"),
    );
  }

  async #routeApproveCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    const approvalId = command.args[0];
    const action = parseTextApprovalAction(command.args[1]);
    if (approvalId === undefined || action === undefined) {
      await this.#editInboundMessage(
        inbound.messageRef,
        "Usage: /approve <approval-id> <allow_once|allow_session|decline|abort>",
      );
      return;
    }

    if (this.#broker?.resolve === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Approval resolution unavailable.");
      return;
    }
    if (!this.#broker.listPending?.().some((snapshot) => snapshot.id === approvalId)) {
      await this.#editInboundMessage(inbound.messageRef, "Approval is not pending or is stale.");
      return;
    }

    const record = this.#resolvableCallbackRecord(
      this.options.callbackTokenRepository?.findBoundByApprovalTargetAction?.({
        approvalId,
        target: inbound.target,
        action,
      }),
    );
    if (record === undefined || record.messageRef === undefined) {
      await this.#editInboundMessage(
        inbound.messageRef,
        "Approval fallback unavailable or stale for this chat/action.",
      );
      return;
    }
    if (!targetEqual(record.target, inbound.target)) {
      await this.#editInboundMessage(inbound.messageRef, "Approval belongs to a different chat.");
      return;
    }

    const actor = this.#inboundActor(inbound);
    if (actor === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Approval actor unavailable.");
      return;
    }

    const result = await this.#broker.resolve({
      approvalId,
      decision: { kind: action } as ApprovalUiAction,
      actor,
      target: record.target,
      callbackNonce: record.callbackNonce,
    });
    if (result.kind === "error") {
      await this.#editInboundMessage(
        inbound.messageRef,
        `Approval failed: ${this.#resolveErrorMessage(result.error)}`,
      );
      return;
    }

    this.#markAcceptedApprovalRecord(record, actor);
    await this.#finalizeAcceptedApproval(record);
    await this.#editInboundMessage(
      inbound.messageRef,
      `Approval resolved: ${approvalId} ${action}`,
    );
  }

  #fallbackApprovalActionsForTarget(
    snapshot: PendingApprovalSnapshot,
    target: Target,
  ): readonly CallbackTokenAction[] {
    const findBound = this.options.callbackTokenRepository?.findBoundByApprovalTargetAction;
    if (findBound === undefined) {
      return [];
    }
    return TEXT_FALLBACK_APPROVAL_ACTIONS.filter(
      (action) =>
        this.#resolvableCallbackRecord(
          findBound.call(this.options.callbackTokenRepository, {
            approvalId: snapshot.id,
            target,
            action,
          }),
        ) !== undefined,
    );
  }

  async #routeAliasCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    const title = this.#threadTitleFromArgs(command.args);
    if (title === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Usage: /alias <title>");
      return;
    }

    const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
    if (route?.kind !== "bound" || route.codexThreadId === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "No current Codex thread.");
      return;
    }
    if (!this.#projectAllowed(route.projectId, inbound.target, inbound.sender)) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return;
    }

    const repository = this.#threadSessionRepository();
    if (repository === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Thread session store unavailable.");
      return;
    }

    try {
      const renamed = repository.rename?.(
        inbound.target,
        route.codexThreadId,
        title,
        this.#nowIso(),
      );
      if (renamed === undefined) {
        repository.upsert({
          target: inbound.target,
          projectId: route.projectId,
          codexThreadId: route.codexThreadId,
          title,
          now: this.#nowIso(),
        });
      }
    } catch (error) {
      this.#emitAuditEvent("thread_session.alias_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId: route.codexThreadId },
      });
      await this.#editInboundMessage(inbound.messageRef, "Thread alias failed to save.");
      return;
    }

    await this.#editInboundMessage(inbound.messageRef, `Thread alias set: ${title}`);
  }

  async #routeNewCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const runtime = this.#currentRuntime();
    const threadSessions = this.#threadSessionRepository();
    if (sessionRouter === undefined || sessionRouter.bindThread === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Binding store unavailable");
      return;
    }
    if (runtime === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex runtime unavailable.");
      return;
    }
    if (threadSessions === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Thread session store unavailable.");
      return;
    }

    const route = sessionRouter.resolve(inbound.target);
    if (route.kind !== "bound") {
      await this.#editInboundMessage(
        inbound.messageRef,
        "No project selected. Send /use <project> first.",
      );
      return;
    }
    if (!this.#projectAllowed(route.projectId, inbound.target, inbound.sender)) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return;
    }

    let threadId: string | undefined;
    try {
      threadId = this.#threadId(await runtime.threadStart(this.#threadStartParams(route)));
    } catch (error) {
      this.#emitAuditEvent("runtime.thread_start_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to start.");
      return;
    }
    if (threadId === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to start.");
      return;
    }

    const title = this.#threadTitleFromArgs(command.args);
    try {
      threadSessions.upsert({
        target: inbound.target,
        projectId: route.projectId,
        codexThreadId: threadId,
        ...(title === undefined ? {} : { title }),
        now: this.#nowIso(),
      });
      const rebound = sessionRouter.bindThread(inbound.target, threadId);
      if (rebound.kind !== "bound" || rebound.codexThreadId === undefined) {
        await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to bind.");
        return;
      }
    } catch (error) {
      this.#emitAuditEvent("thread_session.write_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to save.");
      return;
    }

    await this.#editInboundMessage(
      inbound.messageRef,
      `New Codex thread ${this.#shortId(threadId)}${title === undefined ? "" : ` - ${title}`}`,
    );
  }

  async #routeForkCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const runtime = this.#currentRuntime();
    const threadSessions = this.#threadSessionRepository();
    if (sessionRouter?.bind === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Binding store unavailable");
      return;
    }
    if (runtime?.threadFork === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex thread fork unavailable.");
      return;
    }
    if (threadSessions === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Thread session store unavailable.");
      return;
    }

    const source = this.#forkSource(inbound, command, threadSessions);
    if (source.kind === "no_current") {
      await this.#editInboundMessage(
        inbound.messageRef,
        "No current Codex thread. Send /new first or fork a selector from /threads.",
      );
      return;
    }
    if (source.kind === "missing") {
      await this.#editInboundMessage(
        inbound.messageRef,
        "Unknown thread selector. Send /threads first.",
      );
      return;
    }
    if (source.kind === "ambiguous") {
      await this.#editInboundMessage(
        inbound.messageRef,
        "Ambiguous thread selector. Use the number from /threads.",
      );
      return;
    }
    if (!this.#projectAllowed(source.projectId, inbound.target, inbound.sender)) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return;
    }

    const project = this.#projectConfig(source.projectId);
    if (project === undefined) {
      await this.#editInboundMessage(inbound.messageRef, `Unknown project: ${source.projectId}`);
      return;
    }

    let forkedThreadId: string | undefined;
    try {
      forkedThreadId = this.#threadId(
        await runtime.threadFork({
          threadId: source.codexThreadId,
          cwd: project.cwd,
          ...(project.defaultModel === undefined ? {} : { model: project.defaultModel }),
          excludeTurns: true,
        }),
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.thread_fork_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId: source.codexThreadId },
      });
      await this.#editInboundMessage(inbound.messageRef, forkFailureMessage(error));
      return;
    }
    if (forkedThreadId === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to fork.");
      return;
    }

    const title = this.#threadTitleFromArgs(source.titleArgs);
    try {
      threadSessions.upsert({
        target: inbound.target,
        projectId: source.projectId,
        codexThreadId: forkedThreadId,
        ...(title === undefined ? {} : { title }),
        now: this.#nowIso(),
      });
      const rebound = sessionRouter.bind(inbound.target, {
        projectId: source.projectId,
        cwd: project.cwd,
        ...(project.defaultModel === undefined ? {} : { defaultModel: project.defaultModel }),
        codexThreadId: forkedThreadId,
      });
      if (rebound.kind !== "bound" || rebound.codexThreadId === undefined) {
        await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to bind.");
        return;
      }
    } catch (error) {
      this.#emitAuditEvent("thread_session.fork_write_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId: forkedThreadId },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to save.");
      return;
    }

    await this.#editInboundMessage(
      inbound.messageRef,
      `Forked Codex thread ${this.#shortId(forkedThreadId)} from ${this.#shortId(
        source.codexThreadId,
      )}${title === undefined ? "" : ` - ${title}`}`,
    );
  }

  #forkSource(
    inbound: { target: Target; sender: SecurityPolicySender },
    command: Extract<CommandRouterResult, { kind: "command" }>,
    repository: DaemonThreadSessionRepository,
  ):
    | { kind: "source"; projectId: string; codexThreadId: string; titleArgs: readonly string[] }
    | { kind: "no_current" }
    | { kind: "missing" }
    | { kind: "ambiguous" } {
    const [selector, ...titleArgs] = command.args;
    if (selector !== undefined) {
      const unfiltered = repository.listForTarget?.(inbound.target, { limit: 20 });
      if (unfiltered === undefined) {
        return { kind: "missing" };
      }
      const records = unfiltered.filter((record) =>
        this.#projectAllowed(record.projectId, inbound.target, inbound.sender),
      );
      const selected = this.#selectThreadRecord(records, selector);
      if (selected.kind === "missing" || selected.kind === "ambiguous") {
        return selected;
      }
      return {
        kind: "source",
        projectId: selected.record.projectId,
        codexThreadId: selected.record.codexThreadId,
        titleArgs,
      };
    }

    const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
    if (route?.kind !== "bound" || route.codexThreadId === undefined) {
      return { kind: "no_current" };
    }
    return {
      kind: "source",
      projectId: route.projectId,
      codexThreadId: route.codexThreadId,
      titleArgs: [],
    };
  }

  #threadTitleFromArgs(args: readonly string[]): string | undefined {
    const title = this.#sanitizeThreadTitle(args.join(" "));
    return title.length === 0 ? undefined : title.slice(0, 120);
  }

  #threadTitleForRoute(
    target: Target,
    route: Extract<SessionRoute, { kind: "bound" }>,
  ): string | undefined {
    if (route.codexThreadId === undefined) {
      return undefined;
    }
    try {
      const title = this.#threadSessionRepository()?.findByTargetAndThread?.(
        target,
        route.codexThreadId,
      )?.title;
      return title === undefined ? undefined : this.#sanitizeThreadTitle(title).slice(0, 120);
    } catch (error) {
      this.#emitAuditEvent("thread_session.status_title_failed", {
        target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId: route.codexThreadId },
      });
      return undefined;
    }
  }

  #formatThreadListLine(
    selector: number,
    record: ThreadSessionRecord,
    route: SessionRoute | undefined,
  ): string {
    const marker =
      route?.kind === "bound" &&
      route.projectId === record.projectId &&
      route.codexThreadId === record.codexThreadId
        ? "*"
        : " ";
    const title = record.title === undefined ? "" : ` ${this.#sanitizeThreadTitle(record.title)}`;
    return `${marker} ${selector} ${record.projectId}${title} (${this.#shortId(
      record.codexThreadId,
    )}) last ${record.lastUsedAt}`;
  }

  #selectThreadRecord(
    records: readonly ThreadSessionRecord[],
    selector: string,
  ):
    | { kind: "selected"; record: ThreadSessionRecord; index: number }
    | { kind: "missing" }
    | { kind: "ambiguous" } {
    if (/^\d+$/.test(selector)) {
      const index = Number.parseInt(selector, 10) - 1;
      const record = records[index];
      return record === undefined ? { kind: "missing" } : { kind: "selected", record, index };
    }

    const prefix = selector.endsWith("...") ? selector.slice(0, -3) : selector;
    const matches = records
      .map((record, index) => ({ record, index }))
      .filter(
        ({ record }) =>
          record.codexThreadId === selector || record.codexThreadId.startsWith(prefix),
      );
    if (matches.length === 0) {
      return { kind: "missing" };
    }
    if (matches.length > 1) {
      return { kind: "ambiguous" };
    }
    const [match] = matches;
    if (match === undefined) {
      return { kind: "missing" };
    }
    return { kind: "selected", record: match.record, index: match.index };
  }

  #sanitizeThreadTitle(value: string): string {
    let withoutControl = "";
    for (const char of value) {
      const code = char.charCodeAt(0);
      withoutControl += code < 32 || code === 127 ? " " : char;
    }
    return withoutControl.replace(/\s+/g, " ").trim();
  }

  #targetLabel(target: Target): string {
    if (target.topicId !== undefined) {
      return `${target.platform} topic`;
    }
    if (target.threadKey !== undefined) {
      return `${target.platform} thread`;
    }
    return `${target.platform} chat`;
  }

  #shortId(value: string | undefined): string {
    if (value === undefined) {
      return "none";
    }
    return value.length <= 12 ? value : `${value.slice(0, 12)}...`;
  }

  #controlPlaneBlockMessage(target: Target, commandName: string): string | undefined {
    if (
      commandName !== "use" &&
      commandName !== "new" &&
      commandName !== "switch" &&
      commandName !== "fork" &&
      commandName !== "compact"
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
    await this.#publishTerminalTurnOutput(
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

  #nowIso(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
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

  #projectEntries(): Array<readonly [string, DaemonProjectConfig]> {
    if (typeof this.#config !== "object" || this.#config === null) {
      return [];
    }
    const projects = (this.#config as { projects?: unknown }).projects;
    if (typeof projects !== "object" || projects === null) {
      return [];
    }
    return Object.keys(projects)
      .sort()
      .flatMap((projectId): Array<readonly [string, DaemonProjectConfig]> => {
        const project = this.#projectConfig(projectId);
        return project === undefined ? [] : [[projectId, project] as const];
      });
  }

  #defaultSessionRouter(storage: unknown): SessionRouter | undefined {
    const db = this.#databaseHandle(storage);
    return db === undefined
      ? undefined
      : new SessionRouter({ bindings: new BindingRepository(db) });
  }

  #threadSessionRepository(): DaemonThreadSessionRepository | undefined {
    if (this.options.threadSessionRepository !== undefined) {
      return this.options.threadSessionRepository;
    }
    const db = this.#databaseHandle(this.#storage);
    return db === undefined ? undefined : new ThreadSessionRepository(db);
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
        attachments: readonly DaemonInboundAttachment[];
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
      attachments: unknown;
      messageRef: unknown;
    }>;
    const target = this.#daemonTarget(partial.target);
    const sender = this.#daemonSender(partial.sender);
    if (target === undefined || sender === undefined || typeof partial.text !== "string") {
      return undefined;
    }
    const messageRef = this.#daemonMessageRef(partial.messageRef);
    const attachments = this.#daemonInboundAttachments(partial.attachments);
    return {
      target,
      sender,
      text: partial.text,
      attachments,
      ...(messageRef === undefined ? {} : { messageRef }),
    };
  }

  #daemonInboundAttachments(value: unknown): readonly DaemonInboundAttachment[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const attachments: DaemonInboundAttachment[] = [];
    for (const item of value) {
      const attachment = this.#daemonInboundAttachment(item);
      if (attachment !== undefined) {
        attachments.push(attachment);
      }
    }
    return attachments;
  }

  #daemonInboundAttachment(value: unknown): DaemonInboundAttachment | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const partial = value as Partial<{
      kind: unknown;
      filename: unknown;
      contentType: unknown;
      localPath: unknown;
      sizeBytes: unknown;
    }>;
    if (
      (partial.kind !== "image" && partial.kind !== "file") ||
      typeof partial.filename !== "string" ||
      typeof partial.contentType !== "string" ||
      typeof partial.localPath !== "string" ||
      partial.localPath.length === 0
    ) {
      return undefined;
    }
    return {
      kind: partial.kind,
      filename: partial.filename,
      contentType: partial.contentType,
      localPath: partial.localPath,
      ...(typeof partial.sizeBytes === "number" && Number.isFinite(partial.sizeBytes)
        ? { sizeBytes: partial.sizeBytes }
        : {}),
    };
  }

  #daemonMessageRef(value: unknown): DaemonMessageRef | undefined {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const partial = value as Partial<{
      target: unknown;
      messageId: unknown;
      kind: unknown;
      textUpdateMode: unknown;
    }>;
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
      ...optionalMessageRefKind(partial.kind),
      ...optionalMessageRefTextUpdateMode(partial.textUpdateMode),
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
  return [textInputItem(text)];
}

function textInputItem(text: string): DaemonTextInput {
  return { type: "text", text, text_elements: [] };
}

function promptInput(
  text: string,
  attachments: readonly DaemonInboundAttachment[] = [],
): DaemonUserInput[] {
  if (attachments.length === 0) {
    return textInput(text);
  }
  const fileAttachments = attachments.filter((attachment) => attachment.kind === "file");
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const textWithFiles = promptTextWithFileAttachments(text, fileAttachments, imageAttachments);
  const input: DaemonUserInput[] = [];
  if (textWithFiles.length > 0) {
    input.push(textInputItem(textWithFiles));
  }
  for (const attachment of imageAttachments) {
    input.push({ type: "localImage", path: attachment.localPath });
  }
  return input.length === 0 ? textInput("Please inspect the attached file(s).") : input;
}

function promptTextWithFileAttachments(
  text: string,
  fileAttachments: readonly DaemonInboundAttachment[],
  imageAttachments: readonly DaemonInboundAttachment[],
): string {
  const trimmed = text.trim();
  const sections: string[] = [];
  if (trimmed.length > 0) {
    sections.push(text);
  } else if (imageAttachments.length > 0 && fileAttachments.length === 0) {
    sections.push("Please inspect the attached image(s).");
  }
  if (fileAttachments.length > 0) {
    sections.push(
      [
        "Attached file(s) saved locally for Codex:",
        ...fileAttachments.map((attachment) => {
          const size = attachment.sizeBytes === undefined ? "" : `, ${attachment.sizeBytes} bytes`;
          return `- ${attachment.filename} (${attachment.contentType}${size}): ${attachment.localPath}`;
        }),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
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

function appendImText(base: string, delta: string): string {
  const next = `${base}${delta}`;
  if (next.length <= MAX_IM_TEXT_BUFFER_CHARS) {
    return next;
  }
  return `${next.slice(0, MAX_IM_TEXT_BUFFER_CHARS - 24)}\n\n[truncated for IM]`;
}

function splitImText(text: string): readonly string[] {
  if (text.length <= MAX_IM_TEXT_CHARS) {
    return [text];
  }
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length && chunks.length < MAX_IM_TEXT_CHUNKS) {
    const prefix = chunks.length === 0 ? "" : "[continued]\n";
    const limit = MAX_IM_TEXT_CHARS - prefix.length;
    const lastAllowedChunk = chunks.length === MAX_IM_TEXT_CHUNKS - 1;
    let chunk = text.slice(offset, offset + limit);
    offset += chunk.length;
    if (lastAllowedChunk && offset < text.length) {
      const marker = "\n\n[truncated for IM]";
      chunk = `${chunk.slice(0, Math.max(0, limit - marker.length))}${marker}`;
      offset = text.length;
    }
    chunks.push(`${prefix}${chunk}`);
  }
  return chunks.length === 0 ? [""] : chunks;
}

function readStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function readBooleanField(value: unknown, key: string): boolean | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "boolean" ? field : undefined;
}

function readNumberField(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function readArrayField(value: unknown, key: string): unknown[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const field = (value as Record<string, unknown>)[key];
  return Array.isArray(field) ? field : [];
}

function formatModelList(value: unknown, currentModel: string | undefined): string {
  const models = readArrayField(value, "data").map(readRecord).filter(isDefined).slice(0, 20);
  if (models.length === 0) {
    return "Models:\nNo models returned.";
  }
  return [
    "Models:",
    ...models.map((model) => {
      const display =
        readStringField(model, "displayName") ??
        readStringField(model, "model") ??
        readStringField(model, "id") ??
        "unknown";
      const modelId = readStringField(model, "model") ?? readStringField(model, "id");
      const isDefault = readBooleanField(model, "isDefault") === true;
      const hidden = readBooleanField(model, "hidden") === true;
      const current =
        currentModel !== undefined && (modelId === currentModel || display === currentModel);
      const suffix = [
        current ? "current project default" : undefined,
        isDefault ? "default" : undefined,
        hidden ? "hidden" : undefined,
      ]
        .filter(isDefined)
        .join(", ");
      return `${current ? "*" : " "} ${display}${
        modelId !== undefined && modelId !== display ? ` (${modelId})` : ""
      }${suffix.length === 0 ? "" : ` - ${suffix}`}`;
    }),
  ].join("\n");
}

function formatModelProviderCapabilities(value: unknown): string {
  return [
    `namespace tools ${yesNo(readBooleanField(value, "namespaceTools"))}`,
    `image generation ${yesNo(readBooleanField(value, "imageGeneration"))}`,
    `web search ${yesNo(readBooleanField(value, "webSearch"))}`,
  ].join(", ");
}

function formatUsage(value: unknown): string {
  const byLimit = readRecord(readRecord(value)?.rateLimitsByLimitId);
  const snapshots =
    byLimit === undefined
      ? [readRecord(readRecord(value)?.rateLimits)].filter(isDefined)
      : Object.values(byLimit).map(readRecord).filter(isDefined);
  if (snapshots.length === 0) {
    return "Usage:\nNo rate-limit data returned.";
  }
  return [
    "Usage:",
    ...snapshots.slice(0, 8).map((snapshot) => {
      const name =
        readStringField(snapshot, "limitName") ?? readStringField(snapshot, "limitId") ?? "default";
      const primary = formatRateLimitWindow(readRecord(snapshot.primary));
      const secondary = formatRateLimitWindow(readRecord(snapshot.secondary));
      const credits = formatCredits(readRecord(snapshot.credits));
      const reached = readStringField(snapshot, "rateLimitReachedType");
      return `- ${name}: primary ${primary}; secondary ${secondary}; credits ${credits}${
        reached === undefined ? "" : `; limit ${reached}`
      }`;
    }),
  ].join("\n");
}

function formatRateLimitWindow(value: Record<string, unknown> | undefined): string {
  if (value === undefined) {
    return "unknown";
  }
  const usedPercent = readNumberField(value, "usedPercent");
  const duration = readNumberField(value, "windowDurationMins");
  return `${usedPercent === undefined ? "unknown" : `${Math.round(usedPercent)}%`}${
    duration === undefined ? "" : `/${duration}m`
  }`;
}

function formatCredits(value: Record<string, unknown> | undefined): string {
  if (value === undefined) {
    return "unknown";
  }
  if (readBooleanField(value, "unlimited") === true) {
    return "unlimited";
  }
  if (readBooleanField(value, "hasCredits") === false) {
    return "depleted";
  }
  return "available";
}

function formatSkillsList(value: unknown): string {
  const entries = readArrayField(value, "data").map(readRecord).filter(isDefined);
  const skills = entries
    .flatMap((entry) => readArrayField(entry, "skills"))
    .map(readRecord)
    .filter(isDefined);
  if (skills.length === 0) {
    return "Skills:\nNo skills returned.";
  }
  return [
    "Skills:",
    ...skills.slice(0, 20).map((skill) => {
      const enabled = readBooleanField(skill, "enabled") === false ? "disabled" : "enabled";
      const name = readStringField(skill, "name") ?? "unknown";
      const desc =
        readStringField(skill, "shortDescription") ?? readStringField(skill, "description") ?? "";
      return `- ${name} (${enabled})${desc.length === 0 ? "" : ` - ${truncateItemSummary(desc)}`}`;
    }),
  ].join("\n");
}

function formatPluginList(value: unknown): string {
  const marketplaces = readArrayField(value, "marketplaces").map(readRecord).filter(isDefined);
  const plugins = marketplaces
    .flatMap((marketplace) => readArrayField(marketplace, "plugins"))
    .map(readRecord)
    .filter(isDefined);
  if (plugins.length === 0) {
    return "Plugins:\nNo plugins returned.";
  }
  return [
    "Plugins:",
    ...plugins.slice(0, 20).map((plugin) => {
      const name = readStringField(plugin, "name") ?? readStringField(plugin, "id") ?? "unknown";
      const flags = [
        readBooleanField(plugin, "installed") === true ? "installed" : "not installed",
        readBooleanField(plugin, "enabled") === true ? "enabled" : "disabled",
      ].join(", ");
      return `- ${name} (${flags})`;
    }),
  ].join("\n");
}

function formatAppsList(value: unknown): string {
  const apps = readArrayField(value, "data").map(readRecord).filter(isDefined);
  if (apps.length === 0) {
    return "Apps:\nNo apps returned.";
  }
  return [
    "Apps:",
    ...apps.slice(0, 20).map((app) => {
      const name = readStringField(app, "name") ?? readStringField(app, "id") ?? "unknown";
      const flags = [
        readBooleanField(app, "isAccessible") === true ? "accessible" : "not accessible",
        readBooleanField(app, "isEnabled") === true ? "enabled" : "disabled",
      ].join(", ");
      return `- ${name} (${flags})`;
    }),
  ].join("\n");
}

function formatMcpStatus(value: unknown): string {
  const lines = ["MCP servers:", ...formatMcpToolLines(value)];
  return lines.length === 1 ? "MCP servers:\nNo MCP servers returned." : lines.join("\n");
}

function formatMcpToolLines(value: unknown): string[] {
  const servers = readArrayField(value, "data").map(readRecord).filter(isDefined);
  if (servers.length === 0) {
    return ["MCP: no servers returned"];
  }
  return servers.slice(0, 20).map((server) => {
    const name = readStringField(server, "name") ?? "unknown";
    const auth = readStringField(server, "authStatus") ?? "unknown";
    const tools = readRecord(server.tools);
    const toolNames = tools === undefined ? [] : Object.keys(tools).sort();
    const sample =
      toolNames.length === 0
        ? ""
        : ` - ${toolNames.slice(0, 4).join(", ")}${toolNames.length > 4 ? " ..." : ""}`;
    return `- ${name}: auth ${auth}, tools ${toolNames.length}${sample}`;
  });
}

function yesNo(value: boolean | undefined): string {
  return value === true ? "yes" : value === false ? "no" : "unknown";
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function summarizeCodexItem(raw: unknown): string | undefined {
  const item = readRawItem(raw);
  if (item === undefined) {
    return undefined;
  }
  const type = readStringField(item, "type");
  if (
    type === undefined ||
    type === "userMessage" ||
    type === "agentMessage" ||
    type === "reasoning"
  ) {
    return undefined;
  }

  const status = readStringField(item, "status");
  const detail = summarizeItemDetail(item, type);
  const summary = [type, status].filter((part): part is string => part !== undefined).join(" ");
  return truncateItemSummary(detail === undefined ? summary : `${summary}: ${detail}`);
}

function readRawItem(raw: unknown): Record<string, unknown> | undefined {
  const rawRecord = readRecord(raw);
  const params = readRecord(rawRecord?.params);
  return readRecord(params?.item);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function summarizeItemChanges(item: Record<string, unknown>): string | undefined {
  const changes = item.changes;
  if (!Array.isArray(changes)) {
    return undefined;
  }
  const paths = changes
    .map((change) => readStringField(change, "path"))
    .filter((path): path is string => path !== undefined)
    .slice(0, 3);
  if (paths.length === 0) {
    return undefined;
  }
  const suffix = changes.length > paths.length ? ` +${changes.length - paths.length} more` : "";
  return `${paths.join(", ")}${suffix}`;
}

function summarizeItemDetail(item: Record<string, unknown>, type: string): string | undefined {
  if (type === "fileChange") {
    return summarizeItemChanges(item);
  }
  if (type === "commandExecution") {
    return summarizeCommandExecutionItem(item);
  }
  if (type === "mcpToolCall") {
    return summarizeNamedToolItem(item, "server");
  }
  if (type === "dynamicToolCall") {
    return summarizeDynamicToolCallItem(item);
  }
  if (type === "collabAgentToolCall") {
    return readStringField(item, "tool");
  }
  if (type === "webSearch") {
    const query = readStringField(item, "query");
    return query === undefined ? undefined : redact(query);
  }
  if (type === "imageView") {
    return readStringField(item, "path");
  }
  if (type === "imageGeneration") {
    return readStringField(item, "savedPath") ?? readStringField(item, "result");
  }
  if (type === "plan") {
    const text = readStringField(item, "text");
    return text === undefined ? undefined : redact(text.replace(/\s+/g, " ").trim());
  }
  return undefined;
}

function summarizeDynamicToolCallItem(item: Record<string, unknown>): string | undefined {
  const name = summarizeNamedToolItem(item, "namespace");
  if (name === undefined) {
    return undefined;
  }
  const normalized = name.toLowerCase();
  if (normalized.includes("computer_use") || normalized.includes("computer-use")) {
    return `Computer Use ${name}`;
  }
  return name;
}

function extractCodexItemFile(raw: unknown): DaemonTurnOutputFile | undefined {
  const item = readRawItem(raw);
  if (item === undefined || readStringField(item, "type") !== "imageGeneration") {
    return undefined;
  }
  const status = readStringField(item, "status");
  if (status !== undefined && status !== "completed") {
    return undefined;
  }
  const path = readStringField(item, "savedPath");
  if (path === undefined || path.length === 0) {
    return undefined;
  }
  const filename = basename(path);
  if (filename.length === 0) {
    return undefined;
  }
  return {
    path,
    filename,
    contentType: contentTypeForPath(path),
  };
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".txt":
    case ".log":
      return "text/plain";
    case ".json":
      return "application/json";
    case ".patch":
    case ".diff":
      return "text/x-patch";
    default:
      return "application/octet-stream";
  }
}

function isAppendOnlyTextRef(ref: DaemonMessageRef | undefined): boolean {
  return ref?.kind === "text" && ref.textUpdateMode === "append";
}

function optionalMessageRefKind(
  value: unknown,
): { readonly kind: DaemonMessageRefKind } | Record<string, never> {
  return value === "inbound" || value === "text" || value === "approval_card" || value === "file"
    ? { kind: value }
    : {};
}

function optionalMessageRefTextUpdateMode(
  value: unknown,
): { readonly textUpdateMode: DaemonMessageRefTextUpdateMode } | Record<string, never> {
  return value === "edit" || value === "append" ? { textUpdateMode: value } : {};
}

function summarizeCommandExecutionItem(item: Record<string, unknown>): string | undefined {
  const command = readStringField(item, "command");
  const exitCode = readNumberField(item, "exitCode");
  const durationMs = readNumberField(item, "durationMs");
  const parts: string[] = [];
  if (command !== undefined) {
    parts.push(redact(command));
  }
  if (exitCode !== undefined) {
    parts.push(`exit ${exitCode}`);
  }
  if (durationMs !== undefined) {
    parts.push(`${durationMs}ms`);
  }
  return parts.length === 0 ? undefined : parts.join("; ");
}

function summarizeNamedToolItem(
  item: Record<string, unknown>,
  namespaceKey: string,
): string | undefined {
  const namespace = readStringField(item, namespaceKey);
  const tool = readStringField(item, "tool");
  if (namespace === undefined) {
    return tool;
  }
  if (tool === undefined) {
    return namespace;
  }
  return `${namespace}.${tool}`;
}

function parseTextApprovalAction(value: string | undefined): CallbackTokenAction | undefined {
  switch (value) {
    case "allow":
    case "allow_once":
    case "once":
      return "allow_once";
    case "allow_session":
    case "session":
      return "allow_session";
    case "decline":
    case "deny":
      return "decline";
    case "abort":
      return "abort";
    default:
      return undefined;
  }
}

function truncateItemSummary(summary: string): string {
  return summary.length <= 180 ? summary : `${summary.slice(0, 157)}...`;
}

function presence(value: string | undefined): "present" | "absent" {
  return value === undefined || value.length === 0 ? "absent" : "present";
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

function forkFailureMessage(error: unknown): string {
  if (errorMessage(error).includes("no rollout found for thread id")) {
    return "Codex thread is not ready to fork yet. Send any prompt in this thread first, then send /fork again.";
  }
  return "Codex thread failed to fork.";
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
