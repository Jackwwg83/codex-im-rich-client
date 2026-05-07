import { describe, expect, it, vi } from "vitest";
import { SlackChannelAdapter, type SlackWebClientLike } from "../src/index.js";

const TARGET = { platform: "slack", chatId: "T_TEST:C_TEST", threadKey: "1715000000.000000" };

describe("SlackChannelAdapter.sendFile (JAC-248)", () => {
  it("uploads artifacts through Slack filesUploadV2 and returns a file MessageRef", async () => {
    const webClient: SlackWebClientLike = {
      filesUploadV2: vi.fn(async () => ({ channel: "C_TEST", ts: "1715000003.000100" })),
    };
    const adapter = new SlackChannelAdapter({
      socketClient: { start: async () => {}, disconnect: async () => {} },
      webClient,
    });
    const bytes = new TextEncoder().encode("hello");

    await adapter.start();
    const ref = await adapter.sendFile(TARGET, {
      filename: "artifact.txt",
      bytes,
      contentType: "text/plain",
    });

    expect(webClient.filesUploadV2).toHaveBeenCalledWith({
      channel_id: "C_TEST",
      filename: "artifact.txt",
      title: "artifact.txt",
      file: bytes,
      thread_ts: "1715000000.000000",
    });
    expect(ref).toEqual({
      target: TARGET,
      messageId: "C_TEST:1715000003.000100",
      kind: "file",
    });
  });

  it("fails locally for invalid Slack artifact payloads", async () => {
    const adapter = new SlackChannelAdapter({
      socketClient: { start: async () => {}, disconnect: async () => {} },
      webClient: { filesUploadV2: vi.fn(async () => undefined) },
    });

    await adapter.start();
    await expect(
      adapter.sendFile(TARGET, {
        filename: "",
        bytes: new Uint8Array([1]),
        contentType: "text/plain",
      }),
    ).rejects.toThrow(/filename/);
    await expect(
      adapter.sendFile(TARGET, {
        filename: "empty.txt",
        bytes: new Uint8Array(),
        contentType: "text/plain",
      }),
    ).rejects.toThrow(/empty/);
  });
});
