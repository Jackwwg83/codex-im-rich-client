import { describe, expect, it, vi } from "vitest";
import {
  SlackChannelAdapter,
  type SlackSocketModeEventName,
  type SlackWebClientLike,
} from "../src/index.js";

class FakeSlackSocketClient {
  readonly handlers = new Map<
    SlackSocketModeEventName,
    (payload: unknown) => void | Promise<void>
  >();
  readonly start = vi.fn(async () => {});
  readonly disconnect = vi.fn(async () => {});

  on(event: SlackSocketModeEventName, handler: (payload: unknown) => void | Promise<void>): void {
    this.handlers.set(event, handler);
  }

  async emit(event: SlackSocketModeEventName, payload: unknown): Promise<void> {
    await this.handlers.get(event)?.(payload);
  }
}

describe("SlackChannelAdapter.onMessage (JAC-245)", () => {
  it("normalizes Slack DM text into an inbound Codex message", async () => {
    const socketClient = new FakeSlackSocketClient();
    const adapter = new SlackChannelAdapter({ socketClient });
    const messages: unknown[] = [];
    adapter.onMessage((message) => messages.push(message));

    await adapter.start();
    await socketClient.emit("message", {
      team_id: "T_TEST",
      event: {
        type: "message",
        channel_type: "im",
        channel: "D_TEST",
        user: "U_TEST_USER",
        text: "status",
        ts: "1715000000.000100",
      },
    });

    expect(messages).toEqual([
      {
        target: { platform: "slack", chatId: "T_TEST:D_TEST" },
        sender: { userId: "T_TEST:U_TEST_USER" },
        text: "status",
        receivedAt: new Date("2024-05-06T12:53:20.000Z"),
        messageRef: {
          target: { platform: "slack", chatId: "T_TEST:D_TEST" },
          messageId: "D_TEST:1715000000.000100",
          kind: "inbound",
        },
      },
    ]);
  });

  it("acks Slack Socket Mode message envelopes before emitting inbound messages", async () => {
    const socketClient = new FakeSlackSocketClient();
    const adapter = new SlackChannelAdapter({ socketClient });
    const ack = vi.fn(async () => {});
    const messages: unknown[] = [];
    adapter.onMessage((message) => messages.push(message));

    await adapter.start();
    await socketClient.emit("message", {
      ack,
      team_id: "T_TEST",
      event: {
        type: "message",
        channel_type: "im",
        channel: "D_TEST",
        user: "U_TEST_USER",
        text: "status",
        ts: "1715000000.000100",
      },
    });

    expect(ack).toHaveBeenCalledOnce();
    expect(messages).toHaveLength(1);
  });

  it("normalizes app mentions in Slack channel threads and strips the leading bot mention", async () => {
    const socketClient = new FakeSlackSocketClient();
    const adapter = new SlackChannelAdapter({ socketClient });
    const messages: unknown[] = [];
    adapter.onMessage((message) => messages.push(message));

    await adapter.start();
    await socketClient.emit("app_mention", {
      team_id: "T_TEST",
      event: {
        type: "app_mention",
        channel: "C_TEST",
        user: "U_TEST_USER",
        text: "<@U_TEST_BOT> run tests",
        thread_ts: "1715000000.000000",
        ts: "1715000001.000100",
      },
    });

    expect(messages).toEqual([
      {
        target: {
          platform: "slack",
          chatId: "T_TEST:C_TEST",
          threadKey: "1715000000.000000",
        },
        sender: { userId: "T_TEST:U_TEST_USER" },
        text: "run tests",
        receivedAt: new Date("2024-05-06T12:53:21.000Z"),
        messageRef: {
          target: {
            platform: "slack",
            chatId: "T_TEST:C_TEST",
            threadKey: "1715000000.000000",
          },
          messageId: "C_TEST:1715000001.000100",
          kind: "inbound",
        },
      },
    ]);
  });

  it("drops Slack bot and subtype messages before emitting to daemon", async () => {
    const socketClient = new FakeSlackSocketClient();
    const adapter = new SlackChannelAdapter({ socketClient });
    const messages: unknown[] = [];
    adapter.onMessage((message) => messages.push(message));

    await adapter.start();
    await socketClient.emit("message", {
      team_id: "T_TEST",
      event: {
        type: "message",
        channel: "D_TEST",
        user: "U_TEST_USER",
        bot_id: "B_TEST",
        text: "bot echo",
        ts: "1715000000.000100",
      },
    });
    await socketClient.emit("message", {
      team_id: "T_TEST",
      event: {
        type: "message",
        channel: "D_TEST",
        user: "U_TEST_USER",
        subtype: "message_changed",
        text: "edited",
        ts: "1715000000.000200",
      },
    });

    expect(messages).toEqual([]);
  });

  it("downloads Slack message files before emitting inbound attachments", async () => {
    const socketClient = new FakeSlackSocketClient();
    const webClient: SlackWebClientLike = {
      downloadFile: vi
        .fn()
        .mockResolvedValueOnce({
          localPath: "/tmp/codex-im/slack/F_IMAGE-screenshot.png",
          sizeBytes: 3,
        })
        .mockResolvedValueOnce({
          localPath: "/tmp/codex-im/slack/F_LOG-output.log",
          sizeBytes: 7,
        }),
    };
    const adapter = new SlackChannelAdapter({ socketClient, webClient });
    const messages: unknown[] = [];
    adapter.onMessage((message) => messages.push(message));

    await adapter.start();
    await socketClient.emit("message", {
      team_id: "T_TEST",
      event: {
        type: "message",
        channel_type: "im",
        channel: "D_TEST",
        user: "U_TEST_USER",
        text: "please inspect these",
        ts: "1715000000.000100",
        files: [
          {
            id: "F_IMAGE",
            name: "screenshot.png",
            mimetype: "image/png",
            url_private_download: "https://files.slack.test/screenshot",
            size: 3,
          },
          {
            id: "F_LOG",
            name: "output.log",
            mimetype: "text/plain",
            url_private: "https://files.slack.test/output",
            size: 7,
          },
        ],
      },
    });

    expect(webClient.downloadFile).toHaveBeenCalledTimes(2);
    expect(webClient.downloadFile).toHaveBeenNthCalledWith(1, {
      fileId: "F_IMAGE",
      filename: "screenshot.png",
      contentType: "image/png",
      url: "https://files.slack.test/screenshot",
      sizeBytes: 3,
    });
    expect(webClient.downloadFile).toHaveBeenNthCalledWith(2, {
      fileId: "F_LOG",
      filename: "output.log",
      contentType: "text/plain",
      url: "https://files.slack.test/output",
      sizeBytes: 7,
    });
    expect(messages).toEqual([
      expect.objectContaining({
        attachments: [
          {
            kind: "image",
            filename: "screenshot.png",
            contentType: "image/png",
            localPath: "/tmp/codex-im/slack/F_IMAGE-screenshot.png",
            sizeBytes: 3,
          },
          {
            kind: "file",
            filename: "output.log",
            contentType: "text/plain",
            localPath: "/tmp/codex-im/slack/F_LOG-output.log",
            sizeBytes: 7,
          },
        ],
      }),
    ]);
  });

  it("emits rejected oversized Slack attachments before private file download", async () => {
    const socketClient = new FakeSlackSocketClient();
    const webClient: SlackWebClientLike = {
      downloadFile: vi.fn(async () => ({
        localPath: "/tmp/codex-im/slack/F_SMALL-small.txt",
        sizeBytes: 4,
      })),
    };
    const adapter = new SlackChannelAdapter({
      socketClient,
      webClient,
      maxInboundAttachmentBytes: 4,
    });
    const messages: unknown[] = [];
    adapter.onMessage((message) => messages.push(message));

    await adapter.start();
    await socketClient.emit("message", {
      team_id: "T_TEST",
      event: {
        type: "message",
        channel_type: "im",
        channel: "D_TEST",
        user: "U_TEST_USER",
        text: "please inspect these",
        ts: "1715000000.000100",
        files: [
          {
            id: "F_HUGE",
            name: "huge.log",
            mimetype: "text/plain",
            url_private_download: "https://files.slack.test/huge",
            size: 5,
          },
          {
            id: "F_SMALL",
            name: "small.txt",
            mimetype: "text/plain",
            url_private_download: "https://files.slack.test/small",
            size: 4,
          },
        ],
      },
    });

    expect(webClient.downloadFile).not.toHaveBeenCalled();
    expect(messages).toEqual([
      expect.objectContaining({
        attachments: [
          {
            kind: "file",
            filename: "huge.log",
            contentType: "text/plain",
            sizeBytes: 5,
            rejectionReason: "too_large",
          },
        ],
      }),
    ]);
  });

  it("accepts Slack file_share subtype only when file metadata is present", async () => {
    const socketClient = new FakeSlackSocketClient();
    const webClient: SlackWebClientLike = {
      downloadFile: vi.fn(async () => ({
        localPath: "/tmp/codex-im/slack/F_SHARE-shared.txt",
        sizeBytes: 5,
      })),
    };
    const adapter = new SlackChannelAdapter({ socketClient, webClient });
    const messages: unknown[] = [];
    adapter.onMessage((message) => messages.push(message));

    await adapter.start();
    await socketClient.emit("message", {
      team_id: "T_TEST",
      event: {
        type: "message",
        channel: "D_TEST",
        user: "U_TEST_USER",
        subtype: "file_share",
        text: "shared a file",
        ts: "1715000002.000100",
        files: [
          {
            id: "F_SHARE",
            name: "shared.txt",
            mimetype: "text/plain",
            url_private_download: "https://files.slack.test/shared",
          },
        ],
      },
    });
    await socketClient.emit("message", {
      team_id: "T_TEST",
      event: {
        type: "message",
        channel: "D_TEST",
        user: "U_TEST_USER",
        subtype: "file_share",
        text: "metadata missing",
        ts: "1715000003.000100",
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        text: "shared a file",
        attachments: [
          {
            kind: "file",
            filename: "shared.txt",
            contentType: "text/plain",
            localPath: "/tmp/codex-im/slack/F_SHARE-shared.txt",
            sizeBytes: 5,
          },
        ],
      }),
    );
  });
});
