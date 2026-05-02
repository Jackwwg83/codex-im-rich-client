import { randomBytes, randomUUID } from "node:crypto";
import {
  type ActorPolicy,
  type ApprovalActor,
  type ApprovalUiAction,
  type BindResult,
  type CommandRouterResult,
  type IMRoutableApprovalMethod,
  IM_ROUTABLE_APPROVAL_METHODS,
  type PendingApprovalSnapshot,
  type ResolveApprovalInput,
  type ResolveApprovalResult,
  type ResolveError,
  type SecurityPolicyApprovalDestinationDecision,
  type SecurityPolicySender,
  type SecurityPolicyUserChatDecision,
  type SessionBindingInput,
  type SessionRoute,
  SessionRouter,
  type Target,
  routeInboundCommand,
} from "@codex-im/core";
import { type ApprovalCard, projectApprovalCard } from "@codex-im/render";
import {
  BindingRepository,
  type CallbackTokenAction,
  type CallbackTokenCasFields,
  type CallbackTokenInsert,
  type CallbackTokenRecord,
  type CallbackTokenStatus,
  type DatabaseHandle,
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
  failPendingAsTransportLost?(): void;
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
  forceMarkUsed?(tokenHash: string, fields?: CallbackTokenCasFields): CallbackTokenRecord | unknown;
  revokeBoundSiblings?(approvalId: string, exceptTokenHash: string): readonly CallbackTokenRecord[];
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
  threadStart(params: DaemonThreadStartParams): MaybePromise<DaemonThreadStartResult>;
  turnStart(params: DaemonTurnStartParams): MaybePromise<DaemonTurnStartResult>;
  turnSteer(params: DaemonTurnSteerParams): MaybePromise<unknown>;
  turnInterrupt?(params: DaemonTurnInterruptParams): MaybePromise<unknown>;
}

interface DaemonRuntimeProvider {
  currentRuntime(): DaemonCodexRuntime | null | undefined;
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
  readonly renderApprovalCard?: (snapshot: PendingApprovalSnapshot) => ApprovalCard;
  readonly renderResolvedApprovalCard?: (record: CallbackTokenRecord) => ApprovalCard;
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
  #stopPromise: Promise<void> | undefined;
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
    this.#storage = undefined;
    this.#config = undefined;
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
        await this.#routePrompt(inbound.target, routed.text);
        return;
      }

      if (routed.kind === "command") {
        await this.#routeCommand(inbound, routed);
      }
    } catch {
      // Inbound message handling must fail closed without destabilizing daemon subscriptions.
    }
  }

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
      return;
    }

    const messageRefFailure = this.#messageRefFailure(record, inbound.messageRef);
    if (messageRefFailure !== undefined) {
      await this.#answerAction(inbound.callbackHandle, messageRefFailure);
      return;
    }

    const actor = this.#inboundActor(inbound);
    if (actor === undefined || inbound.target === undefined || inbound.sender === undefined) {
      await this.#answerAction(inbound.callbackHandle, "unauthorized");
      return;
    }

    const policy = this.#userChatPolicy(this.#securityPolicy);
    if (policy?.checkUserAndChat(inbound.target, inbound.sender)?.kind !== "allow") {
      await this.#answerAction(inbound.callbackHandle, "unauthorized");
      return;
    }

    const resolvableRecord = this.#resolvableCallbackRecord(record);
    if (resolvableRecord === undefined) {
      await this.#answerAction(inbound.callbackHandle, "stale or unknown");
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
      repository?.forceMarkUsed?.(record.tokenHash, { actor });
    }

    await this.#answerAction(callbackHandle, "decision recorded", true);
    const terminalCard = this.options.renderResolvedApprovalCard?.(record);
    if (terminalCard !== undefined && record.messageRef !== undefined) {
      await this.#adapter?.updateCard?.(
        { target: record.target, messageId: record.messageRef.messageId },
        terminalCard,
      );
    }
    repository?.revokeBoundSiblings?.(record.approvalId, record.tokenHash);
  }

  async #answerAction(callbackHandle: string, userMessage: string, ok = false): Promise<void> {
    await this.#adapter?.answerAction?.(callbackHandle, { ok, userMessage });
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

  async #routePrompt(target: Target, text: string): Promise<void> {
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const runtime = this.#currentRuntime();
    if (sessionRouter === undefined || runtime === undefined) {
      return;
    }

    let route = sessionRouter.resolve(target);
    if (route.kind !== "bound") {
      return;
    }

    if (route.codexThreadId === undefined) {
      const startedThread = await runtime.threadStart(this.#threadStartParams(route));
      const threadId = this.#threadId(startedThread);
      if (threadId === undefined || sessionRouter.bindThread === undefined) {
        return;
      }
      route = sessionRouter.bindThread(target, threadId);
    }

    if (route.kind !== "bound" || route.codexThreadId === undefined) {
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

    const startedTurn = await runtime.turnStart({
      threadId: route.codexThreadId,
      input,
      cwd: route.cwd,
      ...(route.defaultModel === undefined ? {} : { model: route.defaultModel }),
    });
    const activeTurnId = this.#turnId(startedTurn);
    if (activeTurnId !== undefined) {
      this.#bindActiveTurn(sessionRouter, route, activeTurnId);
    }
  }

  async #routeCommand(
    inbound: { target: Target; messageRef?: DaemonMessageRef },
    command: Extract<CommandRouterResult, { kind: "command" }>,
  ): Promise<void> {
    if (command.name === "use") {
      await this.#routeUseCommand(inbound, command);
      return;
    }

    if (command.name === "stop") {
      await this.#routeStopCommand(inbound.target);
    }
  }

  async #routeStopCommand(target: Target): Promise<void> {
    const sessionRouter = this.#daemonSessionRouter(this.#sessionRouter);
    const runtime = this.#currentRuntime();
    if (sessionRouter === undefined || runtime?.turnInterrupt === undefined) {
      return;
    }

    const route = sessionRouter.resolve(target);
    if (
      route.kind !== "bound" ||
      route.codexThreadId === undefined ||
      route.activeTurnId === undefined
    ) {
      return;
    }

    await runtime.turnInterrupt({
      threadId: route.codexThreadId,
      turnId: route.activeTurnId,
    });
  }

  async #routeUseCommand(
    inbound: { target: Target; messageRef?: DaemonMessageRef },
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
    await this.#adapter?.editText?.(messageRef, body);
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

async function drainShutdown(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
