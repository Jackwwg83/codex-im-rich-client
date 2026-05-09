import type {
  SecurityPolicySender,
  SessionBindingInput,
  SessionRoute,
  Target,
} from "@codex-im/core";
import { Daemon } from "@codex-im/daemon";
import { TelegramChannelAdapter, TelegramFakeSmokeBot } from "@codex-im/im-telegram";

export interface TelegramFakeSmokeResult {
  readonly ok: true;
  readonly botStarted: boolean;
  readonly botStopped: boolean;
  readonly threadStarts: number;
  readonly turnStarts: number;
  readonly turnSteers: number;
  readonly boundThreadId: string;
  readonly activeTurnId: string;
}

export interface RunTelegramFakeSmokeOptions {
  readonly env?: Record<string, string | undefined>;
  readonly now?: () => Date;
  readonly output?: (line: string) => void;
}

const TARGET: Target = { platform: "telegram", chatId: "-1009876543210", topicId: "42" };
const SENDER: SecurityPolicySender = { userId: "555666777", displayName: "ci-operator" };

export async function runTelegramFakeSmokeCore(
  options: RunTelegramFakeSmokeOptions = {},
): Promise<TelegramFakeSmokeResult> {
  const output = options.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const bot = new TelegramFakeSmokeBot();
  const adapter = new TelegramChannelAdapter({ bot, now });
  const calls = {
    threadStarts: 0,
    turnStarts: 0,
    turnSteers: 0,
    boundThreadId: "",
    activeTurnId: "",
  };
  let route: Extract<SessionRoute, { kind: "bound" }> = {
    kind: "bound",
    target: TARGET,
    projectId: "codex-im",
    cwd: "/tmp/codex-im-fake-smoke",
  };

  const runtime = {
    threadStart: async () => {
      calls.threadStarts++;
      return { thread: { id: "thread-fake-1" } };
    },
    turnStart: async () => {
      calls.turnStarts++;
      return { turn: { id: "turn-fake-1" } };
    },
    turnSteer: async () => {
      calls.turnSteers++;
      return {};
    },
  };

  const daemon = new Daemon({
    loadConfig: () => ({ mode: "telegram-fake-smoke" }),
    openStorage: () => ({ close: () => undefined }),
    createBroker: () => ({
      attach: () => undefined,
      enablePendingMode: () => undefined,
    }),
    createSecurityPolicy: () => ({
      checkUserAndChat: (_target: Target, _sender: SecurityPolicySender) => ({ kind: "allow" }),
      checkProjectAccess: (_projectId: string, _target: Target, _sender: SecurityPolicySender) => ({
        kind: "allow",
      }),
    }),
    createSessionRouter: () => ({
      resolve: () => route,
      bind: (target: Target, input: SessionBindingInput) => {
        route = {
          kind: "bound",
          target,
          ...(input.contextKind === undefined ? {} : { contextKind: input.contextKind }),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          ...(input.projectLabel === undefined ? {} : { projectLabel: input.projectLabel }),
          cwd: input.cwd,
          ...(input.defaultModel === undefined ? {} : { defaultModel: input.defaultModel }),
          ...(input.codexThreadId === undefined ? {} : { codexThreadId: input.codexThreadId }),
          ...(input.activeTurnId === undefined ? {} : { activeTurnId: input.activeTurnId }),
        };
        calls.activeTurnId = input.activeTurnId ?? calls.activeTurnId;
        return route;
      },
      bindThread: (_target: Target, codexThreadId: string) => {
        route = { ...route, codexThreadId };
        calls.boundThreadId = codexThreadId;
        return route;
      },
    }),
    createSupervisor: () => ({
      currentRuntime: () => runtime,
      stop: async () => undefined,
    }),
    createAdapter: () => adapter,
    schedulePrune: () => () => undefined,
    now,
  });

  await daemon.start();
  await bot.injectTextMessage({
    target: TARGET,
    sender: SENDER,
    messageId: 33,
    receivedAt: now(),
    text: "run tests",
  });
  await waitFor(() => calls.turnStarts === 1);
  await daemon.stop();

  const result: TelegramFakeSmokeResult = {
    ok: true,
    botStarted: bot.started,
    botStopped: bot.stopped,
    threadStarts: calls.threadStarts,
    turnStarts: calls.turnStarts,
    turnSteers: calls.turnSteers,
    boundThreadId: calls.boundThreadId,
    activeTurnId: calls.activeTurnId,
  };
  output(
    `smoke:telegram-fake ok threadStarts=${result.threadStarts} turnStarts=${result.turnStarts} turnSteers=${result.turnSteers}`,
  );
  return result;
}

export async function run(): Promise<void> {
  await runTelegramFakeSmokeCore({ env: process.env });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("smoke:telegram-fake timed out waiting for fake daemon flow");
}
