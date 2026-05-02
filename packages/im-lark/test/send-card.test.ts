import { describe, expect, it } from "vitest";
import {
  LARK_CARD_MAX_CONTENT_BYTES,
  LARK_CARD_UPDATE_MAX_QPS_PER_MESSAGE,
  type LarkApprovalCardJson,
  LarkChannelAdapter,
  type LarkMessageClientLike,
  type LarkWsClientLike,
  renderLarkApprovalCard,
} from "../src/index.js";

const TARGET = { platform: "lark", chatId: "oc_card_chat" };

type ApprovalCardInput = Parameters<LarkChannelAdapter["sendCard"]>[1];

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

function fakeWsClient(): LarkWsClientLike {
  return {
    async start() {},
    close() {},
  };
}

function fakeMessageClient(
  sendCard: NonNullable<LarkMessageClientLike["sendCard"]>,
): LarkMessageClientLike {
  return {
    async sendText() {
      return { messageId: "unused" };
    },
    async editText() {},
    sendCard,
  };
}

describe("LarkChannelAdapter.sendCard (JAC-154)", () => {
  it("renders only opaque wirePayload values into Lark action payloads", () => {
    const card = renderLarkApprovalCard(CARD);
    const serialized = JSON.stringify(card);

    expect(serialized).toContain("v1:ABCDEFGHIJKLMNOP");
    expect(serialized).toContain("v1:QRSTUVWXYZ234567");
    expect(serialized).not.toContain("approval-must-not-be-sent");
    expect(serialized).not.toContain("allow_once");
    expect(serialized).not.toContain("decline");

    expect(actionButtons(card).map((button) => button.value)).toEqual([
      "v1:ABCDEFGHIJKLMNOP",
      "v1:QRSTUVWXYZ234567",
    ]);
  });

  it("pins Lark card payload and update-rate assumptions", () => {
    const card = renderLarkApprovalCard(CARD);
    const byteLength = new TextEncoder().encode(JSON.stringify(card)).byteLength;

    expect(byteLength).toBeLessThanOrEqual(LARK_CARD_MAX_CONTENT_BYTES);
    expect(LARK_CARD_MAX_CONTENT_BYTES).toBe(30 * 1024);
    expect(LARK_CARD_UPDATE_MAX_QPS_PER_MESSAGE).toBe(5);
  });

  it("sends a Lark approval card and maps returned message id into MessageRef", async () => {
    const calls: unknown[] = [];
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      messageClient: fakeMessageClient(async (input) => {
        calls.push(input);
        return { messageId: "om_lark_card" };
      }),
    });

    await adapter.start();
    const result = await adapter.sendCard(TARGET, CARD);

    expect(calls).toEqual([{ target: TARGET, card: renderLarkApprovalCard(CARD) }]);
    expect(result).toEqual({
      messageRef: { target: TARGET, messageId: "om_lark_card" },
      callbackNonce: "",
    });
  });

  it("fails locally when an action has no wirePayload", async () => {
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      messageClient: fakeMessageClient(async () => {
        throw new Error("must not call remote send");
      }),
    });

    await adapter.start();

    await expect(
      adapter.sendCard(TARGET, { ...CARD, actions: [{ kind: "decline" }] }),
    ).rejects.toThrow(/wirePayload/);
  });

  it("fails locally when wirePayload is not the v1 opaque token shape", async () => {
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      messageClient: fakeMessageClient(async () => {
        throw new Error("must not call remote send");
      }),
    });

    await adapter.start();

    await expect(
      adapter.sendCard(TARGET, {
        ...CARD,
        actions: [{ kind: "decline", wirePayload: "approval-1|decline|nonce" }],
      }),
    ).rejects.toThrow(/v1 opaque/);
  });

  it("surfaces send failures without mutating the rendered card", async () => {
    const rendered = renderLarkApprovalCard(CARD);
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      messageClient: fakeMessageClient(async (input) => {
        expect(input.card).toEqual(rendered);
        throw new Error("remote card rejected");
      }),
    });

    await adapter.start();

    await expect(adapter.sendCard(TARGET, CARD)).rejects.toThrow(
      "LarkChannelAdapter.sendCard failed: remote card rejected",
    );
  });
});

function actionButtons(card: LarkApprovalCardJson) {
  const actionElement = card.elements.find((element) => element.tag === "action");
  return actionElement?.tag === "action" ? actionElement.actions : [];
}
