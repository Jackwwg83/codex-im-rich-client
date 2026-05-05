import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DINGTALK_TOPIC_CARD,
  DingTalkChannelAdapter,
  type DingTalkInboundAction,
  type DingTalkStreamClientLike,
  type DingTalkStreamEventHandler,
  type DingTalkStreamEventLike,
  encodeDingTalkCallbackHandle,
  normalizeDingTalkRawCardAction,
} from "../src/index.js";

const FIXTURE_DIR = "packages/im-dingtalk/test/fixtures";
const NOW = new Date("2026-05-02T20:00:00.000Z");

function fixture(name: string): DingTalkStreamEventLike {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as DingTalkStreamEventLike;
}

function cardCallbackWithParams(params: Record<string, unknown>): DingTalkStreamEventLike {
  return {
    headers: {
      messageId: "stream_card_token_001",
      topic: DINGTALK_TOPIC_CARD,
    },
    data: JSON.stringify({
      content: JSON.stringify({
        cardPrivateData: {
          actionIds: ["btn_allow"],
          params,
        },
      }),
      corpId: "corp_test",
      outTrackId: "ding_card_token_001",
      spaceId: "dtv1.card//IM_ROBOT.staff_private_target",
      spaceType: "IM_ROBOT",
      type: "cardCallback",
      userId: "staff_action_user",
      userIdType: 1,
    }),
  };
}

class FakeDingTalkStreamClient implements DingTalkStreamClientLike {
  readonly handlers = new Map<string, DingTalkStreamEventHandler>();

  registerCallbackListener(topic: string, handler: DingTalkStreamEventHandler) {
    this.handlers.set(topic, handler);
    return this;
  }

  async connect() {}

  disconnect() {}

  async inject(topic: string, event: DingTalkStreamEventLike): Promise<void> {
    await this.handlers.get(topic)?.(event);
  }
}

describe("DingTalk card action messageRef validation (JAC-84)", () => {
  it("maps a group card callback only when original messageRef fields are proven", () => {
    const action = normalizeDingTalkRawCardAction(fixture("card-action-group.json"), NOW.getTime());

    expect(action).toEqual({
      approvalId: "<opaque>",
      uiAction: { kind: "decline" },
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      callbackNonce: "ABCDEFGHIJKLMNOP",
      callbackHandle: encodeDingTalkCallbackHandle(
        "stream_card_group_001",
        "ding_card_group_001",
        NOW,
      ),
      target: { platform: "dingtalk", chatId: "cid_card_group" },
      sender: { userId: "staff_action_user" },
      messageRef: {
        target: { platform: "dingtalk", chatId: "cid_card_group" },
        messageId: "ding_card_group_001",
      },
      receivedAt: NOW,
      idempotencyKey: "card:stream_card_group_001:ding_card_group_001:btn_allow",
      raw: {
        topic: DINGTALK_TOPIC_CARD,
        streamMessageId: "[redacted]",
        outTrackId: "[redacted]",
        spaceId: "[redacted]",
        spaceType: "IM_GROUP",
        actionId: "btn_allow",
      },
    });
  });

  it("maps private card callbacks through IM_ROBOT space identity", () => {
    const action = normalizeDingTalkRawCardAction(
      fixture("card-action-private.json"),
      NOW.getTime(),
    );

    expect(action).toMatchObject({
      rawCallbackData: "v1:QRSTUVWXYZ234567",
      callbackNonce: "QRSTUVWXYZ234567",
      target: { platform: "dingtalk", chatId: "staff_private_target" },
      sender: { userId: "staff_action_user" },
      messageRef: {
        target: { platform: "dingtalk", chatId: "staff_private_target" },
        messageId: "ding_card_private_001",
      },
      idempotencyKey: "card:stream_card_private_001:ding_card_private_001:btn_decline",
    });
  });

  it("maps CardKit token params without approval metadata companions", () => {
    const action = normalizeDingTalkRawCardAction(
      cardCallbackWithParams({ token: "v1:ABCDEFGHIJKLMNOP" }),
      NOW.getTime(),
    );

    expect(action).toMatchObject({
      rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
      callbackNonce: "ABCDEFGHIJKLMNOP",
      target: { platform: "dingtalk", chatId: "staff_private_target" },
      messageRef: {
        target: { platform: "dingtalk", chatId: "staff_private_target" },
        messageId: "ding_card_token_001",
      },
    });
  });

  it("maps DingTalk public-template agree callbacks through messageRef-scoped actions", () => {
    const action = normalizeDingTalkRawCardAction(
      fixture("card-action-public-template-agree.json"),
      NOW.getTime(),
    );

    expect(action).toMatchObject({
      uiAction: { kind: "allow_once" },
      rawCallbackData: "dingtalk-template-action:allow_once",
      callbackNonce: "dingtalk-template-action:allow_once",
      target: { platform: "dingtalk", chatId: "staff_public_target" },
      messageRef: {
        target: { platform: "dingtalk", chatId: "staff_public_target" },
        messageId: "ding_card_public_001",
      },
    });
  });

  it("maps DingTalk public-template reject callbacks through messageRef-scoped actions", () => {
    const action = normalizeDingTalkRawCardAction(
      fixture("card-action-public-template-reject.json"),
      NOW.getTime(),
    );

    expect(action).toMatchObject({
      uiAction: { kind: "decline" },
      rawCallbackData: "dingtalk-template-action:decline",
      callbackNonce: "dingtalk-template-action:decline",
    });
  });

  it("rejects token callbacks mixed with action metadata instead of falling back", () => {
    expect(
      normalizeDingTalkRawCardAction(
        cardCallbackWithParams({ token: "v1:ABCDEFGHIJKLMNOP", action: "accept" }),
        NOW.getTime(),
      ),
    ).toBeUndefined();
  });

  it.each([
    "card-action-missing-message-ref.json",
    "card-action-ambiguous-action-id.json",
    "card-action-unsafe-payload.json",
  ])("fails closed for unsafe fixture %s", (name) => {
    expect(normalizeDingTalkRawCardAction(fixture(name), NOW.getTime())).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    true,
    42,
    "raw",
    [],
    {},
    { event: null },
    { headers: { topic: DINGTALK_TOPIC_CARD }, data: "{}" },
  ])("fails closed without throwing for malformed primitive %#", (event) => {
    expect(
      normalizeDingTalkRawCardAction(event as DingTalkStreamEventLike, NOW.getTime()),
    ).toBeUndefined();
  });

  it("emits card actions only after lifecycle start and validated messageRef", async () => {
    const streamClient = new FakeDingTalkStreamClient();
    const adapter = new DingTalkChannelAdapter({
      streamClient,
      now: () => NOW,
    });
    const seen: DingTalkInboundAction[] = [];

    adapter.onAction((action) => {
      seen.push(action as DingTalkInboundAction);
    });

    await streamClient.inject(DINGTALK_TOPIC_CARD, fixture("card-action-group.json"));
    expect(seen).toEqual([]);

    await adapter.start();
    await streamClient.inject(DINGTALK_TOPIC_CARD, fixture("card-action-group.json"));
    await streamClient.inject(DINGTALK_TOPIC_CARD, fixture("card-action-missing-message-ref.json"));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.messageRef?.messageId).toBe("ding_card_group_001");
    expect(seen[0]?.idempotencyKey).toBe(
      "card:stream_card_group_001:ding_card_group_001:btn_allow",
    );
  });

  it("does not log unsafe card callback payload contents", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(
        normalizeDingTalkRawCardAction(fixture("card-action-unsafe-payload.json"), NOW.getTime()),
      ).toBeUndefined();
    } finally {
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
