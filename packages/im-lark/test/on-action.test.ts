import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LarkChannelAdapter,
  type LarkEventDispatcherLike,
  type LarkRawCardActionInput,
  type LarkWsClientLike,
  encodeLarkCallbackHandle,
} from "../src/index.js";

const FIXTURE_DIR = "packages/im-lark/test/fixtures";
const NOW = new Date(1710000600 * 1000);

function loadFixture(name: string): LarkRawCardActionInput {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as LarkRawCardActionInput;
}

class FakeLarkEventDispatcher implements LarkEventDispatcherLike {
  readonly handlers: Array<(event: LarkRawCardActionInput) => void | Promise<void>> = [];

  register(handlers: Parameters<NonNullable<LarkEventDispatcherLike["register"]>>[0]) {
    const handler = handlers["card.action.trigger"];
    if (handler !== undefined) {
      this.handlers.push(handler);
    }
    return this;
  }

  async inject(event: LarkRawCardActionInput): Promise<void> {
    await Promise.all(this.handlers.map((handler) => handler(event)));
  }
}

function fakeWsClient(): LarkWsClientLike {
  return {
    async start() {},
    close() {},
  };
}

describe("LarkChannelAdapter.onAction card.action.trigger mapping (JAC-157)", () => {
  it("maps private card action context into InboundAction with original messageRef", async () => {
    const dispatcher = new FakeLarkEventDispatcher();
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      createEventDispatcher: () => dispatcher,
      now: () => NOW,
    });
    const seen = vi.fn();

    adapter.onAction(seen);
    await adapter.start();
    await dispatcher.inject(loadFixture("card-action-private.json"));

    expect(seen).toHaveBeenCalledWith({
      approvalId: "<opaque>",
      uiAction: { kind: "decline" },
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      callbackNonce: "ABCDEFGHIJKLMNOP",
      callbackHandle: encodeLarkCallbackHandle("ev_private_card_action", NOW),
      target: { platform: "lark", chatId: "oc_card_private" },
      sender: { userId: "ou_action_user", displayName: "Ada" },
      messageRef: {
        target: { platform: "lark", chatId: "oc_card_private" },
        messageId: "om_card_private",
      },
      receivedAt: NOW,
    });
  });

  it("maps group card action top-level references into InboundAction", async () => {
    const dispatcher = new FakeLarkEventDispatcher();
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      createEventDispatcher: () => dispatcher,
      now: () => NOW,
    });
    const seen = vi.fn();

    adapter.onAction(seen);
    await adapter.start();
    await dispatcher.inject(loadFixture("card-action-group.json"));

    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        rawCallbackData: "v1:QRSTUVWXYZ234567",
        callbackNonce: "QRSTUVWXYZ234567",
        callbackHandle: encodeLarkCallbackHandle("ev_group_card_action", NOW),
        target: { platform: "lark", chatId: "oc_card_group" },
        sender: { userId: "ou_group_user" },
        messageRef: {
          target: { platform: "lark", chatId: "oc_card_group" },
          messageId: "om_card_group",
        },
      }),
    );
  });

  it.each([
    "card-action-missing-message-ref.json",
    "card-action-ambiguous-message-ref.json",
    "card-action-malformed-payload.json",
  ])("fails closed without emitting %s", async (fixture) => {
    const dispatcher = new FakeLarkEventDispatcher();
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      createEventDispatcher: () => dispatcher,
      now: () => NOW,
    });
    const seen = vi.fn();

    adapter.onAction(seen);
    await adapter.start();
    await dispatcher.inject(loadFixture(fixture));

    expect(seen).not.toHaveBeenCalled();
  });

  it("drops card actions before start and after stop", async () => {
    const dispatcher = new FakeLarkEventDispatcher();
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      createEventDispatcher: () => dispatcher,
      now: () => NOW,
    });
    const seen = vi.fn();
    adapter.onAction(seen);

    adapter._emitRawActionForTest(loadFixture("card-action-private.json"));
    expect(seen).not.toHaveBeenCalled();

    await adapter.start();
    await adapter.stop();
    await dispatcher.inject(loadFixture("card-action-private.json"));

    expect(seen).not.toHaveBeenCalled();
  });

  it("fails fast when onAction is registered but dispatcher cannot register card actions", async () => {
    const adapter = new LarkChannelAdapter({ wsClient: fakeWsClient() });
    adapter.onAction(() => {});

    await expect(adapter.start()).rejects.toThrow(
      "LarkChannelAdapter.start requires EventDispatcher.register",
    );
  });
});
