import { describe, expect, it } from "vitest";
import {
  LarkChannelAdapter,
  type LarkMessageClientLike,
  type LarkWsClientLike,
  renderLarkApprovalCard,
} from "../src/index.js";

const TARGET = { platform: "lark", chatId: "oc_card_chat" };
const REF = { target: TARGET, messageId: "om_existing_card" };

type ApprovalCardInput = Parameters<LarkChannelAdapter["sendCard"]>[1];

const BASE_CARD: ApprovalCardInput = {
  schemaVersion: "approval-card.v1",
  kind: "command_execution",
  approvalId: "approval-not-rendered",
  summary: "Run pnpm test",
  target: { riskLevel: "high" },
  actions: [{ kind: "decline", wirePayload: "v1:ABCDEFGHIJKLMNOP" }],
  status: "pending",
  createdAt: new Date(0),
};

function fakeWsClient(): LarkWsClientLike {
  return {
    async start() {},
    close() {},
  };
}

function fakeMessageClient(
  updateCard: NonNullable<LarkMessageClientLike["updateCard"]>,
): LarkMessageClientLike {
  return {
    async sendText() {
      return { messageId: "unused" };
    },
    async editText() {},
    async sendCard() {
      return { messageId: "unused" };
    },
    updateCard,
  };
}

describe("LarkChannelAdapter.updateCard (JAC-155)", () => {
  it.each(["pending", "resolved", "expired", "transport_lost"] as const)(
    "updates %s status card by original messageRef",
    async (status) => {
      const calls: unknown[] = [];
      const card = { ...BASE_CARD, status };
      const adapter = new LarkChannelAdapter({
        wsClient: fakeWsClient(),
        messageClient: fakeMessageClient(async (input) => {
          calls.push(input);
        }),
      });

      await adapter.start();
      await adapter.updateCard(REF, card);

      expect(calls).toEqual([{ messageRef: REF, card: renderLarkApprovalCard(card) }]);
      expect(JSON.stringify(calls)).toContain(`**Status:** ${status}`);
    },
  );

  it("fails fast when updateCard client method is missing", async () => {
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      messageClient: {
        async sendText() {
          return { messageId: "unused" };
        },
        async editText() {},
      },
    });

    await adapter.start();

    await expect(adapter.updateCard(REF, BASE_CARD)).rejects.toThrow(
      "LarkChannelAdapter.updateCard requires messageClient.updateCard",
    );
  });

  it("surfaces update failures without optimistic success", async () => {
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      messageClient: fakeMessageClient(async () => {
        throw new Error("update rejected");
      }),
    });

    await adapter.start();

    await expect(adapter.updateCard(REF, BASE_CARD)).rejects.toThrow(
      "LarkChannelAdapter.updateCard failed: update rejected",
    );
  });
});
