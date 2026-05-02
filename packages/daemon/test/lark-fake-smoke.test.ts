import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type LarkActionClientLike,
  LarkChannelAdapter,
  type LarkEventDispatcherLike,
  type LarkEventHandlerMap,
  type LarkMessageClientLike,
  type LarkRawCardActionInput,
  type LarkRawMessageEvent,
  type LarkWsClientLike,
} from "@codex-im/im-lark";
import { type CallbackTokenRecord, hashCallbackToken } from "@codex-im/storage-sqlite";
import { describe, expect, it, vi } from "vitest";
import { Daemon } from "../src/index.js";

const FIXTURE_DIR = "packages/im-lark/test/fixtures";
const LARK_PROMPT_TARGET = { platform: "lark", chatId: "oc_test_private_chat" };
const LARK_CARD_TARGET = { platform: "lark", chatId: "oc_card_private" };

class FakeLarkEventDispatcher implements LarkEventDispatcherLike {
  readonly actionHandlers: Array<(event: LarkRawCardActionInput) => void | Promise<void>> = [];
  readonly messageHandlers: Array<(event: LarkRawMessageEvent) => void | Promise<void>> = [];

  register(handlers: LarkEventHandlerMap) {
    if (handlers["card.action.trigger"] !== undefined) {
      this.actionHandlers.push(handlers["card.action.trigger"]);
    }
    if (handlers["im.message.receive_v1"] !== undefined) {
      this.messageHandlers.push(handlers["im.message.receive_v1"]);
    }
    return this;
  }

  async injectAction(event: LarkRawCardActionInput): Promise<void> {
    await Promise.all(this.actionHandlers.map((handler) => handler(event)));
  }

  async injectMessage(event: LarkRawMessageEvent): Promise<void> {
    await Promise.all(this.messageHandlers.map((handler) => handler(event)));
  }
}

function loadMessageFixture(name: string): LarkRawMessageEvent {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as LarkRawMessageEvent;
}

function loadActionFixture(name: string): LarkRawCardActionInput {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as LarkRawCardActionInput;
}

function fakeWsClient(): LarkWsClientLike {
  return {
    async start() {},
    close() {},
  };
}

function fakeMessageClient(): LarkMessageClientLike {
  return {
    async sendText() {
      return { messageId: "om_unused_text" };
    },
    async editText() {},
    async sendCard() {
      return { messageId: "om_unused_card" };
    },
    async updateCard() {},
  };
}

async function flushDaemonHandlers(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("fake Lark smoke through daemon (JAC-160)", () => {
  it("routes fake Lark inbound text and fails closed on stale approval messageRef", async () => {
    const dispatcher = new FakeLarkEventDispatcher();
    const actionAcks: unknown[] = [];
    const actionClient: LarkActionClientLike = {
      async answerAction(input) {
        actionAcks.push(input);
      },
    };
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      messageClient: fakeMessageClient(),
      actionClient,
      createEventDispatcher: () => dispatcher,
      now: () => new Date("2026-05-02T00:00:00.000Z"),
    });
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(() => ({ turn: { id: "turn-lark-smoke" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target: LARK_PROMPT_TARGET,
        projectId: "web",
        cwd: "/repo/web",
        codexThreadId: "thread-lark-smoke",
        defaultModel: "gpt-test",
      })),
      bind: vi.fn(),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn(() => () => {}),
      resolve: vi.fn(),
    };
    const staleRecord: CallbackTokenRecord = {
      tokenHash: hashCallbackToken("ABCDEFGHIJKLMNOP"),
      approvalId: "approval-lark-stale",
      action: "decline",
      callbackNonce: "legacy-unused",
      target: LARK_CARD_TARGET,
      actor: { kind: "im" },
      status: "bound",
      messageRef: { chatId: LARK_CARD_TARGET.chatId, messageId: "om_original_card" },
      createdAt: "2026-05-02T00:00:00.000Z",
      expiresAt: "2026-05-02T00:30:00.000Z",
    };
    const callbackTokenRepository = {
      insert: vi.fn(),
      findByHash: vi.fn(() => staleRecord),
      casUpdate: vi.fn(),
    };

    const daemon = new Daemon({
      loadConfig: () => ({}),
      openStorage: () => ({}),
      createBroker: () => broker,
      createSecurityPolicy: () => ({
        checkUserAndChat: vi.fn(() => ({ kind: "allow" as const })),
      }),
      createSessionRouter: () => sessionRouter,
      createSupervisor: () => ({ currentRuntime: () => runtime }),
      createAdapter: () => adapter,
      callbackTokenRepository,
    });

    await daemon.start();
    await dispatcher.injectMessage(loadMessageFixture("private-message.json"));
    await flushDaemonHandlers();

    expect(sessionRouter.resolve).toHaveBeenCalledWith(LARK_PROMPT_TARGET);
    expect(runtime.turnStart).toHaveBeenCalledWith({
      threadId: "thread-lark-smoke",
      input: [{ type: "text", text: "hello codex", text_elements: [] }],
      cwd: "/repo/web",
      model: "gpt-test",
    });
    expect(sessionRouter.bind).toHaveBeenCalledWith(LARK_PROMPT_TARGET, {
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-lark-smoke",
      defaultModel: "gpt-test",
      activeTurnId: "turn-lark-smoke",
    });

    await dispatcher.injectAction(loadActionFixture("card-action-private.json"));
    await flushDaemonHandlers();

    expect(callbackTokenRepository.findByHash).toHaveBeenCalledWith(
      hashCallbackToken("ABCDEFGHIJKLMNOP"),
    );
    expect(callbackTokenRepository.casUpdate).not.toHaveBeenCalled();
    expect(broker.resolve).not.toHaveBeenCalled();
    expect(actionAcks).toEqual([
      expect.objectContaining({
        eventId: "ev_private_card_action",
        ack: { ok: false, userMessage: "stale message" },
      }),
    ]);
    expect(JSON.stringify(actionAcks)).not.toContain("v1:ABCDEFGHIJKLMNOP");
  });
});
