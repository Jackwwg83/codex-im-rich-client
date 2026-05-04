import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DINGTALK_TOPIC_CARD,
  DINGTALK_TOPIC_ROBOT,
  type DingTalkActionClientLike,
  type DingTalkCardClientLike,
  DingTalkChannelAdapter,
  type DingTalkStreamClientLike,
  type DingTalkStreamEventHandler,
  type DingTalkStreamEventLike,
} from "@codex-im/im-dingtalk";
import { type CallbackTokenRecord, hashCallbackToken } from "@codex-im/storage-sqlite";
import { describe, expect, it, vi } from "vitest";
import { Daemon } from "../src/index.js";

const FIXTURE_DIR = "packages/im-dingtalk/test/fixtures";
const DINGTALK_PROMPT_TARGET = { platform: "dingtalk", chatId: "staff_test_private" };
const DINGTALK_CARD_TARGET = { platform: "dingtalk", chatId: "cid_card_group" };

class FakeDingTalkStreamClient implements DingTalkStreamClientLike {
  readonly handlers = new Map<string, DingTalkStreamEventHandler>();

  registerCallbackListener(topic: string, handler: DingTalkStreamEventHandler) {
    this.handlers.set(topic, handler);
    return this;
  }

  async connect() {}

  disconnect() {}

  async inject(topic: string, event: DingTalkStreamEventLike): Promise<void> {
    await this.handlers.get(topic)?.(event);
  }
}

function loadFixture(name: string): DingTalkStreamEventLike {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as DingTalkStreamEventLike;
}

async function flushDaemonHandlers(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function callbackRecord(overrides: Partial<CallbackTokenRecord> = {}): CallbackTokenRecord {
  const rawToken = "ABCDEFGHIJKLMNOP";
  return {
    tokenHash: hashCallbackToken(rawToken),
    approvalId: "approval-dingtalk-smoke",
    action: "allow_once",
    callbackNonce: "legacy-unused",
    target: DINGTALK_CARD_TARGET,
    actor: { kind: "im" },
    status: "bound",
    messageRef: { chatId: DINGTALK_CARD_TARGET.chatId, messageId: "ding_card_group_001" },
    createdAt: "2026-05-02T00:00:00.000Z",
    expiresAt: "2026-05-02T00:30:00.000Z",
    ...overrides,
  };
}

describe("fake DingTalk smoke through daemon (JAC-88)", () => {
  it("routes fake DingTalk prompt and handles stale plus successful approval callbacks", async () => {
    const streamClient = new FakeDingTalkStreamClient();
    const actionAcks: unknown[] = [];
    const cardCalls: unknown[] = [];
    const cardClient: DingTalkCardClientLike = {
      async sendCard(input) {
        cardCalls.push({ method: "sendCard", input });
        return { messageId: "ding_card_group_001" };
      },
      async updateCard(input) {
        cardCalls.push({ method: "updateCard", input });
      },
      async editText(input) {
        cardCalls.push({ method: "editText", input });
      },
    };
    const actionClient: DingTalkActionClientLike = {
      async answerAction(input) {
        actionAcks.push(input);
      },
    };
    const adapter = new DingTalkChannelAdapter({
      streamClient,
      cardClient,
      actionClient,
      now: () => new Date("2026-05-02T00:00:00.000Z"),
    });
    const runtime = {
      threadStart: vi.fn(),
      turnStart: vi.fn(() => ({ turn: { id: "turn-dingtalk-smoke" } })),
      turnSteer: vi.fn(),
      turnInterrupt: vi.fn(),
    };
    const sessionRouter = {
      resolve: vi.fn(() => ({
        kind: "bound" as const,
        target: DINGTALK_PROMPT_TARGET,
        projectId: "web",
        cwd: "/repo/web",
        codexThreadId: "thread-dingtalk-smoke",
        defaultModel: "gpt-test",
      })),
      bind: vi.fn(),
    };
    const broker = {
      attach: vi.fn(),
      enablePendingMode: vi.fn(),
      onPendingCreated: vi.fn(() => () => {}),
      resolve: vi.fn(() => ({
        kind: "ok" as const,
        appliedAt: new Date("2026-05-02T00:00:01.000Z"),
      })),
    };
    const staleRecord = callbackRecord({
      approvalId: "approval-dingtalk-stale",
      messageRef: { chatId: DINGTALK_CARD_TARGET.chatId, messageId: "ding_card_other" },
    });
    const successRecord = callbackRecord();
    const lookupResults: CallbackTokenRecord[] = [staleRecord, successRecord];
    const callbackTokenRepository = {
      insert: vi.fn(),
      findByHash: vi.fn(() => lookupResults.shift()),
      casUpdate: vi.fn(() => ({ ...successRecord, status: "used" as const })),
      forceMarkUsed: vi.fn(),
      revokeBoundSiblings: vi.fn(() => []),
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
      renderResolvedApprovalCard: () => ({
        schemaVersion: "approval-card.v1",
        kind: "command_execution",
        approvalId: "approval-dingtalk-smoke",
        summary: "Run pnpm test",
        target: { riskLevel: "high" },
        actions: [{ kind: "allow_once", wirePayload: "v1:ABCDEFGHIJKLMNOP" }],
        status: "resolved",
        createdAt: new Date("2026-05-02T00:00:00.000Z"),
      }),
    });

    await daemon.start();
    await streamClient.inject(DINGTALK_TOPIC_ROBOT, loadFixture("private-text-message.json"));
    await flushDaemonHandlers();

    expect(sessionRouter.resolve).toHaveBeenCalledWith(DINGTALK_PROMPT_TARGET);
    expect(runtime.turnStart).toHaveBeenCalledWith({
      threadId: "thread-dingtalk-smoke",
      input: [{ type: "text", text: "hello from dingtalk", text_elements: [] }],
      cwd: "/repo/web",
      model: "gpt-test",
    });
    expect(sessionRouter.bind).toHaveBeenCalledWith(DINGTALK_PROMPT_TARGET, {
      projectId: "web",
      cwd: "/repo/web",
      codexThreadId: "thread-dingtalk-smoke",
      defaultModel: "gpt-test",
      activeTurnId: "turn-dingtalk-smoke",
    });

    await streamClient.inject(DINGTALK_TOPIC_CARD, loadFixture("card-action-group.json"));
    await flushDaemonHandlers();

    expect(callbackTokenRepository.findByHash).toHaveBeenNthCalledWith(
      1,
      hashCallbackToken("ABCDEFGHIJKLMNOP"),
    );
    expect(broker.resolve).not.toHaveBeenCalled();
    expect(callbackTokenRepository.casUpdate).not.toHaveBeenCalled();
    expect(actionAcks).toEqual([
      expect.objectContaining({
        streamMessageId: "stream_card_group_001",
        outTrackId: "ding_card_group_001",
        ack: { ok: false, userMessage: "stale message" },
      }),
    ]);

    await streamClient.inject(DINGTALK_TOPIC_CARD, loadFixture("card-action-group.json"));
    await flushDaemonHandlers();

    expect(callbackTokenRepository.findByHash).toHaveBeenNthCalledWith(
      2,
      hashCallbackToken("ABCDEFGHIJKLMNOP"),
    );
    expect(broker.resolve).toHaveBeenCalledWith({
      approvalId: "approval-dingtalk-smoke",
      decision: { kind: "allow_once" },
      actor: { kind: "im", platform: "dingtalk", userId: "staff_action_user" },
      target: DINGTALK_CARD_TARGET,
      callbackNonce: "legacy-unused",
    });
    expect(callbackTokenRepository.casUpdate).toHaveBeenCalledWith(
      successRecord.tokenHash,
      "bound",
      "used",
      { actor: { kind: "im", platform: "dingtalk", userId: "staff_action_user" } },
    );
    expect(callbackTokenRepository.forceMarkUsed).not.toHaveBeenCalled();
    expect(callbackTokenRepository.revokeBoundSiblings).toHaveBeenCalledWith(
      "approval-dingtalk-smoke",
      successRecord.tokenHash,
    );
    expect(actionAcks).toEqual([
      expect.objectContaining({
        ack: { ok: false, userMessage: "stale message" },
      }),
      expect.objectContaining({
        ack: { ok: true, userMessage: "decision recorded" },
      }),
    ]);
    expect(cardCalls).toEqual([
      expect.objectContaining({
        method: "updateCard",
        input: expect.objectContaining({
          messageRef: { target: DINGTALK_CARD_TARGET, messageId: "ding_card_group_001" },
        }),
      }),
    ]);
    expect(JSON.stringify(actionAcks)).not.toContain("v1:ABCDEFGHIJKLMNOP");

    await daemon.stop();
  });
});
