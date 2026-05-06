import { describe, expect, it } from "vitest";
import {
  DINGTALK_CARD_CALLBACK_TYPE,
  DINGTALK_TOPIC_CARD,
  DINGTALK_TOPIC_ROBOT,
  type DingTalkApprovalCardJson,
  type DingTalkCardClientLike,
  DingTalkChannelAdapter,
  type DingTalkStreamClientLike,
  renderDingTalkApprovalCard,
} from "../src/index.js";

const TARGET = { platform: "dingtalk", chatId: "cid_card_chat" };
const REF = { target: TARGET, messageId: "ding_card_existing" };

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

function fakeStreamClient(): DingTalkStreamClientLike {
  return {
    registerCallbackListener(topic) {
      expect([DINGTALK_TOPIC_ROBOT, DINGTALK_TOPIC_CARD]).toContain(topic);
      return undefined;
    },
    async connect() {},
    disconnect() {},
  };
}

function fakeCardClient(overrides: Partial<DingTalkCardClientLike> = {}): DingTalkCardClientLike {
  return {
    async sendCard() {
      return { messageId: "unused" };
    },
    async updateCard() {},
    async editText() {},
    ...overrides,
  };
}

describe("DingTalkChannelAdapter card send/update (JAC-82)", () => {
  it("renders only opaque wirePayload values into DingTalk card actions", () => {
    const card = renderDingTalkApprovalCard(CARD);
    const serialized = JSON.stringify(card);

    expect(card.callbackType).toBe(DINGTALK_CARD_CALLBACK_TYPE);
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

  it("sends a DingTalk approval card and maps returned id into MessageRef", async () => {
    const calls: unknown[] = [];
    const adapter = new DingTalkChannelAdapter({
      streamClient: fakeStreamClient(),
      cardClient: fakeCardClient({
        async sendCard(input) {
          calls.push(input);
          return { messageId: "ding_card_sent" };
        },
      }),
    });

    await adapter.start();
    const result = await adapter.sendCard(TARGET, CARD);

    expect(calls).toEqual([{ target: TARGET, card: renderDingTalkApprovalCard(CARD) }]);
    expect(result).toEqual({
      messageRef: {
        target: TARGET,
        messageId: "ding_card_sent",
        kind: "approval_card",
        textUpdateMode: "edit",
      },
      callbackNonce: "",
    });
  });

  it("updates a DingTalk approval card by original messageRef", async () => {
    const calls: unknown[] = [];
    const updated = { ...CARD, status: "resolved" as const };
    const adapter = new DingTalkChannelAdapter({
      streamClient: fakeStreamClient(),
      cardClient: fakeCardClient({
        async updateCard(input) {
          calls.push(input);
        },
      }),
    });

    await adapter.start();
    await adapter.updateCard(REF, updated);

    expect(calls).toEqual([{ messageRef: REF, card: renderDingTalkApprovalCard(updated) }]);
    expect(JSON.stringify(calls)).toContain("resolved");
  });

  it("edits text through the injected DingTalk card client", async () => {
    const calls: unknown[] = [];
    const adapter = new DingTalkChannelAdapter({
      streamClient: fakeStreamClient(),
      cardClient: fakeCardClient({
        async editText(input) {
          calls.push(input);
        },
      }),
    });

    await adapter.start();
    await adapter.editText(REF, "updated text");

    expect(calls).toEqual([{ messageRef: REF, text: "updated text" }]);
  });

  it("fails locally when an action has no wirePayload", async () => {
    const adapter = new DingTalkChannelAdapter({
      streamClient: fakeStreamClient(),
      cardClient: fakeCardClient({
        async sendCard() {
          throw new Error("must not call remote send");
        },
      }),
    });

    await adapter.start();

    await expect(
      adapter.sendCard(TARGET, { ...CARD, actions: [{ kind: "decline" }] }),
    ).rejects.toThrow(/wirePayload/);
  });

  it("fails locally when wirePayload is not the v1 opaque token shape", async () => {
    const adapter = new DingTalkChannelAdapter({
      streamClient: fakeStreamClient(),
      cardClient: fakeCardClient({
        async sendCard() {
          throw new Error("must not call remote send");
        },
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

  it("surfaces send/update/edit failures without optimistic success", async () => {
    const adapter = new DingTalkChannelAdapter({
      streamClient: fakeStreamClient(),
      cardClient: fakeCardClient({
        async sendCard() {
          throw new Error("send rejected");
        },
        async updateCard() {
          throw new Error("update rejected");
        },
        async editText() {
          throw new Error("edit rejected");
        },
      }),
    });

    await adapter.start();

    await expect(adapter.sendCard(TARGET, CARD)).rejects.toThrow(
      "DingTalkChannelAdapter.sendCard failed: send rejected",
    );
    await expect(adapter.updateCard(REF, CARD)).rejects.toThrow(
      "DingTalkChannelAdapter.updateCard failed: update rejected",
    );
    await expect(adapter.editText(REF, "body")).rejects.toThrow(
      "DingTalkChannelAdapter.editText failed: edit rejected",
    );
  });

  it("fails closed before start and when card client is missing", async () => {
    const adapter = new DingTalkChannelAdapter({ streamClient: fakeStreamClient() });

    await expect(adapter.sendCard(TARGET, CARD)).rejects.toThrow(
      "DingTalkChannelAdapter.sendCard requires start() first",
    );

    await adapter.start();

    await expect(adapter.sendCard(TARGET, CARD)).rejects.toThrow(
      "DingTalkChannelAdapter.sendCard requires an injected cardClient",
    );
  });
});

function actionButtons(card: DingTalkApprovalCardJson) {
  return card.actions;
}
