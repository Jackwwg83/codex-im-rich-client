import { describe, expect, it, vi } from "vitest";
import { SlackChannelAdapter } from "../src/index.js";

describe("SlackChannelAdapter text output (JAC-245)", () => {
  it("sends threaded Slack text and returns an editable MessageRef", async () => {
    const webClient = {
      chatPostMessage: vi.fn(async () => ({ channel: "C_TEST", ts: "1715000002.000100" })),
    };
    const adapter = new SlackChannelAdapter({
      socketClient: { start: async () => {}, disconnect: async () => {} },
      webClient,
    });

    await adapter.start();
    const ref = await adapter.sendText(
      { platform: "slack", chatId: "T_TEST:C_TEST", threadKey: "1715000000.000000" },
      "running",
    );

    expect(webClient.chatPostMessage).toHaveBeenCalledWith({
      channel: "C_TEST",
      text: "running",
      thread_ts: "1715000000.000000",
    });
    expect(ref).toEqual({
      target: { platform: "slack", chatId: "T_TEST:C_TEST", threadKey: "1715000000.000000" },
      messageId: "C_TEST:1715000002.000100",
      kind: "text",
      textUpdateMode: "edit",
    });
  });

  it("edits bot-owned Slack text by channel and timestamp", async () => {
    const webClient = {
      chatUpdate: vi.fn(async () => undefined),
    };
    const adapter = new SlackChannelAdapter({
      socketClient: { start: async () => {}, disconnect: async () => {} },
      webClient,
    });

    await adapter.start();
    await adapter.editText(
      {
        target: { platform: "slack", chatId: "T_TEST:C_TEST" },
        messageId: "C_TEST:1715000002.000100",
        kind: "text",
        textUpdateMode: "edit",
      },
      "done",
    );

    expect(webClient.chatUpdate).toHaveBeenCalledWith({
      channel: "C_TEST",
      ts: "1715000002.000100",
      text: "done",
    });
  });

  it("replies to slash-command refs by posting a new Slack message", async () => {
    const webClient = {
      chatPostMessage: vi.fn(async () => ({ channel: "C_TEST", ts: "1715000003.000100" })),
    };
    const adapter = new SlackChannelAdapter({
      socketClient: { start: async () => {}, disconnect: async () => {} },
      webClient,
    });

    await adapter.start();
    await adapter.editText(
      {
        target: { platform: "slack", chatId: "T_TEST:C_TEST" },
        messageId: "slash:trigger-1",
        kind: "inbound",
        textUpdateMode: "append",
      },
      "Codex status",
    );

    expect(webClient.chatPostMessage).toHaveBeenCalledWith({
      channel: "C_TEST",
      text: "Codex status",
    });
  });
});
