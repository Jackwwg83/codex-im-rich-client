import { describe, expect, it, vi } from "vitest";
import {
  SlackChannelAdapter,
  type SlackRawBlockActionPayload,
  type SlackSocketModeEventName,
  encodeSlackCallbackHandle,
} from "../src/index.js";

const NOW = new Date("2024-05-06T12:54:00.000Z");

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

describe("SlackChannelAdapter.onAction block_actions mapping (JAC-246)", () => {
  it("acks Slack immediately and emits an opaque-token InboundAction", async () => {
    const socketClient = new FakeSlackSocketClient();
    const adapter = new SlackChannelAdapter({
      socketClient,
      now: () => NOW,
    });
    const ack = vi.fn(async () => {});
    const seen = vi.fn();

    adapter.onAction(seen);
    await adapter.start();
    await socketClient.emit("interactive", {
      team: { id: "T_TEST" },
      user: { id: "U_TEST_USER", username: "Ada" },
      channel: { id: "C_TEST" },
      message: { ts: "1715000002.000100", thread_ts: "1715000000.000000" },
      actions: [{ action_id: "codex_im_approval", value: "v1:ABCDEFGHIJKLMNOP" }],
      trigger_id: "trigger-1",
      ack,
    } satisfies SlackRawBlockActionPayload);

    expect(ack).toHaveBeenCalledOnce();
    expect(seen).toHaveBeenCalledWith({
      approvalId: "<opaque>",
      uiAction: { kind: "decline" },
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      callbackNonce: "ABCDEFGHIJKLMNOP",
      callbackHandle: encodeSlackCallbackHandle("trigger-1", NOW),
      target: {
        platform: "slack",
        chatId: "T_TEST:C_TEST",
        threadKey: "1715000000.000000",
      },
      sender: { userId: "T_TEST:U_TEST_USER", displayName: "Ada" },
      messageRef: {
        target: {
          platform: "slack",
          chatId: "T_TEST:C_TEST",
          threadKey: "1715000000.000000",
        },
        messageId: "C_TEST:1715000002.000100",
        kind: "approval_card",
        textUpdateMode: "edit",
      },
      receivedAt: NOW,
    });
  });

  it.each([
    undefined,
    null,
    true,
    42,
    "raw",
    [],
    { actions: [] },
    {
      team: { id: "T_TEST" },
      user: { id: "U_TEST_USER" },
      channel: { id: "C_TEST" },
      message: { ts: "1715000002.000100" },
      actions: [{ action_id: "codex_im_approval", value: "approval-1|decline|nonce" }],
      trigger_id: "trigger-1",
    },
  ])("fails closed without emitting malformed callback %#", async (payload) => {
    const socketClient = new FakeSlackSocketClient();
    const adapter = new SlackChannelAdapter({ socketClient, now: () => NOW });
    const seen = vi.fn();

    adapter.onAction(seen);
    await adapter.start();
    await socketClient.emit("interactive", payload);

    expect(seen).not.toHaveBeenCalled();
  });
});
