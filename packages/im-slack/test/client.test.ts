import { describe, expect, it, vi } from "vitest";
import { SlackChannelAdapter } from "../src/adapter.js";
import { createSlackSdkChannelAdapter, createSlackWebApiClient } from "../src/client.js";

describe("Slack production clients", () => {
  it("posts Slack text through Web API without exposing token in the body", async () => {
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
      jsonResponse({ ok: true, channel: "C_TEST", ts: "1.2" }),
    );
    const client = createSlackWebApiClient({
      botToken: "xoxb-test-token-never-log",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.chatPostMessage?.({ channel: "C_TEST", text: "hello" })).resolves.toEqual({
      channel: "C_TEST",
      ts: "1.2",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer xoxb-test-token-never-log",
          "Content-Type": "application/json",
        }),
      }),
    );
    const firstRequest = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.stringify(firstRequest?.body)).not.toContain("xoxb-test");
  });

  it("uploads Slack files through the external upload sequence", async () => {
    const fetchImpl = vi
      .fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
        jsonResponse({ ok: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, upload_url: "https://upload.test", file_id: "F_TEST" }),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, files: [{ id: "F_TEST", title: "out.txt" }] }),
      );
    const client = createSlackWebApiClient({
      botToken: "xoxb-file-token-never-log",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.filesUploadV2?.({
        channel_id: "C_TEST",
        filename: "out.txt",
        title: "out.txt",
        file: new Uint8Array([1, 2, 3]),
        thread_ts: "123.456",
      }),
    ).resolves.toEqual({ channel: "C_TEST", ts: "F_TEST" });

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "https://slack.com/api/files.getUploadURLExternal",
      "https://upload.test",
      "https://slack.com/api/files.completeUploadExternal",
    ]);
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("files.upload");
  });

  it("builds a SlackChannelAdapter from injected production clients", async () => {
    const socketClient = {
      on: vi.fn(),
      start: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    };
    const adapter = createSlackSdkChannelAdapter({
      botToken: "xoxb-token",
      appToken: "xapp-token",
      socketClient,
      webClient: { chatPostMessage: vi.fn(async () => ({ channel: "C_TEST", ts: "1.2" })) },
    });

    expect(adapter).toBeInstanceOf(SlackChannelAdapter);
    await adapter.start();
    await adapter.stop();
    expect(socketClient.start).toHaveBeenCalled();
    expect(socketClient.disconnect).toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
