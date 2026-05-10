import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CodexCapabilities, type CodexRichEvent } from "@codex-im/codex-runtime";
import {
  type ActorPolicy,
  type ApprovalActor,
  type ApprovalUiAction,
  type BindResult,
  type CommandRouterResult,
  type ComputerUseAllowedTool,
  type ComputerUseCommandResult,
  ComputerUsePolicy,
  type ComputerUseProvider,
  type ComputerUseSessionRegistry,
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
import { setupComputerUseGate } from "./computer-use-wiring.js";
import {
  actorKey,
  drainShutdown,
  errorMessage,
  firstOversizedInboundAttachment,
  forkFailureMessage,
  formatAppsList,
  formatMcpStatus,
  formatMcpToolLines,
  formatModelList,
  formatModelProviderCapabilities,
  formatPluginList,
  formatSkillsList,
  formatUsage,
  generateRawCallbackToken,
  inboundAttachmentTooLargeMessage,
  isDefined,
  isRawCwdSelector,
  materializedInboundAttachments,
  optionalMessageRefKind,
  optionalMessageRefTextUpdateMode,
  parseTextApprovalAction,
  presence,
  projectDisplayNameFromCwd,
  promptInput,
  readArrayField,
  readNumberField,
  readStringField,
  redactMetadata,
  safeDisplayCwd,
  selectModelIdentifier,
  shouldSuppressAuxiliaryTurnSections,
  sleep,
  stringArray,
  targetEqual,
  targetKey,
  textInput,
} from "./format.js";
import { PruneSweep } from "./prune-sweep.js";
import { MutationRateLimit } from "./rate-limit.js";
import {
  type RemoteControlStatusUpdate,
  formatRemoteControlStatusLine,
  parseRemoteControlStatusParams,
} from "./remote-control.js";
import { type DaemonStatusSnapshot, writeDaemonStatusSnapshot } from "./status.js";
import { archiveThread, unarchiveThread } from "./thread-lifecycle.js";
import { renameThread } from "./thread-rename.js";
import { TurnOutputManager } from "./turn-output.js";

type MaybePromise<T> = T | Promise<T>;
type Unsubscribe = () => void;
type CleanupMethod = () => MaybePromise<void>;
export type DaemonSignal = "SIGINT" | "SIGTERM";
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
const DEFAULT_BIND_RETRY_DELAYS_MS = [50, 150, 350] as const;
type ComputerUseDynamicToolSpec = {
  readonly namespace?: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly deferLoading?: boolean;
};
const COMPUTER_USE_DYNAMIC_TOOL_SPEC = Object.freeze({
  namespace: "codex_im.computer_use",
  name: "operate",
  description:
    "Execute one scoped Computer Use step for the active explicit /cu session after Codex IM policy, session, and approval gates pass.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      app: {
        type: "string",
        description: "Allowed app for this /cu session, for example Google Chrome.",
      },
      step: {
        type: "string",
        description: "Short user-visible step summary.",
      },
      action: {
        type: "string",
        description: "The bounded GUI action or observation requested for this step.",
      },
      sensitivity: {
        enum: ["normal", "sensitive"],
        description: "Mark sensitive before credentials, payment, posting, deletion, or settings.",
      },
      blockedReason: {
        type: "string",
        description: "Set when the provider should stop instead of acting.",
      },
    },
    required: ["app", "step", "action"],
  },
} as const satisfies ComputerUseDynamicToolSpec);
const DEFAULT_MAX_INBOUND_ATTACHMENT_BYTES = 25 * 1024 * 1024;

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
  setStatus?(
    target: Target,
    codexThreadId: string,
    status: "open" | "archived",
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

export interface DaemonTextInput {
  readonly type: "text";
  readonly text: string;
  readonly text_elements: [];
}

interface DaemonLocalImageInput {
  readonly type: "localImage";
  readonly path: string;
}

export type DaemonUserInput = DaemonTextInput | DaemonLocalImageInput;

export interface DaemonInboundAttachment {
  readonly kind: "image" | "file";
  readonly filename: string;
  readonly contentType: string;
  readonly localPath?: string;
  readonly sizeBytes?: number;
  readonly rejectionReason?: "too_large";
}

export type DaemonMaterializedInboundAttachment = DaemonInboundAttachment & {
  readonly localPath: string;
  readonly rejectionReason?: undefined;
};

interface DaemonCodexRuntime {
  readonly events?: {
    events(): AsyncIterableIterator<CodexRichEvent>;
  };
  threadStart(params: DaemonThreadStartParams): MaybePromise<DaemonThreadStartResult>;
  threadResume?(params: DaemonThreadResumeParams): MaybePromise<unknown>;
  threadFork?(params: DaemonThreadForkParams): MaybePromise<DaemonThreadStartResult>;
  threadCompactStart?(params: { readonly threadId: string }): MaybePromise<unknown>;
  threadSetName?(params: {
    readonly threadId: string;
    readonly name: string;
  }): MaybePromise<unknown>;
  threadArchive?(params: { readonly threadId: string }): MaybePromise<unknown>;
  threadUnarchive?(params: { readonly threadId: string }): MaybePromise<unknown>;
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
  mcpServerOauthLogin?(params: {
    readonly name: string;
    readonly scopes?: readonly string[] | null;
    readonly timeoutSecs?: bigint | null;
  }): MaybePromise<unknown>;
  mcpServerReload?(): MaybePromise<unknown>;
  accountRateLimitsRead?(): MaybePromise<unknown>;
  threadList?(params: {
    readonly limit?: number | null;
    readonly archived?: boolean | null;
    readonly sortDirection?: string | null;
  }): MaybePromise<unknown>;
}

interface DaemonRuntimeProvider {
  currentRuntime(): DaemonCodexRuntime | null | undefined;
}

export interface DaemonTurnOutputState {
  readonly target: Target;
  readonly threadId: string;
  readonly turnId: string;
  readonly suppressAuxiliarySummaries: boolean;
  readonly statusSummaries: string[];
  readonly itemSummaries: string[];
  readonly files: DaemonTurnOutputFile[];
  messageRef?: DaemonMessageRef;
  lastProgressEditAtMs?: number;
  text: string;
}

export interface DaemonTurnOutputFile {
  readonly path?: string;
  readonly bytes?: Uint8Array;
  readonly filename: string;
  readonly contentType: string;
}

interface DaemonProjectConfig {
  readonly cwd: string;
  readonly defaultModel?: string;
}

interface DaemonKnownCwdEntry {
  readonly alias: string;
  readonly cwd: string;
  readonly source: "config";
  readonly defaultModel?: string;
}

interface DaemonNativeThreadEntry {
  readonly threadId: string;
  readonly title: string;
  readonly cwd: string;
  readonly updatedAt?: number;
}

interface DaemonThreadStartParams {
  readonly cwd?: string | null;
  readonly model?: string | null;
  readonly dynamicTools?: readonly ComputerUseDynamicToolSpec[];
}

interface DaemonThreadStartResult {
  readonly cwd?: string;
  readonly thread?: { readonly id?: string; readonly cwd?: string };
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
  readonly maxInboundAttachmentBytes?: number;
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
  #pruneSweep: PruneSweep | undefined;
  #mutationRateLimit: MutationRateLimit | undefined;
  readonly #capabilities = new CodexCapabilities();
  #lastRemoteControlStatus: RemoteControlStatusUpdate | undefined;
  readonly #stuckIssuedApprovalIds = new Set<string>();
  readonly #transportLostStuckIssuedApprovalIds = new Set<string>();
  readonly #unsubscribers: Unsubscribe[] = [];
  readonly #runtimeEventPumps = new WeakSet<object>();
  #turnOutputManager: TurnOutputManager | undefined;
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
      this.#turnOutputManager = new TurnOutputManager(
        this.#adapter ?? {},
        (event, detail) => {
          this.#emitAuditEvent(event, detail as never);
        },
        async (path) => (await this.options.readArtifactFile?.(path)) ?? (await readFile(path)),
        () => (this.options.now?.() ?? new Date()).getTime(),
      );
      this.#mutationRateLimit = new MutationRateLimit({
        clock: () => (this.options.now?.() ?? new Date()).getTime(),
      });
      this.#pruneSweep = new PruneSweep(
        {
          callbackTokenRepository: this.options.callbackTokenRepository,
          broker: this.#broker,
        },
        {
          stuckIssuedApprovalIds: this.#stuckIssuedApprovalIds,
          transportLostStuckIssuedApprovalIds: this.#transportLostStuckIssuedApprovalIds,
        },
        (event, detail) => {
          this.#emitAuditEvent(event, detail as never);
        },
        () => this.options.now?.() ?? new Date(),
        {
          pruneIntervalMs: this.options.pruneIntervalMs,
          pruneBatchSize: this.options.pruneBatchSize,
          stuckIssuedGraceMs: this.options.stuckIssuedGraceMs,
          terminalRecordMaxAgeMs: this.options.terminalRecordMaxAgeMs,
          terminalRecordMaxCount: this.options.terminalRecordMaxCount,
          schedulePrune: this.options.schedulePrune,
        },
      );
      this.#revokeStartupCallbackTokens();
      this.#subscribe(
        this.#broker?.onPendingCreated?.((snapshot) => {
          this.#pruneSweep?.maybeTriggerEager();
          void this.#handlePendingCreated(snapshot);
        }),
      );
      this.#subscribe(this.#adapter?.onAction((action) => this.#handleAction(action)));
      this.#subscribe(this.#adapter?.onMessage((message) => this.#handleMessage(message)));
      this.#subscribe(this.options.registerSignalHandler?.("SIGTERM", () => this.#handleSignal()));
      this.#subscribe(this.options.registerSignalHandler?.("SIGINT", () => this.#handleSignal()));
      this.#subscribe(this.#pruneSweep?.schedule());
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
    this.#turnOutputManager?.clear();
    this.#turnOutputManager = undefined;
    this.#mutationRateLimit = undefined;
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
    const audit = this.#computerUseAuditEmitter();
    const provider =
      this.options.computerUseProvider ?? new UnsupportedComputerUseProvider({ audit });
    const result = setupComputerUseGate({
      broker: this.#broker,
      config: this.#config,
      provider,
      audit,
      ...(this.options.computerUseAllowedTools === undefined
        ? {}
        : { allowedTools: this.options.computerUseAllowedTools }),
    });
    this.#computerUsePolicy = result.policy;
    this.#computerUseRegistry = result.registry;
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
    this.#turnOutputManager?.clear();
    this.#turnOutputManager = undefined;
    this.#mutationRateLimit = undefined;
  }

  #runSyncCleanup(cleanup: CleanupMethod): void {
    try {
      void cleanup();
    } catch (error) {
      // Best-effort rollback must not hide the original startup failure,
      // but it must not silently lose the cleanup error either.
      this.#emitAuditEvent("daemon.cleanup_failed", {
        result: "failed",
        metadata: { error: errorMessage(error), phase: "sync" },
      });
    }
  }

  async #runAsyncCleanup(cleanup: CleanupMethod | undefined): Promise<void> {
    if (cleanup === undefined) {
      return;
    }
    try {
      await cleanup();
    } catch (error) {
      this.#emitAuditEvent("daemon.cleanup_failed", {
        result: "failed",
        metadata: { error: errorMessage(error), phase: "async" },
      });
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
    let target: Target | null | undefined;
    try {
      target = await this.options.resolveApprovalTarget?.(snapshot);
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
    } catch (error) {
      // Pending-created subscribers must not destabilize the broker, but
      // a silent failure here means an approval IM card was never sent
      // and the user has no idea their request is dangling. Audit so
      // operators / on-call can correlate.
      this.#emitAuditEvent("approval.send_failed", {
        approvalId: snapshot.id,
        ...(target === undefined || target === null ? {} : { target }),
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
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

      const oversizedAttachment = firstOversizedInboundAttachment(
        inbound.attachments,
        this.#maxInboundAttachmentBytes(),
      );
      if (oversizedAttachment !== undefined) {
        this.#emitAuditEvent("inbound.attachment_too_large", {
          target: inbound.target,
          result: "denied",
          metadata: {
            actorKey: actorKey(inbound.target, inbound.sender),
            kind: oversizedAttachment.kind,
            contentType: oversizedAttachment.contentType,
            sizeBytes: oversizedAttachment.sizeBytes,
            maxBytes: this.#maxInboundAttachmentBytes(),
          },
        });
        await this.#editInboundMessage(
          inbound.messageRef,
          inboundAttachmentTooLargeMessage(this.#maxInboundAttachmentBytes()),
        );
        return;
      }

      const materializedAttachments = materializedInboundAttachments(inbound.attachments);
      const routed = routeInboundCommand(inbound.text, { attachments: materializedAttachments });
      this.#emitAuditEvent("inbound.message_allowed", {
        target: inbound.target,
        result: "allowed",
        metadata: {
          actorKey: actorKey(inbound.target, inbound.sender),
          routeKind: routed.kind,
          textLength: inbound.text.length,
          attachmentCount: materializedAttachments.length,
          imageAttachmentCount: materializedAttachments.filter(
            (attachment) => attachment.kind === "image",
          ).length,
          fileAttachmentCount: materializedAttachments.filter(
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
    } catch (error) {
      // Daemon-level audit is best-effort and must not mutate control
      // flow. Cannot recursively call #emitAuditEvent here (would risk
      // unbounded loop on a broken audit sink). Stderr surface is the
      // operator's signal of last resort.
      console.warn(
        `[daemon] audit emit failed for action=${action}: ${redact(errorMessage(error))}`,
      );
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
        ...(input.route?.projectId === undefined ? {} : { projectId: input.route.projectId }),
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
    const provider = this.options.computerUseProvider === undefined ? "unavailable" : "configured";
    const readiness = this.#computerUseReadiness(policy);
    const defaultApp = snapshot.defaultApp === undefined ? "<none>" : redact(snapshot.defaultApp);
    const allowedApps =
      snapshot.allowedApps.length === 0 ? "<none>" : snapshot.allowedApps.map(redact).join(", ");
    const denyApps =
      snapshot.denyApps.length === 0 ? "<none>" : snapshot.denyApps.map(redact).join(", ");
    const approvalKeywords =
      snapshot.requireApprovalKeywords.length === 0
        ? "<none>"
        : snapshot.requireApprovalKeywords.map(redact).join(", ");
    return [
      `Computer Use: ${enabled}`,
      `Provider: ${provider}`,
      `Readiness: ${readiness}`,
      `Policy: ${snapshot.valid ? "valid" : "invalid"} ${snapshot.version}, explicit /cu ${
        snapshot.requireExplicitPrefix ? "required" : "not required"
      }`,
      `Default app: ${defaultApp}`,
      `Allowed apps: ${allowedApps}`,
      `Denied apps: ${denyApps}`,
      `Sensitive approval keywords: ${approvalKeywords}`,
      `Live smoke: ${snapshot.liveSmokeEnabled ? "enabled" : "disabled"}`,
    ].join("\n");
  }

  #computerUseStatusLine(policy: ComputerUsePolicy): string {
    const snapshot = policy.snapshot;
    const enabled = snapshot.enabled && snapshot.valid ? "enabled" : "disabled";
    const defaultApp = snapshot.defaultApp === undefined ? "<none>" : redact(snapshot.defaultApp);
    return `${enabled}, ${this.#computerUseReadiness(policy)}, default app ${defaultApp}, live smoke ${
      snapshot.liveSmokeEnabled ? "enabled" : "disabled"
    }`;
  }

  #computerUseReadiness(policy: ComputerUsePolicy): string {
    const snapshot = policy.snapshot;
    if (!snapshot.valid) {
      return `blocked: ${snapshot.invalidReason ?? "invalid_policy"}`;
    }
    if (!snapshot.enabled) {
      return "blocked: policy_disabled";
    }
    const policyDecision = policy.check({ task: "readiness probe" });
    if (policyDecision.kind === "deny") {
      return `blocked: ${policyDecision.reason}`;
    }
    if (this.options.computerUseProvider === undefined) {
      return "blocked: provider_unavailable";
    }
    return "ready";
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

  #projectAllowed(
    projectId: string | undefined,
    target: Target,
    sender: SecurityPolicySender,
  ): boolean {
    if (projectId === undefined) {
      return true;
    }
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
    attachments: readonly DaemonMaterializedInboundAttachment[],
  ): Promise<void> {
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const runtime = this.#currentRuntime();
    if (sessionRouter === undefined || runtime === undefined) {
      return;
    }
    this.#ensureRuntimeEventPump(runtime);

    const initialRoute = sessionRouter.resolve(inbound.target);
    if (
      initialRoute.kind === "bound" &&
      !this.#projectAllowed(initialRoute.projectId, inbound.target, inbound.sender)
    ) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return;
    }

    const hadPersistedThread =
      initialRoute.kind === "bound" && initialRoute.codexThreadId !== undefined;
    let route =
      initialRoute.kind === "bound"
        ? await this.#ensureBoundCodexThread(sessionRouter, runtime, inbound, initialRoute)
        : await this.#startDefaultCodexThread(sessionRouter, runtime, inbound);
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
      startedTurn = await this.#startPromptTurn(runtime, route, input, {
        includeThreadOverrides: hadPersistedThread,
      });
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
        startedTurn = await this.#startPromptTurn(runtime, freshRoute, input, {
          includeThreadOverrides: false,
        });
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
      await this.#turnOutputManager?.open(
        inbound.target,
        route.codexThreadId,
        activeTurnId,
        shouldSuppressAuxiliaryTurnSections(inbound.target, text),
      );
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
      const cwd = this.#threadCwd(startedThread) ?? route.cwd;
      const routeForPersist = { ...route, cwd };
      this.#persistThreadSessionBestEffort(inbound.target, routeForPersist, threadId);
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

  async #startDefaultCodexThread(
    sessionRouter: DaemonSessionRouter,
    runtime: DaemonCodexRuntime,
    inbound: { target: Target; messageRef?: DaemonMessageRef },
  ): Promise<(Extract<SessionRoute, { kind: "bound" }> & { codexThreadId: string }) | undefined> {
    if (sessionRouter.bind === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Binding store unavailable");
      return undefined;
    }
    try {
      const startedThread = await runtime.threadStart({});
      const threadId = this.#threadId(startedThread);
      const cwd = this.#threadCwd(startedThread);
      if (threadId === undefined || cwd === undefined) {
        await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to start.");
        return undefined;
      }
      const route = sessionRouter.bind(inbound.target, {
        contextKind: "app_default",
        projectLabel: "Codex default",
        cwd,
        codexThreadId: threadId,
      });
      if (route.kind !== "bound" || route.codexThreadId === undefined) {
        await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to bind.");
        return undefined;
      }
      this.#persistThreadSessionBestEffort(inbound.target, route, threadId);
      return { ...route, codexThreadId: route.codexThreadId };
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
        ...(route.contextKind === undefined ? {} : { contextKind: route.contextKind }),
        ...(route.projectId === undefined ? {} : { projectId: route.projectId }),
        ...(route.projectLabel === undefined ? {} : { projectLabel: route.projectLabel }),
        cwd: route.cwd,
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
    opts: { readonly includeThreadOverrides?: boolean } = {},
  ): Promise<DaemonTurnStartResult> {
    return Promise.resolve(
      runtime.turnStart({
        threadId: route.codexThreadId,
        input,
        ...(opts.includeThreadOverrides === true ? { cwd: route.cwd } : {}),
        ...(opts.includeThreadOverrides === true && route.defaultModel !== undefined
          ? { model: route.defaultModel }
          : {}),
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
    const iterator = events.call(runtime.events);
    void (async () => {
      try {
        for await (const event of iterator) {
          if (event.type === "unknown" && event.method === "remoteControl/status/changed") {
            const update = parseRemoteControlStatusParams(event.params);
            if (update !== undefined) {
              this.#lastRemoteControlStatus = update;
            }
          }
          const signal = await this.#turnOutputManager?.handle(event);
          if (signal?.kind === "turn_terminal") {
            this.#clearTerminalActiveTurn(signal.target, signal.threadId, signal.turnId);
          }
        }
      } catch (error) {
        this.#emitAuditEvent("runtime.event_pump_failed", {
          result: "failed",
          metadata: { error: errorMessage(error) },
        });
      }
    })();
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
      ...(route.contextKind !== undefined ? { contextKind: route.contextKind } : {}),
      ...(route.projectId !== undefined ? { projectId: route.projectId } : {}),
      ...(route.projectLabel !== undefined ? { projectLabel: route.projectLabel } : {}),
      cwd: route.cwd,
      codexThreadId: route.codexThreadId,
      ...(route.defaultModel === undefined ? {} : { defaultModel: route.defaultModel }),
    });
  }

  async #routeComputerUse(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: ComputerUseCommandResult,
  ): Promise<void> {
    const policy = this.#computerUsePolicy ?? new ComputerUsePolicy();
    if (command.action === "status") {
      // /cu status is a read-only diagnostic; not subject to mutation
      // rate limiting.
      await this.#editInboundMessage(inbound.messageRef, this.#computerUseStatusText(policy));
      return;
    }
    if (await this.#enforceMutationRateLimit(inbound, "cu")) return;

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
      const startedThread = await runtime.threadStart(
        this.#threadStartParams(route, { computerUse: true }),
      );
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
      ...(route.projectId === undefined ? {} : { projectId: route.projectId }),
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

    if (command.name === "cwds") {
      await this.#routeCwdsCommand(inbound);
      return;
    }

    if (command.name === "projects") {
      await this.#routeCwdsCommand(inbound);
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

    if (command.name === "rename") {
      await this.#routeRenameCommand(inbound, command);
      return;
    }

    if (command.name === "archive") {
      await this.#routeArchiveCommand(inbound, command);
      return;
    }

    if (command.name === "unarchive") {
      await this.#routeUnarchiveCommand(inbound, command);
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
      await this.#routeModelCommand(inbound, command);
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
      await this.#routeMcpCommand(inbound, command);
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
        "Send any non-command message as a Codex prompt for the current thread.",
        "/start - Show these commands.",
        "/projects - List Codex projects available to this IM chat.",
        "/use <project> - Select a project by number or name.",
        "/status - Show current Codex IM status.",
        "/whoami - Show redacted IM identity and current binding.",
        "/new [project] [task] - Start a new Codex conversation in a project.",
        "/threads - List native Codex conversations.",
        "/switch <thread> - Resume and switch to a known Codex conversation.",
        "/alias <title> - Rename current thread for IM display.",
        "/fork [thread] - Fork the current or selected Codex thread.",
        "/stop - Interrupt the active Codex turn.",
        "/model [model] - List available Codex models or set this IM thread model.",
        "/compact - Start Codex compaction for the current thread.",
        "/usage - Show Codex account usage/rate-limit status.",
        "/diagnostics - Show runtime, IM, tool, and Computer Use readiness.",
        "/tools - Show model-provider and MCP tool capabilities.",
        "/skills - List Codex skills visible to the current cwd.",
        "/plugins - List Codex plugins visible to the current cwd.",
        "/apps - List Codex app/connectors visible to the current thread.",
        "/mcp [login <server>|reload] - List MCP server status or start native MCP auth.",
        "/approvals - List pending approvals for this chat.",
        "/approve <id> <action> - Text fallback for approval buttons.",
        "Completed file, command, and tool activity may appear as Codex items.",
      ].join("\n"),
    );
  }

  async #routeCwdsCommand(inbound: {
    target: Target;
    sender: SecurityPolicySender;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
    const entries = this.#knownConfigCwds(inbound.target, inbound.sender);
    const nativeConversationCounts = new Map<string, number>();
    const runtime = this.#currentRuntime();
    if (runtime?.threadList !== undefined) {
      try {
        for (const thread of this.#nativeThreadEntries(
          await runtime.threadList({ limit: 50, archived: false, sortDirection: "desc" }),
        )) {
          nativeConversationCounts.set(
            thread.cwd,
            (nativeConversationCounts.get(thread.cwd) ?? 0) + 1,
          );
        }
      } catch (error) {
        this.#emitAuditEvent("runtime.thread_list_failed", {
          target: inbound.target,
          result: "failed",
          metadata: { error: errorMessage(error) },
        });
      }
    }
    const configuredCwds = new Set(entries.map((entry) => entry.cwd));
    const discoveredEntries = Array.from(nativeConversationCounts.entries())
      .filter(([cwd]) => !configuredCwds.has(cwd))
      .map(([cwd, count]) => ({ cwd, count, label: projectDisplayNameFromCwd(cwd) }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.cwd.localeCompare(b.cwd));

    if (entries.length === 0 && discoveredEntries.length === 0) {
      await this.#editInboundMessage(inbound.messageRef, "No projects available.");
      return;
    }

    const lines = [
      "Projects:",
      ...entries.map((entry, index) => {
        const marker =
          route?.kind === "bound" && (route.projectId === entry.alias || route.cwd === entry.cwd)
            ? "*"
            : " ";
        const conversationCount = nativeConversationCounts.get(entry.cwd);
        const details = [
          marker === "*" ? "current" : undefined,
          entry.defaultModel === undefined ? undefined : `model: ${entry.defaultModel}`,
          conversationCount === undefined ? undefined : `conversations: ${conversationCount}`,
          `use: /use ${index + 1}`,
          `new: /new ${index + 1} <task>`,
        ].filter(isDefined);
        return `${marker} ${index + 1}. ${entry.alias}\n${details.join("\n")}`;
      }),
      ...discoveredEntries.map((entry, offset) => {
        const selector = entries.length + offset + 1;
        const marker = route?.kind === "bound" && route.cwd === entry.cwd ? "*" : " ";
        const details = [
          marker === "*" ? "current" : undefined,
          `conversations: ${entry.count}`,
          "resume: /threads",
        ].filter(isDefined);
        return `${marker} ${selector}. ${entry.label}\n${details.join("\n")}`;
      }),
    ];
    await this.#editInboundMessage(inbound.messageRef, lines.join("\n"));
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
    const runtime = this.#currentRuntime();
    if (runtime?.threadList !== undefined) {
      try {
        const nativeThreads = this.#nativeThreadEntries(
          await runtime.threadList({ limit: 20, archived: false, sortDirection: "desc" }),
        );
        if (nativeThreads.length > 0) {
          await this.#editInboundMessage(
            inbound.messageRef,
            [
              "Recent Codex threads:",
              ...nativeThreads.map((thread, index) =>
                this.#formatNativeThreadListLine(index + 1, thread),
              ),
              "Use:",
              "/switch 1",
            ].join("\n"),
          );
          return;
        }
      } catch (error) {
        this.#emitAuditEvent("runtime.thread_list_failed", {
          target: inbound.target,
          result: "failed",
          metadata: { error: errorMessage(error) },
        });
      }
    }

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
    if (await this.#enforceMutationRateLimit(inbound, "switch")) return;
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

    if (runtime.threadList !== undefined) {
      const nativeThreads = this.#nativeThreadEntries(
        await runtime.threadList({ limit: 20, archived: false, sortDirection: "desc" }),
      );
      const nativeSelected = this.#selectNativeThread(nativeThreads, selector);
      if (nativeSelected.kind === "ambiguous") {
        await this.#editInboundMessage(
          inbound.messageRef,
          "Ambiguous thread selector. Use the number from /threads.",
        );
        return;
      }
      if (nativeSelected.kind === "selected") {
        await this.#switchNativeThread(inbound, nativeSelected.thread, nativeSelected.index);
        return;
      }
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

    if (selected.record.projectId === undefined) {
      if (selected.record.cwd === undefined) {
        await this.#editInboundMessage(
          inbound.messageRef,
          "This conversation is missing its saved Codex context. Send /threads while Codex runtime is available.",
        );
        return;
      }
      const projectLabel = this.#sessionProjectLabel(selected.record);
      const currentRoute = sessionRouter.resolve(inbound.target);
      const selectedIsCurrent =
        currentRoute.kind === "bound" &&
        currentRoute.codexThreadId === selected.record.codexThreadId;
      if (!selectedIsCurrent) {
        try {
          await runtime.threadResume({
            threadId: selected.record.codexThreadId,
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
          contextKind: selected.record.contextKind ?? "native_thread",
          projectLabel,
          codexThreadId: selected.record.codexThreadId,
          cwd: selected.record.cwd,
          now: this.#nowIso(),
        });
        sessionRouter.replaceCachedBinding(inbound.target, {
          contextKind: selected.record.contextKind ?? "native_thread",
          projectLabel,
          cwd: selected.record.cwd,
          codexThreadId: selected.record.codexThreadId,
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
        `Switched to ${selected.index + 1} ${projectLabel} (${this.#shortId(
          selected.record.codexThreadId,
        )})`,
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
      `Switched to ${selected.index + 1} ${this.#sessionProjectLabel(selected.record)} (${this.#shortId(
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
      lines.push(formatRemoteControlStatusLine(this.#lastRemoteControlStatus));
      await this.#editInboundMessage(inbound.messageRef, lines.join("\n"));
      return;
    }

    lines.push("binding: bound");
    lines.push(`project: ${this.#routeProjectLabel(route)}`);
    lines.push(`thread: ${this.#shortId(route.codexThreadId)}`);
    const title = this.#threadTitleForRoute(inbound.target, route);
    if (title !== undefined) {
      lines.push(`title: ${title}`);
    }
    lines.push(`active turn: ${this.#shortId(route.activeTurnId)}`);
    lines.push(`pending approvals: ${this.#pendingApprovalCount()}`);
    lines.push(formatRemoteControlStatusLine(this.#lastRemoteControlStatus));
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
      lines.push(`project: ${this.#routeProjectLabel(route)}`);
      lines.push(`thread: ${this.#shortId(route.codexThreadId)}`);
    }
    await this.#editInboundMessage(inbound.messageRef, lines.join("\n"));
  }

  async #routeModelCommand(
    inbound: {
      target: Target;
      sender: SecurityPolicySender;
      messageRef?: DaemonMessageRef;
    },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    const runtime = this.#currentRuntime();
    if (runtime?.modelList === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex model list unavailable.");
      return;
    }

    try {
      const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
      const response = await runtime.modelList({ limit: 20, includeHidden: false });
      const [selector] = command.args;
      if (selector !== undefined) {
        await this.#setCurrentModel(inbound, response, selector);
        return;
      }
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

  async #setCurrentModel(
    inbound: {
      target: Target;
      sender: SecurityPolicySender;
      messageRef?: DaemonMessageRef;
    },
    modelListResponse: unknown,
    selector: string,
  ): Promise<void> {
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const route = sessionRouter?.resolve(inbound.target);
    if (route?.kind !== "bound") {
      await this.#editInboundMessage(
        inbound.messageRef,
        "No project selected. Send /projects, then /use <number>.",
      );
      return;
    }
    if (!this.#projectAllowed(route.projectId, inbound.target, inbound.sender)) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return;
    }
    if (sessionRouter?.bind === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Model selection store unavailable.");
      return;
    }

    const selectedModel = selectModelIdentifier(modelListResponse, selector);
    if (selectedModel === undefined) {
      await this.#editInboundMessage(inbound.messageRef, `Unknown model: ${redact(selector)}`);
      return;
    }

    sessionRouter.bind(inbound.target, {
      ...(route.contextKind !== undefined ? { contextKind: route.contextKind } : {}),
      ...(route.projectId !== undefined ? { projectId: route.projectId } : {}),
      ...(route.projectLabel !== undefined ? { projectLabel: route.projectLabel } : {}),
      cwd: route.cwd,
      ...(route.codexThreadId === undefined ? {} : { codexThreadId: route.codexThreadId }),
      defaultModel: selectedModel,
      ...(route.activeTurnId === undefined ? {} : { activeTurnId: route.activeTurnId }),
    });
    await this.#editInboundMessage(
      inbound.messageRef,
      `Model set for this IM thread: ${redact(selectedModel)}`,
    );
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
      lines.push(`cwd: ${safeDisplayCwd(route.cwd)}`);
      lines.push(`cwd alias: ${this.#routeProjectLabel(route)}`);
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

  async #routeMcpCommand(
    inbound: {
      target: Target;
      sender: SecurityPolicySender;
      messageRef?: DaemonMessageRef;
    },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    const [subcommand, ...args] = command.args;
    if (subcommand !== undefined) {
      const normalized = subcommand.toLowerCase();
      if (normalized === "login") {
        await this.#routeMcpLoginCommand(inbound, args);
        return;
      }
      if (normalized === "reload") {
        await this.#routeMcpReloadCommand(inbound);
        return;
      }
      await this.#editInboundMessage(inbound.messageRef, "Usage: /mcp [login <server>|reload]");
      return;
    }

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

  async #routeMcpLoginCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    args: readonly string[],
  ): Promise<void> {
    const [serverName] = args;
    if (serverName === undefined || serverName.length === 0) {
      await this.#editInboundMessage(inbound.messageRef, "Usage: /mcp login <server>");
      return;
    }
    const runtime = this.#currentRuntime();
    if (runtime?.mcpServerOauthLogin === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex MCP login unavailable.");
      return;
    }
    if (!(await this.#currentProjectAllowed(inbound))) {
      return;
    }

    try {
      const response = await runtime.mcpServerOauthLogin({ name: serverName });
      const authorizationUrl = readStringField(response, "authorizationUrl");
      if (authorizationUrl === undefined || authorizationUrl.length === 0) {
        await this.#editInboundMessage(inbound.messageRef, "Codex MCP login did not return a URL.");
        return;
      }
      await this.#editInboundMessage(
        inbound.messageRef,
        `MCP login for ${redact(serverName)}:\n${authorizationUrl}`,
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.mcp_login_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), server: serverName },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex MCP login failed.");
    }
  }

  async #routeMcpReloadCommand(inbound: {
    target: Target;
    sender: SecurityPolicySender;
    messageRef?: DaemonMessageRef;
  }): Promise<void> {
    const runtime = this.#currentRuntime();
    if (runtime?.mcpServerReload === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex MCP reload unavailable.");
      return;
    }
    if (!(await this.#currentProjectAllowed(inbound))) {
      return;
    }

    try {
      await runtime.mcpServerReload();
      await this.#editInboundMessage(inbound.messageRef, "MCP servers reloaded.");
    } catch (error) {
      this.#emitAuditEvent("runtime.mcp_reload_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex MCP reload failed.");
    }
  }

  async #currentProjectAllowed(inbound: {
    target: Target;
    sender: SecurityPolicySender;
    messageRef?: DaemonMessageRef;
  }): Promise<boolean> {
    const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
    if (route?.kind !== "bound") {
      await this.#editInboundMessage(
        inbound.messageRef,
        "No project selected. Send /projects, then /use <number>.",
      );
      return false;
    }
    if (!this.#projectAllowed(route.projectId, inbound.target, inbound.sender)) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return false;
    }
    return true;
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
          ...(route.contextKind === undefined ? {} : { contextKind: route.contextKind }),
          ...(route.projectId === undefined ? {} : { projectId: route.projectId }),
          ...(route.projectLabel === undefined ? {} : { projectLabel: route.projectLabel }),
          cwd: route.cwd,
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

  async #routeRenameCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    if (await this.#enforceMutationRateLimit(inbound, "rename")) return;
    const title = this.#threadTitleFromArgs(command.args);
    if (title === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Usage: /rename <title>");
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

    const outcome = await renameThread(
      {
        runtime: this.#currentRuntime() ?? undefined,
        capabilities: this.#capabilities,
        threadSessions: repository,
        nowIso: () => this.#nowIso(),
      },
      inbound.target,
      route.codexThreadId,
      title,
    );

    if (outcome.kind === "remote_renamed") {
      await this.#editInboundMessage(inbound.messageRef, `Thread renamed: ${title}`);
      return;
    }
    if (outcome.kind === "local_only") {
      const note =
        outcome.reason === "no_runtime"
          ? "Codex runtime unavailable"
          : "codex thread/name/set not supported by this server";
      await this.#editInboundMessage(
        inbound.messageRef,
        `Thread alias set locally: ${title} (${note}; codex-side name unchanged)`,
      );
      return;
    }
    // failed
    this.#emitAuditEvent("thread.rename_failed", {
      target: inbound.target,
      result: "failed",
      metadata: { error: outcome.error, threadId: route.codexThreadId },
    });
    await this.#editInboundMessage(inbound.messageRef, `Thread rename failed: ${outcome.error}`);
  }

  async #routeArchiveCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    _command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    if (await this.#enforceMutationRateLimit(inbound, "archive")) return;
    const setup = await this.#resolveLifecycleTarget(inbound);
    if (setup === undefined) return;

    const outcome = await archiveThread(
      {
        runtime: this.#currentRuntime() ?? undefined,
        capabilities: this.#capabilities,
        threadSessions: setup.repository,
        nowIso: () => this.#nowIso(),
      },
      inbound.target,
      setup.codexThreadId,
    );
    await this.#renderLifecycleOutcome(inbound, outcome, "archive", setup.codexThreadId);
  }

  async #routeUnarchiveCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    _command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    if (await this.#enforceMutationRateLimit(inbound, "unarchive")) return;
    const setup = await this.#resolveLifecycleTarget(inbound);
    if (setup === undefined) return;

    const outcome = await unarchiveThread(
      {
        runtime: this.#currentRuntime() ?? undefined,
        capabilities: this.#capabilities,
        threadSessions: setup.repository,
        nowIso: () => this.#nowIso(),
      },
      inbound.target,
      setup.codexThreadId,
    );
    await this.#renderLifecycleOutcome(inbound, outcome, "unarchive", setup.codexThreadId);
  }

  async #resolveLifecycleTarget(inbound: {
    target: Target;
    sender: SecurityPolicySender;
    messageRef?: DaemonMessageRef;
  }): Promise<{ repository: DaemonThreadSessionRepository; codexThreadId: string } | undefined> {
    const route = this.#daemonSessionRouter(this.#sessionRouter)?.resolve(inbound.target);
    if (route?.kind !== "bound" || route.codexThreadId === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "No current Codex thread.");
      return undefined;
    }
    if (!this.#projectAllowed(route.projectId, inbound.target, inbound.sender)) {
      await this.#editInboundMessage(inbound.messageRef, "Project access denied");
      return undefined;
    }
    const repository = this.#threadSessionRepository();
    if (repository === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Thread session store unavailable.");
      return undefined;
    }
    return { repository, codexThreadId: route.codexThreadId };
  }

  async #renderLifecycleOutcome(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    outcome:
      | { kind: "remote_changed" }
      | { kind: "local_only"; reason: "unsupported" | "no_runtime" | "no_storage" }
      | { kind: "failed"; error: string },
    op: "archive" | "unarchive",
    codexThreadId: string,
  ): Promise<void> {
    const verb = op === "archive" ? "archived" : "reopened";
    const method = op === "archive" ? "thread/archive" : "thread/unarchive";
    if (outcome.kind === "remote_changed") {
      await this.#editInboundMessage(inbound.messageRef, `Thread ${verb}.`);
      return;
    }
    if (outcome.kind === "local_only") {
      const note =
        outcome.reason === "no_runtime"
          ? "Codex runtime unavailable"
          : outcome.reason === "no_storage"
            ? "thread session store unavailable"
            : `codex ${method} not supported by this server`;
      await this.#editInboundMessage(
        inbound.messageRef,
        `Thread ${verb} locally (${note}; codex-side state unchanged).`,
      );
      return;
    }
    this.#emitAuditEvent(`thread.${op}_failed`, {
      target: inbound.target,
      result: "failed",
      metadata: { error: outcome.error, threadId: codexThreadId },
    });
    await this.#editInboundMessage(inbound.messageRef, `Thread ${op} failed: ${outcome.error}`);
  }

  /**
   * Slice 2.1 hardening item #6: enforce a sliding-window rate limit on
   * mutation commands. Returns true when the request was denied (caller
   * should immediately return); false when the request is admitted.
   *
   * Denial side-effects: edit the inbound message with an IM-friendly
   * "Try again in N seconds" reply, and emit `inbound.rate_limited`
   * audit so operators can correlate.
   */
  async #enforceMutationRateLimit(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    commandLabel: string,
  ): Promise<boolean> {
    const decision = this.#mutationRateLimit?.check(inbound.sender, inbound.target);
    if (decision === undefined || decision.kind !== "deny") {
      return false;
    }
    const retrySec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    await this.#editInboundMessage(
      inbound.messageRef,
      `Rate limited. Try again in ${retrySec} seconds.`,
    );
    this.#emitAuditEvent("inbound.rate_limited", {
      target: inbound.target,
      result: "denied",
      metadata: {
        command: commandLabel,
        retryAfterMs: decision.retryAfterMs,
        limit: decision.limit,
      },
    });
    return true;
  }

  async #routeNewCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    if (await this.#enforceMutationRateLimit(inbound, "new")) return;
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

    const [firstArg] = command.args;
    if (firstArg !== undefined && isRawCwdSelector(firstArg)) {
      await this.#editInboundMessage(
        inbound.messageRef,
        "IM cannot accept raw cwd paths. Use /projects, then /new <number> <task>.",
      );
      return;
    }

    const selectedCwd =
      firstArg === undefined
        ? undefined
        : this.#resolveKnownConfigCwd(firstArg, inbound.target, inbound.sender);
    if (selectedCwd !== undefined) {
      await this.#routeNewInKnownCwd(inbound, selectedCwd, command.args.slice(1).join(" ").trim());
      return;
    }

    const route = sessionRouter.resolve(inbound.target);
    if (route.kind !== "bound") {
      await this.#routeNewInDefaultContext(inbound, command.args.join(" ").trim());
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
        ...(route.contextKind === undefined ? {} : { contextKind: route.contextKind }),
        ...(route.projectId === undefined ? {} : { projectId: route.projectId }),
        ...(route.projectLabel === undefined ? {} : { projectLabel: route.projectLabel }),
        cwd: route.cwd,
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

  async #routeNewInKnownCwd(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    entry: DaemonKnownCwdEntry,
    task: string,
  ): Promise<void> {
    const runtime = this.#currentRuntime();
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const threadSessions = this.#threadSessionRepository();
    if (runtime === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex runtime unavailable.");
      return;
    }
    if (sessionRouter?.bind === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Binding store unavailable");
      return;
    }
    if (threadSessions === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Thread session store unavailable.");
      return;
    }

    let threadId: string | undefined;
    try {
      threadId = this.#threadId(
        await runtime.threadStart({
          cwd: entry.cwd,
          ...(entry.defaultModel === undefined ? {} : { model: entry.defaultModel }),
        }),
      );
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

    try {
      threadSessions.upsert({
        target: inbound.target,
        projectId: entry.alias,
        cwd: entry.cwd,
        codexThreadId: threadId,
        now: this.#nowIso(),
      });
      sessionRouter.bind(inbound.target, {
        projectId: entry.alias,
        cwd: entry.cwd,
        codexThreadId: threadId,
        ...(entry.defaultModel === undefined ? {} : { defaultModel: entry.defaultModel }),
      });
    } catch (error) {
      this.#emitAuditEvent("thread_session.write_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to save.");
      return;
    }

    if (task.length === 0) {
      await this.#editInboundMessage(
        inbound.messageRef,
        `New Codex conversation ${this.#shortId(threadId)} in project ${entry.alias}`,
      );
      return;
    }

    try {
      const startedTurn = await runtime.turnStart({
        threadId,
        input: promptInput(task, []),
      });
      const activeTurnId = this.#turnId(startedTurn);
      if (activeTurnId !== undefined) {
        sessionRouter.bind(inbound.target, {
          projectId: entry.alias,
          cwd: entry.cwd,
          codexThreadId: threadId,
          ...(entry.defaultModel === undefined ? {} : { defaultModel: entry.defaultModel }),
          activeTurnId,
        });
        await this.#turnOutputManager?.open(inbound.target, threadId, activeTurnId, false);
      }
      await this.#editInboundMessage(
        inbound.messageRef,
        `New Codex conversation ${this.#shortId(threadId)} in project ${entry.alias}${activeTurnId === undefined ? "" : `\nturn: ${this.#shortId(activeTurnId)}`}`,
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.turn_start_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex turn failed to start.");
    }
  }

  async #routeNewInDefaultContext(
    inbound: { target: Target; messageRef?: DaemonMessageRef },
    task: string,
  ): Promise<void> {
    const runtime = this.#currentRuntime();
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const threadSessions = this.#threadSessionRepository();
    if (runtime === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex runtime unavailable.");
      return;
    }
    if (sessionRouter?.bind === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Binding store unavailable");
      return;
    }
    if (threadSessions === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Thread session store unavailable.");
      return;
    }

    let threadId: string | undefined;
    let cwd: string | undefined;
    try {
      const startedThread = await runtime.threadStart({});
      threadId = this.#threadId(startedThread);
      cwd = this.#threadCwd(startedThread);
    } catch (error) {
      this.#emitAuditEvent("runtime.thread_start_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to start.");
      return;
    }
    if (threadId === undefined || cwd === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to start.");
      return;
    }

    const title = task.length === 0 ? undefined : task;
    try {
      threadSessions.upsert({
        target: inbound.target,
        contextKind: "app_default",
        projectLabel: "Codex default",
        cwd,
        codexThreadId: threadId,
        ...(title === undefined ? {} : { title }),
        now: this.#nowIso(),
      });
      sessionRouter.bind(inbound.target, {
        contextKind: "app_default",
        projectLabel: "Codex default",
        cwd,
        codexThreadId: threadId,
      });
    } catch (error) {
      this.#emitAuditEvent("thread_session.write_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to save.");
      return;
    }

    if (task.length === 0) {
      await this.#editInboundMessage(
        inbound.messageRef,
        `New Codex conversation ${this.#shortId(threadId)} in project Codex default`,
      );
      return;
    }

    try {
      const startedTurn = await runtime.turnStart({
        threadId,
        input: promptInput(task, []),
      });
      const activeTurnId = this.#turnId(startedTurn);
      if (activeTurnId !== undefined) {
        sessionRouter.bind(inbound.target, {
          contextKind: "app_default",
          projectLabel: "Codex default",
          cwd,
          codexThreadId: threadId,
          activeTurnId,
        });
        await this.#turnOutputManager?.open(inbound.target, threadId, activeTurnId, false);
      }
      await this.#editInboundMessage(
        inbound.messageRef,
        `New Codex conversation ${this.#shortId(threadId)} in project Codex default${activeTurnId === undefined ? "" : `\nturn: ${this.#shortId(activeTurnId)}`}`,
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.turn_start_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex turn failed to start.");
    }
  }

  async #routeForkCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    if (await this.#enforceMutationRateLimit(inbound, "fork")) return;
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

    // Slice 3 A5: /fork accepts an optional `--exclude-turns` flag.
    // Default behavior matches the codex protocol default (include
    // turns). The flag opts in to excluding the turn array from the
    // forked thread metadata, which is the path callers use when they
    // plan to call thread/turns/list immediately after.
    const excludeTurns = command.args.includes("--exclude-turns");

    let forkedThreadId: string | undefined;
    try {
      forkedThreadId = this.#threadId(
        await runtime.threadFork({
          threadId: source.codexThreadId,
          cwd: project.cwd,
          ...(project.defaultModel === undefined ? {} : { model: project.defaultModel }),
          excludeTurns,
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
        cwd: project.cwd,
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
      if (selected.record.projectId === undefined) {
        return { kind: "missing" };
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
    if (route.projectId === undefined) {
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
      route?.kind === "bound" && route.codexThreadId === record.codexThreadId ? "*" : " ";
    const title = record.title === undefined ? "" : ` ${this.#sanitizeThreadTitle(record.title)}`;
    return `${marker} ${selector} ${this.#sessionProjectLabel(record)}${title} (${this.#shortId(
      record.codexThreadId,
    )}) last ${record.lastUsedAt}`;
  }

  #routeProjectLabel(route: Extract<SessionRoute, { kind: "bound" }>): string {
    return route.projectLabel ?? route.projectId ?? "Codex default";
  }

  #sessionProjectLabel(record: ThreadSessionRecord): string {
    return record.projectLabel ?? record.projectId ?? "Codex default";
  }

  #nativeThreadEntries(response: unknown): DaemonNativeThreadEntry[] {
    const data = Array.isArray((response as { data?: unknown }).data)
      ? ((response as { data: unknown[] }).data as unknown[])
      : [];
    return data.flatMap((thread): DaemonNativeThreadEntry[] => {
      const threadId = readStringField(thread, "id");
      const cwd = readStringField(thread, "cwd");
      if (threadId === undefined || cwd === undefined) {
        return [];
      }
      const name = readStringField(thread, "name");
      const preview = readStringField(thread, "preview");
      const updatedAt = readNumberField(thread, "updatedAt");
      return [
        {
          threadId,
          cwd,
          title: this.#sanitizeThreadTitle(name ?? preview ?? threadId),
          ...(updatedAt === undefined ? {} : { updatedAt }),
        },
      ];
    });
  }

  #formatNativeThreadListLine(selector: number, thread: DaemonNativeThreadEntry): string {
    const updated = thread.updatedAt === undefined ? "" : `\nupdated: ${thread.updatedAt}`;
    return `${selector}. ${thread.title}\nproject: ${projectDisplayNameFromCwd(thread.cwd)}${updated}\nid: ${this.#shortId(
      thread.threadId,
    )}`;
  }

  #selectNativeThread(
    threads: readonly DaemonNativeThreadEntry[],
    selector: string,
  ):
    | { kind: "selected"; thread: DaemonNativeThreadEntry; index: number }
    | { kind: "missing" }
    | { kind: "ambiguous" } {
    if (/^\d+$/.test(selector)) {
      const index = Number.parseInt(selector, 10) - 1;
      const thread = threads[index];
      return thread === undefined ? { kind: "missing" } : { kind: "selected", thread, index };
    }
    const prefix = selector.endsWith("...") ? selector.slice(0, -3) : selector;
    const matches = threads
      .map((thread, index) => ({ thread, index }))
      .filter(({ thread }) => thread.threadId === selector || thread.threadId.startsWith(prefix));
    if (matches.length === 0) {
      return { kind: "missing" };
    }
    if (matches.length > 1) {
      return { kind: "ambiguous" };
    }
    const [match] = matches;
    return match === undefined
      ? { kind: "missing" }
      : { kind: "selected", thread: match.thread, index: match.index };
  }

  async #switchNativeThread(
    inbound: { target: Target; messageRef?: DaemonMessageRef },
    thread: DaemonNativeThreadEntry,
    index: number,
  ): Promise<void> {
    const runtime = this.#currentRuntime();
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    if (runtime?.threadResume === undefined || sessionRouter?.bind === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Codex thread resume unavailable.");
      return;
    }

    try {
      await runtime.threadResume({ threadId: thread.threadId, excludeTurns: true });
      const projectLabel = projectDisplayNameFromCwd(thread.cwd);
      sessionRouter.bind(inbound.target, {
        contextKind: "native_thread",
        projectLabel,
        cwd: thread.cwd,
        codexThreadId: thread.threadId,
      });
      this.#threadSessionRepository()?.upsert({
        target: inbound.target,
        contextKind: "native_thread",
        projectLabel,
        cwd: thread.cwd,
        codexThreadId: thread.threadId,
        title: thread.title,
        now: this.#nowIso(),
      });
      await this.#editInboundMessage(
        inbound.messageRef,
        `Switched to ${index + 1} ${thread.title} (${this.#shortId(thread.threadId)})\nproject: ${projectDisplayNameFromCwd(thread.cwd)}`,
      );
    } catch (error) {
      this.#emitAuditEvent("runtime.thread_resume_failed", {
        target: inbound.target,
        result: "failed",
        metadata: { error: errorMessage(error), threadId: thread.threadId },
      });
      await this.#editInboundMessage(inbound.messageRef, "Codex thread failed to resume.");
    }
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
      return "Cannot change cwd or thread while a Codex turn is active. Send /stop first or wait for it to finish.";
    }

    if (this.#pendingApprovalCount() > 0) {
      return "Cannot change cwd or thread while an approval is pending. Resolve or decline the approval first.";
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
    await this.#turnOutputManager?.interrupt(route.codexThreadId, route.activeTurnId);
  }

  async #routeUseCommand(
    inbound: { target: Target; sender: SecurityPolicySender; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    const [projectId] = command.args;
    if (projectId === undefined) {
      // /use with no argument is a read-only listing (delegates to /cwds);
      // not subject to mutation rate limiting.
      await this.#routeCwdsCommand(inbound);
      return;
    }
    if (await this.#enforceMutationRateLimit(inbound, "use")) return;
    if (isRawCwdSelector(projectId)) {
      await this.#editInboundMessage(
        inbound.messageRef,
        "IM cannot accept raw cwd paths. Use /projects, then /use <number>.",
      );
      return;
    }

    const selected = this.#resolveKnownConfigCwd(projectId, inbound.target, inbound.sender);
    if (selected === undefined) {
      if (this.#projectConfig(projectId) !== undefined) {
        await this.#editInboundMessage(inbound.messageRef, "Project access denied");
        return;
      }
      await this.#editInboundMessage(inbound.messageRef, `Unknown project: ${redact(projectId)}`);
      return;
    }

    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    if (sessionRouter?.bind === undefined) {
      await this.#editInboundMessage(inbound.messageRef, "Binding store unavailable");
      return;
    }

    try {
      sessionRouter.bind(inbound.target, {
        projectId: selected.alias,
        cwd: selected.cwd,
        ...(selected.defaultModel === undefined ? {} : { defaultModel: selected.defaultModel }),
      });
    } catch (error) {
      this.#emitAuditEvent("session.bind_failed", {
        target: inbound.target,
        result: "failed",
        metadata: {
          error: errorMessage(error),
          projectId: selected.alias,
        },
      });
      await this.#editInboundMessage(
        inbound.messageRef,
        `Failed to bind cwd ${selected.alias}: storage write failed`,
      );
      return;
    }

    await this.#editInboundMessage(
      inbound.messageRef,
      `Using project ${selected.alias}\nNext: /new <task>`,
    );
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

  #threadStartParams(
    route: Extract<SessionRoute, { kind: "bound" }>,
    opts: { readonly computerUse?: boolean } = {},
  ): DaemonThreadStartParams {
    return {
      cwd: route.cwd,
      ...(route.defaultModel === undefined ? {} : { model: route.defaultModel }),
      ...(opts.computerUse === true && this.options.computerUseProvider !== undefined
        ? { dynamicTools: [COMPUTER_USE_DYNAMIC_TOOL_SPEC] }
        : {}),
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
      ...(route.contextKind !== undefined ? { contextKind: route.contextKind } : {}),
      ...(route.projectId !== undefined ? { projectId: route.projectId } : {}),
      ...(route.projectLabel !== undefined ? { projectLabel: route.projectLabel } : {}),
      cwd: route.cwd,
      codexThreadId: route.codexThreadId,
      ...(route.defaultModel === undefined ? {} : { defaultModel: route.defaultModel }),
      activeTurnId,
    });
  }

  #threadId(result: DaemonThreadStartResult): string | undefined {
    return typeof result.thread?.id === "string" ? result.thread.id : undefined;
  }

  #threadCwd(result: DaemonThreadStartResult): string | undefined {
    if (typeof result.thread?.cwd === "string") {
      return result.thread.cwd;
    }
    return typeof result.cwd === "string" ? result.cwd : undefined;
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

  #knownConfigCwds(target: Target, sender: SecurityPolicySender): DaemonKnownCwdEntry[] {
    return this.#projectEntries()
      .filter(([alias]) => this.#projectAllowed(alias, target, sender))
      .map(([alias, project]) => ({
        alias,
        cwd: project.cwd,
        source: "config" as const,
        ...(project.defaultModel === undefined ? {} : { defaultModel: project.defaultModel }),
      }));
  }

  #resolveKnownConfigCwd(
    selector: string,
    target: Target,
    sender: SecurityPolicySender,
  ): DaemonKnownCwdEntry | undefined {
    const entries = this.#knownConfigCwds(target, sender);
    if (/^\d+$/.test(selector)) {
      return entries[Number.parseInt(selector, 10) - 1];
    }
    return entries.find((entry) => entry.alias === selector);
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
      rejectionReason: unknown;
    }>;
    if (
      (partial.kind !== "image" && partial.kind !== "file") ||
      typeof partial.filename !== "string" ||
      typeof partial.contentType !== "string"
    ) {
      return undefined;
    }
    if (partial.rejectionReason === "too_large") {
      return {
        kind: partial.kind,
        filename: partial.filename,
        contentType: partial.contentType,
        rejectionReason: "too_large",
        ...(typeof partial.sizeBytes === "number" && Number.isFinite(partial.sizeBytes)
          ? { sizeBytes: partial.sizeBytes }
          : {}),
      };
    }
    if (typeof partial.localPath !== "string" || partial.localPath.length === 0) {
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

  #maxInboundAttachmentBytes(): number {
    return this.#positiveInteger(
      this.options.maxInboundAttachmentBytes,
      DEFAULT_MAX_INBOUND_ATTACHMENT_BYTES,
    );
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
