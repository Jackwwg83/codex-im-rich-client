import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DINGTALK_TOPIC_CARD,
  type DingTalkActionClientLike,
  type DingTalkCardClientLike,
  DingTalkChannelAdapter,
  type DingTalkInboundAction,
  type DingTalkStreamClientLike,
  type DingTalkStreamEventHandler,
  type DingTalkStreamEventLike,
  renderDingTalkApprovalCard,
} from "../src/index.js";

const FIXTURE_DIR = "packages/im-dingtalk/test/fixtures";
const TARGET = { platform: "dingtalk", chatId: "cid_card_group" };
const NOW = new Date("2026-05-02T20:00:00.000Z");

type ApprovalCardInput = Parameters<DingTalkChannelAdapter["sendCard"]>[1];

const CARD: ApprovalCardInput = {
  schemaVersion: "approval-card.v1",
  kind: "command_execution",
  approvalId: "approval-must-not-be-sent",
  summary: "Run pnpm test",
  target: { riskLevel: "high" },
  actions: [
    { kind: "allow_once", wirePayload: "v1:ABCDEFGHIJKLMNOP" },
    { kind: "decline", wirePayload: "v1:QRSTUVWXYZ234567" },
  ],
  status: "pending",
  createdAt: new Date(0),
};

function fixture(name: string): DingTalkStreamEventLike {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as DingTalkStreamEventLike;
}

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

describe("DingTalk approval adapter fake round-trip (JAC-85)", () => {
  it("round-trips card send, validated callback action, update, and ack through fake clients", async () => {
    const streamClient = new FakeDingTalkStreamClient();
    const cardCalls: unknown[] = [];
    const ackCalls: unknown[] = [];
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
        ackCalls.push(input);
      },
    };
    const adapter = new DingTalkChannelAdapter({
      streamClient,
      cardClient,
      actionClient,
      now: () => NOW,
    });
    const seen = vi.fn();
    adapter.onAction(seen);

    await adapter.start();
    const sent = await adapter.sendCard(TARGET, CARD);
    await adapter.updateCard(sent.messageRef, { ...CARD, status: "resolved" });
    await streamClient.inject(DINGTALK_TOPIC_CARD, fixture("card-action-group.json"));
    const action = seen.mock.calls[0]?.[0] as DingTalkInboundAction;
    await adapter.answerAction(action.callbackHandle, {
      ok: false,
      userMessage: "stale or unknown",
    });

    expect(sent).toEqual({
      messageRef: {
        target: TARGET,
        messageId: "ding_card_group_001",
        kind: "approval_card",
        textUpdateMode: "edit",
      },
      callbackNonce: "",
    });
    expect(action.messageRef).toEqual(sent.messageRef);
    expect(action.rawCallbackData).toBe("v1:ABCDEFGHIJKLMNOP");
    expect(action.idempotencyKey).toBe("card:stream_card_group_001:ding_card_group_001:btn_allow");
    expect(cardCalls).toEqual([
      { method: "sendCard", input: { target: TARGET, card: renderDingTalkApprovalCard(CARD) } },
      {
        method: "updateCard",
        input: {
          messageRef: sent.messageRef,
          card: renderDingTalkApprovalCard({ ...CARD, status: "resolved" }),
        },
      },
    ]);
    expect(JSON.stringify(ackCalls)).not.toContain("v1:ABCDEFGHIJKLMNOP");
    expect(ackCalls).toEqual([
      expect.objectContaining({
        streamMessageId: "stream_card_group_001",
        outTrackId: "ding_card_group_001",
        ack: { ok: false, userMessage: "stale or unknown" },
      }),
    ]);
  });

  it("fails closed for unsafe callbacks and invalid ack handles", async () => {
    const streamClient = new FakeDingTalkStreamClient();
    const ackCalls: unknown[] = [];
    const adapter = new DingTalkChannelAdapter({
      streamClient,
      cardClient: {
        async sendCard() {
          return { messageId: "ding_card_group_001" };
        },
        async updateCard() {},
        async editText() {},
      },
      actionClient: {
        async answerAction(input) {
          ackCalls.push(input);
        },
      },
      now: () => NOW,
    });
    const seen = vi.fn();
    adapter.onAction(seen);

    await adapter.start();
    await streamClient.inject(DINGTALK_TOPIC_CARD, fixture("card-action-missing-message-ref.json"));
    await streamClient.inject(DINGTALK_TOPIC_CARD, fixture("card-action-unsafe-payload.json"));

    await expect(
      adapter.answerAction("not-a-dingtalk-callback-handle", {
        ok: false,
        userMessage: "invalid",
      }),
    ).rejects.toThrow("DingTalkChannelAdapter.answerAction invalid callback handle");

    expect(seen).not.toHaveBeenCalled();
    expect(ackCalls).toEqual([]);
  });
});
