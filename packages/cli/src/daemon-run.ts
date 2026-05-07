import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppServerClient,
  StdioTransport,
  type Transport,
  performInitializeHandshake,
} from "@codex-im/app-server-client";
import { CodexRuntime } from "@codex-im/codex-runtime";
import {
  type CodexImConfig,
  type ResolvedConfigSecrets,
  parseConfigToml,
  resolveConfigSecrets,
  resolveEnvReferences,
} from "@codex-im/config";
import {
  type ApprovalActor,
  ApprovalBroker,
  type PendingApprovalSnapshot,
  SecurityPolicy,
  SessionRouter,
  type Target,
} from "@codex-im/core";
import {
  Daemon,
  type DaemonActionAck,
  type DaemonAdapter,
  type DaemonMessageRef,
  type DaemonOptions,
  type DaemonOutboundFile,
  type DaemonSendCardResult,
  Supervisor,
  createDaemonLogger,
} from "@codex-im/daemon";
import {
  DingTalkChannelAdapter,
  createDingTalkNoopActionClient,
  createDingTalkOpenApiCardClient,
  createDingTalkSessionReplyTextClient,
  createDingTalkStreamClient,
} from "@codex-im/im-dingtalk";
import { createLarkSdkChannelAdapter } from "@codex-im/im-lark";
import { createSlackSdkChannelAdapter } from "@codex-im/im-slack";
import { TelegramChannelAdapter } from "@codex-im/im-telegram";
import {
  AuditRepository,
  BindingRepository,
  type CallbackTokenRecord,
  CallbackTokenRepository,
  type DatabaseHandle,
  ThreadSessionRepository,
  openDatabase,
  runMigrations,
} from "@codex-im/storage-sqlite";
import pino, { type Logger } from "pino";

interface DaemonRunFlags {
  readonly configPath: string;
  readonly statusPath?: string;
  readonly migrationsDir: string;
  readonly preflight: boolean;
}

interface RuntimeStorage {
  readonly db: DatabaseHandle;
  readonly bindings: BindingRepository;
  readonly audit: AuditRepository;
  readonly callbackTokens: CallbackTokenRepository;
  readonly threadSessions: ThreadSessionRepository;
  close(): void;
}

type ResolvedOriginalApprovalCard = Parameters<
  NonNullable<DaemonOptions["renderResolvedApprovalCard"]>
>[1];
type ApprovalCardInput = Parameters<NonNullable<DaemonAdapter["sendCard"]>>[1];

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_CONFIG_PATH = join(homedir(), ".codex-im-bridge", "config.toml");
const DEFAULT_MIGRATIONS_DIR = join(REPO_ROOT, "packages", "storage-sqlite", "src", "migrations");
export const DAEMON_CODEX_CONFIG_OVERRIDES = {
  sandbox_mode: "read-only",
  approval_policy: "on-request",
} as const;
export const DAEMON_SERVER_REQUEST_HANDLER_TIMEOUT_MS = 31 * 60 * 1000;

export async function run(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const flags = parseDaemonRunArgs(argv);
  const logger = pino({ name: "codex-im-daemon-run", level: process.env.LOG_LEVEL ?? "info" });
  const config = await loadConfig(flags.configPath);
  if (flags.preflight) {
    runDaemonPreflight(config, flags);
    return;
  }
  const secrets = resolveConfigSecrets(config, { env: process.env, logger });
  const daemonLogger = createDaemonLogger<Logger>({ logDir: config.daemon.logDir });
  const storageBox: { current?: RuntimeStorage } = {};

  const daemon = new Daemon({
    loadConfig: () => config,
    openStorage: () => {
      const storage = openRuntimeStorage(config, flags.migrationsDir);
      storageBox.current = storage;
      return storage;
    },
    createBroker: () => createBroker(config, daemonLogger),
    createSecurityPolicy: () => createSecurityPolicy(config),
    createSessionRouter: ({ storage }) => {
      const runtimeStorage = asRuntimeStorage(storage);
      return new SessionRouter({ bindings: runtimeStorage.bindings });
    },
    createSupervisor: async ({ broker }) => {
      const approvalBroker = broker as ApprovalBroker;
      const supervisor = new Supervisor({
        transportFactory: () => createCodexTransport(config, daemonLogger),
        clientFactory: (transport: Transport) => createDaemonAppServerClient(transport, logger),
        runtimeFactory: (client: AppServerClient) => new CodexRuntime(client),
        broker: approvalBroker,
        performHandshake: (client: AppServerClient) =>
          performInitializeHandshake(client, {
            name: "codex-im-rich-client",
            title: "Codex IM Rich Client",
            version: config.codex.versionPin,
          }),
        audit: {
          emit: (message: string) => logger.info({ event: "supervisor", message }),
          emitFatal: (message: string) => logger.fatal({ event: "supervisor", message }),
        },
      });
      await supervisor.start();
      return supervisor;
    },
    createAdapter: () => createProductionAdapter(config, secrets),
    resolveApprovalTarget: (snapshot) =>
      approvalTargetForSnapshot(snapshot, config, storageBox.current?.bindings),
    resolveApprovalAllowedActors: (_snapshot, target) => allowedActorsForTarget(config, target),
    callbackTokenRepository: {
      insert: (input) => asRuntimeStorage(storageBox.current).callbackTokens.insert(input),
      findByHash: (hash) => asRuntimeStorage(storageBox.current).callbackTokens.findByHash(hash),
      casUpdate: (hash, from, to, fields) =>
        asRuntimeStorage(storageBox.current).callbackTokens.casUpdate(hash, from, to, fields),
      forceMarkUsed: (hash, fields) =>
        asRuntimeStorage(storageBox.current).callbackTokens.forceMarkUsed(hash, fields),
      revokeBoundSiblings: (approvalId, exceptHash) =>
        asRuntimeStorage(storageBox.current).callbackTokens.revokeBoundSiblings(
          approvalId,
          exceptHash,
        ),
      revokeActive: () => asRuntimeStorage(storageBox.current).callbackTokens.revokeActive(),
      revokeBound: () => asRuntimeStorage(storageBox.current).callbackTokens.revokeBound(),
      pruneExpired: (now, limit) =>
        asRuntimeStorage(storageBox.current).callbackTokens.pruneExpired(now, limit),
      revokeStuckIssued: (cutoff, approvalIds, limit) =>
        asRuntimeStorage(storageBox.current).callbackTokens.revokeStuckIssued(
          cutoff,
          approvalIds,
          limit,
        ),
    },
    auditRepository: {
      insertBestEffort: (input) =>
        asRuntimeStorage(storageBox.current).audit.insertBestEffort(input),
    },
    threadSessionRepository: {
      upsert: (input) => asRuntimeStorage(storageBox.current).threadSessions.upsert(input),
      listForTarget: (target, options) =>
        asRuntimeStorage(storageBox.current).threadSessions.listForTarget(target, options),
      findByTargetAndThread: (target, threadId) =>
        asRuntimeStorage(storageBox.current).threadSessions.findByTargetAndThread(target, threadId),
      touch: (target, threadId, now) =>
        asRuntimeStorage(storageBox.current).threadSessions.touch(target, threadId, now),
      rename: (target, threadId, title, now) =>
        asRuntimeStorage(storageBox.current).threadSessions.rename(target, threadId, title, now),
      switchCurrent: (input) =>
        asRuntimeStorage(storageBox.current).threadSessions.switchCurrent(input),
    },
    renderResolvedApprovalCard: renderResolvedCallbackApprovalCard,
    statusPath: flags.statusPath ?? join(config.daemon.dataDir, "daemon-status.json"),
  });

  await daemon.start();
  logger.info({ configPath: flags.configPath }, "codex-im daemon started");
  await waitForStopSignal();
  await daemon.stop();
  logger.info("codex-im daemon stopped");
}

interface PlatformAdapterEntry {
  readonly platform: string;
  readonly adapter: DaemonAdapter;
}

export class MultiPlatformDaemonAdapter implements DaemonAdapter {
  readonly #entries: readonly PlatformAdapterEntry[];

  constructor(entries: readonly PlatformAdapterEntry[]) {
    if (entries.length === 0) {
      throw new Error("MultiPlatformDaemonAdapter requires at least one adapter");
    }
    this.#entries = entries;
  }

  onAction(handler: (action: unknown) => void): () => void {
    return unsubscribeAll(this.#entries.map((entry) => entry.adapter.onAction(handler)));
  }

  onMessage(handler: (message: unknown) => void): () => void {
    return unsubscribeAll(this.#entries.map((entry) => entry.adapter.onMessage(handler)));
  }

  async pauseInbound(): Promise<void> {
    await Promise.all(this.#entries.map((entry) => entry.adapter.pauseInbound?.()));
  }

  async start(): Promise<void> {
    await Promise.all(this.#entries.map((entry) => entry.adapter.start?.()));
  }

  async stop(): Promise<void> {
    await Promise.all([...this.#entries].reverse().map((entry) => entry.adapter.stop?.()));
  }

  async answerAction(callbackHandle: string, ack: DaemonActionAck): Promise<void> {
    const adapter = this.#adapterForCallbackHandle(callbackHandle);
    if (adapter.answerAction === undefined) {
      throw new Error("selected IM adapter does not support answerAction");
    }
    await adapter.answerAction(callbackHandle, ack);
  }

  async sendCard(target: Target, card: ApprovalCardInput): Promise<DaemonSendCardResult> {
    const adapter = this.#adapterForTarget(target, "sendCard");
    if (adapter.sendCard === undefined) {
      throw new Error(`IM adapter for ${target.platform} does not support sendCard`);
    }
    return adapter.sendCard(target, card);
  }

  async updateCard(ref: DaemonMessageRef, card: ApprovalCardInput): Promise<void> {
    const adapter = this.#adapterForTarget(ref.target, "updateCard");
    if (adapter.updateCard === undefined) {
      throw new Error(`IM adapter for ${ref.target.platform} does not support updateCard`);
    }
    await adapter.updateCard(ref, card);
  }

  async editText(ref: DaemonMessageRef, body: string): Promise<void> {
    const adapter = this.#adapterForTarget(ref.target, "editText");
    if (adapter.editText === undefined) {
      throw new Error(`IM adapter for ${ref.target.platform} does not support editText`);
    }
    await adapter.editText(ref, body);
  }

  async sendText(target: Target, body: string): Promise<DaemonMessageRef> {
    const adapter = this.#adapterForTarget(target, "sendText");
    if (adapter.sendText === undefined) {
      throw new Error(`IM adapter for ${target.platform} does not support sendText`);
    }
    return adapter.sendText(target, body);
  }

  async sendFile(target: Target, file: DaemonOutboundFile): Promise<DaemonMessageRef> {
    const adapter = this.#adapterForTarget(target, "sendFile");
    if (adapter.sendFile === undefined) {
      throw new Error(`IM adapter for ${target.platform} does not support sendFile`);
    }
    return adapter.sendFile(target, file);
  }

  #adapterForTarget(target: Target, method: string): DaemonAdapter {
    const entry = this.#entries.find((candidate) => candidate.platform === target.platform);
    if (entry === undefined) {
      throw new Error(`No ${target.platform} IM adapter configured for ${method}`);
    }
    return entry.adapter;
  }

  #adapterForCallbackHandle(callbackHandle: string): DaemonAdapter {
    const platform = platformForCallbackHandle(callbackHandle);
    if (platform !== undefined) {
      return this.#adapterForTarget({ platform, chatId: "_" }, "answerAction");
    }
    const single = this.#entries[0];
    if (this.#entries.length === 1 && single !== undefined) {
      return single.adapter;
    }
    throw new Error("Cannot route callback handle to a configured IM adapter");
  }
}

export function createProductionAdapter(
  config: CodexImConfig,
  secrets: ResolvedConfigSecrets,
): DaemonAdapter {
  const entries: PlatformAdapterEntry[] = [];
  if (config.adapters.telegram.enabled) {
    if (secrets.telegramBotToken === undefined) {
      throw new Error("daemon run requires resolved Telegram bot token");
    }
    entries.push({
      platform: "telegram",
      adapter: new TelegramChannelAdapter({
        botToken: secrets.telegramBotToken,
        attachmentDir: join(config.daemon.dataDir, "attachments", "telegram"),
      }),
    });
  }
  if (config.adapters.lark.enabled) {
    if (secrets.larkAppSecret === undefined) {
      throw new Error("daemon run requires resolved Lark app secret");
    }
    entries.push({
      platform: "lark",
      adapter: createLarkSdkChannelAdapter({
        appId: config.adapters.lark.appId,
        appSecret: secrets.larkAppSecret,
        domain: config.adapters.lark.domain,
        attachmentDir: join(config.daemon.dataDir, "attachments", "lark"),
        ...(secrets.larkEncryptKey === undefined ? {} : { encryptKey: secrets.larkEncryptKey }),
        ...(secrets.larkVerificationToken === undefined
          ? {}
          : { verificationToken: secrets.larkVerificationToken }),
      }),
    });
  }
  if (config.adapters.dingtalk.enabled) {
    if (secrets.dingtalkClientSecret === undefined) {
      throw new Error("daemon run requires resolved DingTalk client secret");
    }
    const dingTalkRobotCode =
      config.adapters.dingtalk.robotCode ?? config.adapters.dingtalk.clientId;
    const dingTalkCardClient =
      config.adapters.dingtalk.cardTemplateId === undefined
        ? undefined
        : createDingTalkOpenApiCardClient({
            clientId: config.adapters.dingtalk.clientId,
            clientSecret: secrets.dingtalkClientSecret,
            robotCode: dingTalkRobotCode,
            cardTemplateId: config.adapters.dingtalk.cardTemplateId,
            ...(config.adapters.dingtalk.callbackRouteKey === undefined
              ? {}
              : { callbackRouteKey: config.adapters.dingtalk.callbackRouteKey }),
          });
    entries.push({
      platform: "dingtalk",
      adapter: new DingTalkChannelAdapter({
        streamClient: createDingTalkStreamClient({
          clientId: config.adapters.dingtalk.clientId,
          clientSecret: secrets.dingtalkClientSecret,
          ua: "codex-im",
          keepAlive: false,
          debug: false,
        }),
        ...(dingTalkCardClient === undefined ? {} : { cardClient: dingTalkCardClient }),
        actionClient: createDingTalkNoopActionClient(),
        textClient: createDingTalkSessionReplyTextClient(),
      }),
    });
  }
  if (config.adapters.slack.enabled) {
    if (secrets.slackBotToken === undefined || secrets.slackAppToken === undefined) {
      throw new Error("daemon run requires resolved Slack bot and app tokens");
    }
    entries.push({
      platform: "slack",
      adapter: createSlackSdkChannelAdapter({
        botToken: secrets.slackBotToken,
        appToken: secrets.slackAppToken,
        attachmentDir: join(config.daemon.dataDir, "attachments", "slack"),
      }),
    });
  }
  if (entries.length === 0) {
    throw new Error("daemon run requires at least one enabled IM adapter");
  }
  const single = entries[0];
  return entries.length === 1 && single !== undefined
    ? single.adapter
    : new MultiPlatformDaemonAdapter(entries);
}

function unsubscribeAll(unsubscribes: readonly (() => void)[]): () => void {
  return () => {
    for (const unsubscribe of [...unsubscribes].reverse()) {
      unsubscribe();
    }
  };
}

function platformForCallbackHandle(callbackHandle: string): string | undefined {
  if (callbackHandle.startsWith("tgcb:v1:")) {
    return "telegram";
  }
  if (callbackHandle.startsWith("lark-card-action:")) {
    return "lark";
  }
  if (callbackHandle.startsWith("dingtalk-card-action:")) {
    return "dingtalk";
  }
  if (callbackHandle.startsWith("slack-block-action:")) {
    return "slack";
  }
  return undefined;
}

function parseDaemonRunArgs(argv: readonly string[]): DaemonRunFlags {
  let configPath = DEFAULT_CONFIG_PATH;
  let statusPath: string | undefined;
  let migrationsDir = DEFAULT_MIGRATIONS_DIR;
  let preflight = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      i += 1;
      configPath = requiredValue(argv, i, arg);
    } else if (arg === "--status-file") {
      i += 1;
      statusPath = requiredValue(argv, i, arg);
    } else if (arg === "--migrations-dir") {
      i += 1;
      migrationsDir = requiredValue(argv, i, arg);
    } else if (arg === "--preflight") {
      preflight = true;
    } else {
      throw new Error(`unknown daemon run argument: ${arg}`);
    }
  }
  return {
    configPath: resolve(configPath),
    ...(statusPath === undefined ? {} : { statusPath }),
    migrationsDir: resolve(migrationsDir),
    preflight,
  };
}

async function loadConfig(path: string): Promise<CodexImConfig> {
  const source = await readFile(path, "utf8");
  return resolveEnvReferences(parseConfigToml(source), { env: process.env });
}

function openRuntimeStorage(config: CodexImConfig, migrationsDir: string): RuntimeStorage {
  const db = openDatabase(config.storage.sqlitePath);
  if (config.storage.autoMigrate) {
    runMigrations(db, migrationsDir);
  }
  const bindings = new BindingRepository(db);
  bindings.clearActiveTurns();
  return {
    db,
    bindings,
    audit: new AuditRepository(db),
    callbackTokens: new CallbackTokenRepository(db),
    threadSessions: new ThreadSessionRepository(db),
    close: () => db.close(),
  };
}

function runDaemonPreflight(config: CodexImConfig, flags: DaemonRunFlags): void {
  const db = openDatabase(config.storage.sqlitePath);
  try {
    if (config.storage.autoMigrate) {
      runMigrations(db, flags.migrationsDir);
    }
    createSecurityPolicy(config);
  } finally {
    db.close();
  }
  process.stdout.write("daemon preflight: ok\n");
}

function createBroker(config: CodexImConfig, logger: Logger): ApprovalBroker {
  const placeholderTransport = createCodexTransport(config, logger);
  const placeholderClient = createDaemonAppServerClient(placeholderTransport, logger);
  return new ApprovalBroker(placeholderClient);
}

function createDaemonAppServerClient(transport: Transport, logger: Logger): AppServerClient {
  return new AppServerClient(transport, {
    logger,
    serverRequestHandlerTimeoutMs: DAEMON_SERVER_REQUEST_HANDLER_TIMEOUT_MS,
  });
}

function createCodexTransport(config: CodexImConfig, logger: Logger): StdioTransport {
  return new StdioTransport({
    command: config.codex.binary,
    args: ["app-server", "--listen", "stdio://"],
    configOverrides: DAEMON_CODEX_CONFIG_OVERRIDES,
    logger,
  });
}

function createSecurityPolicy(config: CodexImConfig): SecurityPolicy {
  return new SecurityPolicy({
    allowedUsers: config.security.allowedUsers,
    allowedChats: config.security.allowedChats,
    commands: config.security.commands,
    groupPolicy: config.security.groupPolicy,
    projects: Object.entries(config.projects).map(([projectId, project]) => {
      return {
        projectId,
        allowedUsers: project.allowedUsers,
        allowedChats: project.allowedChats,
      };
    }),
  });
}

export function renderResolvedCallbackApprovalCard(
  record: CallbackTokenRecord,
  originalCard?: ResolvedOriginalApprovalCard,
) {
  if (originalCard !== undefined) {
    return {
      ...originalCard,
      approvalId: record.approvalId,
      summary: `Decision recorded: ${approvalActionLabel(record.action)}\n${originalCard.summary}`,
      actions: [],
      status: "resolved",
      createdAt: new Date(originalCard.createdAt.getTime()),
    } as const;
  }

  return {
    schemaVersion: "approval-card.v1",
    kind: "unknown",
    approvalId: record.approvalId,
    summary: `Decision recorded: ${approvalActionLabel(record.action)}`,
    target: { riskLevel: "low" },
    actions: [],
    status: "resolved",
    createdAt: new Date(record.createdAt),
  } as const;
}

function approvalActionLabel(action: CallbackTokenRecord["action"]): string {
  switch (action) {
    case "allow_once":
      return "allow once";
    case "allow_session":
      return "allow session";
    case "decline":
      return "decline";
    case "abort":
      return "abort";
  }
  const _exhaustive: never = action;
  return _exhaustive;
}

function approvalTargetForSnapshot(
  snapshot: PendingApprovalSnapshot,
  config: CodexImConfig,
  bindings?: BindingRepository,
): Target | undefined {
  const threadId = readStringField(snapshot.params, "threadId");
  if (threadId !== undefined && bindings !== undefined) {
    const match = bindings.list().find((binding) => binding.codexThreadId === threadId);
    if (match !== undefined) {
      return match.target;
    }
  }
  const enabledPlatforms = new Set<string>();
  if (config.adapters.telegram.enabled) {
    enabledPlatforms.add("telegram");
  }
  if (config.adapters.lark.enabled) {
    enabledPlatforms.add("lark");
  }
  if (config.adapters.dingtalk.enabled) {
    enabledPlatforms.add("dingtalk");
  }
  if (config.adapters.slack.enabled) {
    enabledPlatforms.add("slack");
  }
  const firstAllowedChat = config.security.allowedChats
    .map(parseScopedId)
    .find((entry) => entry !== undefined && enabledPlatforms.has(entry.platform));
  if (firstAllowedChat === undefined) {
    return undefined;
  }
  return { platform: firstAllowedChat.platform, chatId: firstAllowedChat.id };
}

function allowedActorsForTarget(
  config: CodexImConfig,
  target: Target,
): readonly NonNullable<ApprovalActor>[] {
  return config.security.allowedUsers
    .map(parseScopedId)
    .filter((entry): entry is { platform: string; id: string } => entry !== undefined)
    .filter((entry) => entry.platform === target.platform)
    .map((entry) => ({ kind: "im" as const, platform: entry.platform, userId: entry.id }));
}

function parseScopedId(value: string): { platform: string; id: string } | undefined {
  const index = value.indexOf(":");
  if (index <= 0 || index === value.length - 1) {
    return undefined;
  }
  return { platform: value.slice(0, index), id: value.slice(index + 1) };
}

function readStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function asRuntimeStorage(value: unknown): RuntimeStorage {
  if (value === undefined) {
    throw new Error("runtime storage is not initialized");
  }
  return value as RuntimeStorage;
}

function requiredValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.length === 0) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function waitForStopSignal(): Promise<void> {
  return new Promise((resolveSignal) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolveSignal();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
