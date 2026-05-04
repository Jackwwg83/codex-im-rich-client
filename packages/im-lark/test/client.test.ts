import { describe, expect, it, vi } from "vitest";
import {
  type LarkEventDispatcherLike,
  type LarkEventHandlerMap,
  type LarkSdkDeps,
  type LarkWsClientLike,
  createLarkSdkChannelAdapter,
  encodeLarkCallbackHandle,
  renderLarkApprovalCard,
} from "../src/index.js";

const CONFIG = {
  appId: "cli_test_app",
  appSecret: "test-secret-not-logged",
  domain: "feishu" as const,
};
const TARGET = { platform: "lark", chatId: "oc_sdk_chat" };
const CARD = {
  schemaVersion: "approval-card.v1" as const,
  kind: "command_execution" as const,
  approvalId: "approval-hidden",
  summary: "Run pnpm test",
  target: { riskLevel: "high" as const },
  actions: [{ kind: "decline" as const, wirePayload: "v1:ABCDEFGHIJKLMNOP" }],
  status: "pending" as const,
  createdAt: new Date(0),
};

class FakeSdkEventDispatcher implements LarkEventDispatcherLike {
  readonly handlers: LarkEventHandlerMap[] = [];

  register(handlers: LarkEventHandlerMap) {
    this.handlers.push(handlers);
    return this;
  }
}

describe("Lark SDK client factory (JAC-162 final-review fix)", () => {
  it("creates a production adapter that registers message and card action handlers on WS start", async () => {
    const dispatcher = new FakeSdkEventDispatcher();
    const wsStart = vi.fn<NonNullable<LarkWsClientLike["start"]>>(async () => undefined);
    const deps = fakeSdkDeps({
      dispatcher,
      wsClient: { start: wsStart, close: vi.fn() },
    });
    const adapter = createLarkSdkChannelAdapter(CONFIG, deps);

    adapter.onMessage(() => {});
    adapter.onAction(() => {});
    await adapter.start();

    expect(wsStart).toHaveBeenCalledWith({ eventDispatcher: dispatcher });
    expect(dispatcher.handlers).toHaveLength(1);
    expect(Object.keys(dispatcher.handlers[0] ?? {}).sort()).toEqual([
      "card.action.trigger",
      "im.message.receive_v1",
    ]);
  });

  it("maps text, reply, edit, card send, and card update through SDK/CardKit APIs", async () => {
    const sdkCalls: unknown[] = [];
    const deps = fakeSdkDeps({ sdkCalls });
    const adapter = createLarkSdkChannelAdapter(CONFIG, deps);

    await adapter.start();
    const textRef = await adapter.sendText(TARGET, "hello");
    const replyRef = await adapter.replyText({ target: TARGET, messageId: "om_parent" }, "reply");
    await adapter.editText({ target: TARGET, messageId: "om_text" }, "edited");
    const cardResult = await adapter.sendCard(TARGET, CARD);
    await adapter.updateCard(cardResult.messageRef, { ...CARD, status: "resolved" });

    expect(textRef.messageId).toBe("om_create");
    expect(replyRef.messageId).toBe("om_reply");
    expect(cardResult.messageRef.messageId).toBe("om_create");
    expect(sdkCalls).toEqual([
      {
        method: "create",
        payload: {
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: TARGET.chatId,
            msg_type: "text",
            content: JSON.stringify({ text: "hello" }),
          },
        },
      },
      {
        method: "reply",
        payload: {
          path: { message_id: "om_parent" },
          data: { msg_type: "text", content: JSON.stringify({ text: "reply" }) },
        },
      },
      {
        method: "update",
        payload: {
          path: { message_id: "om_text" },
          data: { msg_type: "text", content: JSON.stringify({ text: "edited" }) },
        },
      },
      {
        method: "create",
        payload: {
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: TARGET.chatId,
            msg_type: "interactive",
            content: JSON.stringify(renderLarkApprovalCard(CARD)),
          },
        },
      },
      { method: "cardIdConvert", payload: { data: { message_id: "om_create" } } },
      {
        method: "cardKitUpdate",
        payload: {
          path: { card_id: "card_from_om_create" },
          data: {
            card: {
              type: "card_json",
              data: JSON.stringify(renderLarkApprovalCard({ ...CARD, status: "resolved" })),
            },
            sequence: expect.any(Number),
          },
        },
      },
    ]);
  });

  it("converts each message id to card id once before CardKit updates", async () => {
    const sdkCalls: unknown[] = [];
    const deps = fakeSdkDeps({ sdkCalls });
    const adapter = createLarkSdkChannelAdapter(CONFIG, deps);

    await adapter.start();
    const cardResult = await adapter.sendCard(TARGET, CARD);
    await adapter.updateCard(cardResult.messageRef, { ...CARD, status: "resolved" });
    await adapter.updateCard(cardResult.messageRef, { ...CARD, status: "expired" });

    expect(sdkCalls.filter((call) => isMethodCall(call, "cardIdConvert"))).toHaveLength(1);
    expect(sdkCalls.filter((call) => isMethodCall(call, "cardKitUpdate"))).toHaveLength(2);
  });

  it("surfaces sanitized SDK CardKit failures without token-shaped error details", async () => {
    const adapter = createLarkSdkChannelAdapter(
      CONFIG,
      fakeSdkDeps({
        cardKitUpdateError: {
          message: "Request failed with status code 400",
          config: { headers: { Authorization: "Bearer token-must-not-leak" } },
          response: { data: { code: 99991672, msg: "Access denied" } },
        },
      }),
    );

    await adapter.start();
    const cardResult = await adapter.sendCard(TARGET, CARD);

    let error: unknown;
    try {
      await adapter.updateCard(cardResult.messageRef, { ...CARD, status: "resolved" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "LarkChannelAdapter.updateCard failed: Lark SDK updateCard failed: code 99991672: Access denied",
    );
    expect((error as Error).message).not.toContain("token-must-not-leak");
    expect((error as Error).message).not.toContain("Authorization");
  });

  it("installs an explicit production no-op action ack strategy", async () => {
    const adapter = createLarkSdkChannelAdapter(CONFIG, fakeSdkDeps({}));

    await adapter.start();

    await expect(
      adapter.answerAction(encodeLarkCallbackHandle("ev_sdk_action", new Date(1710000600000)), {
        ok: true,
        userMessage: "acknowledged",
      }),
    ).resolves.toBeUndefined();
  });
});

function fakeSdkDeps(options: {
  readonly dispatcher?: FakeSdkEventDispatcher;
  readonly cardKitUpdateError?: unknown;
  readonly sdkCalls?: unknown[];
  readonly wsClient?: LarkWsClientLike;
}): LarkSdkDeps {
  const sdkCalls = options.sdkCalls ?? [];
  return {
    createClient: () => ({
      im: {
        message: {
          async create(payload: unknown) {
            sdkCalls.push({ method: "create", payload });
            return { code: 0, data: { message_id: "om_create" } };
          },
          async reply(payload: unknown) {
            sdkCalls.push({ method: "reply", payload });
            return { code: 0, data: { message_id: "om_reply" } };
          },
          async update(payload: unknown) {
            sdkCalls.push({ method: "update", payload });
            return { code: 0, data: { message_id: "om_update" } };
          },
        },
      },
      cardkit: {
        v1: {
          card: {
            async idConvert(payload: { readonly data?: { readonly message_id?: string } }) {
              sdkCalls.push({ method: "cardIdConvert", payload });
              return {
                code: 0,
                data: { card_id: `card_from_${payload.data?.message_id ?? "missing"}` },
              };
            },
            async update(payload: unknown) {
              sdkCalls.push({ method: "cardKitUpdate", payload });
              if (options.cardKitUpdateError !== undefined) {
                throw options.cardKitUpdateError;
              }
              return { code: 0 };
            },
          },
        },
      },
    }),
    createWsClient: () =>
      options.wsClient ?? {
        async start() {},
        close() {},
      },
    createEventDispatcher: () => options.dispatcher ?? new FakeSdkEventDispatcher(),
  };
}

function isMethodCall(call: unknown, method: string): boolean {
  return (
    typeof call === "object" &&
    call !== null &&
    "method" in call &&
    (call as { readonly method?: unknown }).method === method
  );
}
