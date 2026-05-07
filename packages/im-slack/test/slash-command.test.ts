import { describe, expect, it, vi } from "vitest";
import {
  SlackChannelAdapter,
  type SlackRawSlashCommandPayload,
  type SlackSocketModeEventName,
} from "../src/index.js";

const NOW = new Date("2024-05-06T13:20:00.000Z");

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

describe("SlackChannelAdapter slash command ingress (JAC-247)", () => {
  it.each([
    ["status", "/status"],
    ["projects", "/projects"],
    ["threads codex-im", "/threads codex-im"],
    ["use codex-im", "/use codex-im"],
    ["diagnostics", "/diagnostics"],
    ["cu status", "/cu status"],
    ["Run tests and summarize failures", "Run tests and summarize failures"],
    ["", "/help"],
  ])("normalizes /codex %j into existing daemon text %j", async (text, expectedText) => {
    const socketClient = new FakeSlackSocketClient();
    const adapter = new SlackChannelAdapter({ socketClient, now: () => NOW });
    const ack = vi.fn(async () => {});
    const messages: unknown[] = [];

    adapter.onMessage((message) => messages.push(message));
    await adapter.start();
    await socketClient.emit("slash_commands", {
      command: "/codex",
      text,
      team_id: "T_TEST",
      channel_id: "C_TEST",
      user_id: "U_TEST_USER",
      user_name: "Ada",
      trigger_id: "trigger-1",
      ack,
    } satisfies SlackRawSlashCommandPayload);

    expect(ack).toHaveBeenCalledOnce();
    expect(messages).toEqual([
      {
        target: { platform: "slack", chatId: "T_TEST:C_TEST" },
        sender: { userId: "T_TEST:U_TEST_USER", displayName: "Ada" },
        text: expectedText,
        receivedAt: NOW,
        messageRef: {
          target: { platform: "slack", chatId: "T_TEST:C_TEST" },
          messageId: "slash:trigger-1",
          kind: "inbound",
          textUpdateMode: "append",
        },
      },
    ]);
  });

  it("fails closed for non-codex or incomplete slash commands", async () => {
    const socketClient = new FakeSlackSocketClient();
    const adapter = new SlackChannelAdapter({ socketClient, now: () => NOW });
    const messages: unknown[] = [];

    adapter.onMessage((message) => messages.push(message));
    await adapter.start();
    await socketClient.emit("slash_commands", {
      command: "/other",
      text: "status",
      team_id: "T_TEST",
      channel_id: "C_TEST",
      user_id: "U_TEST_USER",
      trigger_id: "trigger-1",
    } satisfies SlackRawSlashCommandPayload);
    await socketClient.emit("slash_commands", {
      command: "/codex",
      text: "status",
      team_id: "T_TEST",
      user_id: "U_TEST_USER",
      trigger_id: "trigger-1",
    } satisfies SlackRawSlashCommandPayload);

    expect(messages).toEqual([]);
  });
});
