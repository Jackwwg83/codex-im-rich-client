import { describe, expect, it, vi } from "vitest";
import { SlackChannelAdapter, type SlackSocketModeEventName } from "../src/index.js";

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
});
