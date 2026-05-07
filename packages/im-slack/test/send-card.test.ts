import { describe, expect, it, vi } from "vitest";
import {
  SlackChannelAdapter,
  type SlackWebClientLike,
  renderSlackApprovalCard,
} from "../src/index.js";

const TARGET = { platform: "slack", chatId: "T_TEST:C_TEST", threadKey: "1715000000.000000" };

type ApprovalCardInput = Parameters<SlackChannelAdapter["sendCard"]>[1];

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

describe("SlackChannelAdapter.sendCard (JAC-246)", () => {
  it("renders only opaque wirePayload values into Slack Block Kit buttons", () => {
    const message = renderSlackApprovalCard(CARD);
    const serialized = JSON.stringify(message);

    expect(serialized).toContain("v1:ABCDEFGHIJKLMNOP");
    expect(serialized).toContain("v1:QRSTUVWXYZ234567");
    expect(serialized).not.toContain("approval-must-not-be-sent");
    expect(serialized).not.toContain("allow_once");
    expect(serialized).not.toContain("decline");
    expect(actionValues(message)).toEqual(["v1:ABCDEFGHIJKLMNOP", "v1:QRSTUVWXYZ234567"]);
  });

  it("sends a Slack approval card and maps returned message ts into MessageRef", async () => {
    const webClient: SlackWebClientLike = {
      chatPostMessage: vi.fn(async () => ({ channel: "C_TEST", ts: "1715000002.000100" })),
    };
    const adapter = new SlackChannelAdapter({
      socketClient: { start: async () => {}, disconnect: async () => {} },
      webClient,
    });

    await adapter.start();
    const result = await adapter.sendCard(TARGET, CARD);

    expect(webClient.chatPostMessage).toHaveBeenCalledWith({
      channel: "C_TEST",
      text: "Codex approval",
      blocks: renderSlackApprovalCard(CARD).blocks,
      thread_ts: "1715000000.000000",
    });
    expect(result).toEqual({
      messageRef: {
        target: TARGET,
        messageId: "C_TEST:1715000002.000100",
        kind: "approval_card",
        textUpdateMode: "edit",
      },
      callbackNonce: "",
    });
  });

  it("updates a Slack approval card by channel and timestamp", async () => {
    const now = new Date("2024-05-06T13:10:00.000Z");
    const webClient: SlackWebClientLike = {
      chatUpdate: vi.fn(async () => undefined),
    };
    const adapter = new SlackChannelAdapter({
      socketClient: { start: async () => {}, disconnect: async () => {} },
      webClient,
      now: () => now,
    });

    await adapter.start();
    await adapter.updateCard(
      { target: TARGET, messageId: "C_TEST:1715000002.000100", kind: "approval_card" },
      CARD,
    );

    expect(webClient.chatUpdate).toHaveBeenCalledWith({
      channel: "C_TEST",
      ts: "1715000002.000100",
      text: "Codex approval",
      blocks: renderSlackApprovalCard(CARD, { blockIdSuffix: String(now.getTime()) }).blocks,
    });
    const updatedBlocks = firstChatUpdateBlocks(webClient);
    expect(actionBlockId(updatedBlocks)).toBe(`codex_im_approval_actions:${now.getTime()}`);
  });

  it("fails locally when an action has no wirePayload", async () => {
    expect(() => renderSlackApprovalCard({ ...CARD, actions: [{ kind: "decline" }] })).toThrow(
      /wirePayload/,
    );
  });

  it("fails locally when wirePayload is not the v1 opaque token shape", async () => {
    expect(() =>
      renderSlackApprovalCard({
        ...CARD,
        actions: [{ kind: "decline", wirePayload: "approval-1|decline|nonce" }],
      }),
    ).toThrow(/v1 opaque/);
  });
});

function actionValues(message: ReturnType<typeof renderSlackApprovalCard>): string[] {
  return message.blocks
    .flatMap((block) => ("elements" in block ? block.elements : []))
    .map((element) => element.value);
}

function actionBlockId(
  blocks: readonly ReturnType<typeof renderSlackApprovalCard>["blocks"][number][],
): string {
  const block = blocks.find((candidate) => "elements" in candidate);
  if (block === undefined || !("block_id" in block)) {
    throw new Error("missing actions block");
  }
  return block.block_id;
}

function firstChatUpdate(
  webClient: SlackWebClientLike,
): Parameters<NonNullable<SlackWebClientLike["chatUpdate"]>>[0] {
  if (webClient.chatUpdate === undefined) {
    throw new Error("chatUpdate is missing");
  }
  const calls = vi.mocked(webClient.chatUpdate).mock.calls;
  if (calls.length === 0) {
    throw new Error("chatUpdate was not called");
  }
  const firstCall = calls[0];
  if (firstCall === undefined) {
    throw new Error("chatUpdate first call missing");
  }
  return firstCall[0];
}

function firstChatUpdateBlocks(
  webClient: SlackWebClientLike,
): readonly ReturnType<typeof renderSlackApprovalCard>["blocks"][number][] {
  const blocks = firstChatUpdate(webClient).blocks;
  if (blocks === undefined) {
    throw new Error("chatUpdate did not include blocks");
  }
  return blocks;
}
