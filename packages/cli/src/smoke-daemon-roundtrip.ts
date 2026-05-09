import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IM_ROUTABLE_APPROVAL_METHODS,
  type PendingApprovalSnapshot,
  type SecurityPolicySender,
  SessionRouter,
  type Target,
} from "@codex-im/core";
import { Daemon } from "@codex-im/daemon";
import { TelegramChannelAdapter, TelegramFakeSmokeBot } from "@codex-im/im-telegram";
import {
  AuditRepository,
  BindingRepository,
  CallbackTokenRepository,
  ThreadSessionRepository,
  openDatabase,
  runMigrations,
} from "@codex-im/storage-sqlite";

export interface DaemonRoundtripSmokeResult {
  readonly ok: true;
  readonly botStarted: boolean;
  readonly botStopped: boolean;
  readonly threadStarts: number;
  readonly threadForks: number;
  readonly threadResumes: number;
  readonly turnStarts: number;
  readonly turnInterrupts: number;
  readonly approvalCards: number;
  readonly callbackResolves: number;
  readonly callbackAnswers: number;
  readonly knownThreads: number;
}

export interface RunDaemonRoundtripSmokeOptions {
  readonly env?: Record<string, string | undefined>;
  readonly now?: () => Date;
  readonly output?: (line: string) => void;
}

interface RoundtripConfig {
  readonly projects: {
    readonly "codex-im": {
      readonly cwd: string;
      readonly defaultModel: string;
    };
  };
}

const TARGET: Target = { platform: "telegram", chatId: "-1009876543210", topicId: "42" };
const SENDER: SecurityPolicySender = { userId: "555666777", displayName: "ci-operator" };
const DEFAULT_NOW = new Date("2026-05-03T14:00:00.000Z");

export async function runDaemonRoundtripSmokeCore(
  options: RunDaemonRoundtripSmokeOptions = {},
): Promise<DaemonRoundtripSmokeResult> {
  const output = options.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => DEFAULT_NOW);
  const workspace = mkdtempSync(join(tmpdir(), "codex-im-daemon-roundtrip-"));
  const migrationsDir =
    options.env?.CODEX_IM_SMOKE_MIGRATIONS_DIR ??
    join(process.cwd(), "packages/storage-sqlite/src/migrations");
  const db = openDatabase(join(workspace, "state.db"));
  runMigrations(db, migrationsDir);

  const bindings = new BindingRepository(db);
  const audit = new AuditRepository(db);
  const callbackTokens = new CallbackTokenRepository(db);
  const threadSessions = new ThreadSessionRepository(db);
  const sessionRouter = new SessionRouter({ bindings });
  const bot = new TelegramFakeSmokeBot();
  const broker = new RoundtripBroker(now);
  const runtime = new RoundtripRuntime();
  const approvalMethod = IM_ROUTABLE_APPROVAL_METHODS[0];
  if (approvalMethod === undefined) {
    throw new Error("smoke:daemon-roundtrip requires at least one IM-routable approval method");
  }
  const config: RoundtripConfig = {
    projects: {
      "codex-im": {
        cwd: workspace,
        defaultModel: "gpt-smoke",
      },
    },
  };

  const daemon = new Daemon({
    loadConfig: () => config,
    openStorage: () => ({
      close: () => db.close(),
    }),
    createBroker: () => broker,
    createSecurityPolicy: () => ({
      checkUserAndChat: () => ({ kind: "allow" as const }),
      checkProjectAccess: () => ({ kind: "allow" as const }),
      checkApprovalDestination: () => ({ kind: "allow" as const }),
      checkCommand: () => ({ kind: "allow" as const }),
    }),
    createSessionRouter: () => sessionRouter,
    createSupervisor: () => ({ currentRuntime: () => runtime }),
    createAdapter: () => new TelegramChannelAdapter({ bot, now }),
    resolveApprovalTarget: () => TARGET,
    resolveApprovalAllowedActors: () => [
      { kind: "im" as const, platform: TARGET.platform, userId: SENDER.userId },
    ],
    callbackTokenRepository: callbackTokens,
    auditRepository: audit,
    threadSessionRepository: threadSessions,
    now,
  });

  try {
    await daemon.start();
    await injectText(bot, "/use codex-im", 1, now);
    await waitFor(() => bot.hasText("Using project codex-im"));

    await injectText(bot, "/new Main thread", 2, now);
    await waitFor(() => runtime.threadStarts === 1 && bot.hasText("New Codex thread"));

    await injectText(bot, "/fork", 3, now);
    await waitFor(() => runtime.threadForks === 1 && bot.hasText("Forked Codex thread"));

    await injectText(bot, "/threads", 4, now);
    await waitFor(() => bot.hasText("Threads:"));

    await injectText(bot, "Reply exactly: OK", 5, now);
    await waitFor(() => runtime.turnStarts === 1);

    await injectText(bot, "/stop", 6, now);
    await waitFor(() => runtime.turnInterrupts === 1);

    await injectText(bot, "/switch thread-roundtrip-1", 7, now);
    await waitFor(() => runtime.threadResumes === 1 && bot.hasText("Switched to"));

    broker.emitPending({
      id: "approval-roundtrip-1",
      appServerRequestId: 7001,
      method: approvalMethod,
      params: {
        threadId: "thread-roundtrip-1",
        command: "echo codex-im-roundtrip",
        cwd: workspace,
      },
      createdAt: now(),
      expiresAt: new Date(now().getTime() + 30 * 60 * 1000),
    });
    await waitFor(() => bot.approvalMessages.length === 1);

    const approval = bot.approvalMessages[0];
    const callbackData = approval?.callbackData[0];
    if (approval === undefined || callbackData === undefined) {
      throw new Error("smoke:daemon-roundtrip did not render an approval callback button");
    }
    await bot.injectCallbackQuery({
      target: TARGET,
      sender: SENDER,
      callbackData,
      callbackQueryId: "callback-roundtrip-1",
      messageId: approval.messageId,
      receivedAt: now(),
    });
    await waitFor(() => broker.callbackResolves === 1 && bot.callbackAnswers.length === 1);

    const result: DaemonRoundtripSmokeResult = {
      ok: true,
      botStarted: bot.started,
      botStopped: false,
      threadStarts: runtime.threadStarts,
      threadForks: runtime.threadForks,
      threadResumes: runtime.threadResumes,
      turnStarts: runtime.turnStarts,
      turnInterrupts: runtime.turnInterrupts,
      approvalCards: bot.approvalMessages.length,
      callbackResolves: broker.callbackResolves,
      callbackAnswers: bot.callbackAnswers.length,
      knownThreads: threadSessions.listForTarget(TARGET, { limit: 20 }).length,
    };
    output(
      [
        "smoke:daemon-roundtrip ok",
        `threadStarts=${result.threadStarts}`,
        `threadForks=${result.threadForks}`,
        `threadResumes=${result.threadResumes}`,
        `turnStarts=${result.turnStarts}`,
        `turnInterrupts=${result.turnInterrupts}`,
        `approvalCards=${result.approvalCards}`,
        `callbackResolves=${result.callbackResolves}`,
        `knownThreads=${result.knownThreads}`,
      ].join(" "),
    );
    return result;
  } finally {
    await daemon.stop();
  }
}

export async function run(): Promise<void> {
  await runDaemonRoundtripSmokeCore({ env: process.env });
}

class RoundtripRuntime {
  threadStarts = 0;
  threadForks = 0;
  threadResumes = 0;
  turnStarts = 0;
  turnInterrupts = 0;
  #nextThread = 1;
  #nextFork = 1;
  #nextTurn = 1;

  threadStart(): { thread: { id: string } } {
    this.threadStarts++;
    return { thread: { id: `thread-roundtrip-${this.#nextThread++}` } };
  }

  threadFork(): { thread: { id: string } } {
    this.threadForks++;
    return { thread: { id: `thread-forked-${this.#nextFork++}` } };
  }

  threadResume(): { thread: { id: string } } {
    this.threadResumes++;
    return { thread: { id: "thread-roundtrip-1" } };
  }

  turnStart(): { turn: { id: string } } {
    this.turnStarts++;
    return { turn: { id: `turn-roundtrip-${this.#nextTurn++}` } };
  }

  turnSteer(): Record<string, never> {
    return {};
  }

  turnInterrupt(): Record<string, never> {
    this.turnInterrupts++;
    return {};
  }
}

class RoundtripBroker {
  callbackResolves = 0;
  #handler: ((snapshot: PendingApprovalSnapshot) => void) | undefined;
  readonly #pending = new Map<string, PendingApprovalSnapshot>();
  readonly #now: () => Date;

  constructor(now: () => Date) {
    this.#now = now;
  }

  attach(): void {}

  enablePendingMode(): void {}

  onPendingCreated(handler: (snapshot: PendingApprovalSnapshot) => void): () => void {
    this.#handler = handler;
    return () => {
      this.#handler = undefined;
    };
  }

  bindActorPolicy(): { kind: "ok" } {
    return { kind: "ok" };
  }

  listPending(): readonly PendingApprovalSnapshot[] {
    return [...this.#pending.values()];
  }

  approvalRecordCount(): number {
    return this.#pending.size;
  }

  resolve(input: { approvalId: string }): { kind: "ok"; appliedAt: Date } {
    this.callbackResolves++;
    this.#pending.delete(input.approvalId);
    return { kind: "ok", appliedAt: this.#now() };
  }

  emitPending(snapshot: PendingApprovalSnapshot): void {
    this.#pending.set(snapshot.id, snapshot);
    this.#handler?.(snapshot);
  }
}

async function injectText(
  bot: TelegramFakeSmokeBot,
  text: string,
  messageId: number,
  now: () => Date,
): Promise<void> {
  await bot.injectTextMessage({
    target: TARGET,
    sender: SENDER,
    text,
    messageId,
    receivedAt: now(),
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("smoke:daemon-roundtrip timed out waiting for daemon flow");
}
