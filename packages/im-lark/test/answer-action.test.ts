import { describe, expect, it, vi } from "vitest";
import {
  type LarkActionClientLike,
  LarkChannelAdapter,
  type LarkWsClientLike,
  decodeLarkCallbackHandle,
  encodeLarkCallbackHandle,
} from "../src/index.js";

const NOW = new Date(1710000600 * 1000);

function fakeWsClient(): LarkWsClientLike {
  return {
    async start() {},
    close() {},
  };
}

function fakeActionClient(
  answerAction: LarkActionClientLike["answerAction"],
): LarkActionClientLike {
  return { answerAction };
}

describe("LarkChannelAdapter.answerAction ack behavior (JAC-158)", () => {
  it("forwards platform ack by callback handle without treating it as approval success", async () => {
    const calls: unknown[] = [];
    const callbackHandle = encodeLarkCallbackHandle("ev_private_card_action", NOW);
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      actionClient: fakeActionClient(async (input) => {
        calls.push(input);
      }),
      now: () => NOW,
    });

    await adapter.start();
    await adapter.answerAction(callbackHandle, { ok: true, userMessage: "decision recorded" });

    expect(calls).toEqual([
      {
        callbackHandle,
        eventId: "ev_private_card_action",
        receivedAt: NOW,
        ack: { ok: true, userMessage: "decision recorded" },
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain("approvalId");
    expect(JSON.stringify(calls)).not.toContain("rawCallbackData");
    expect(JSON.stringify(calls)).not.toContain("used");
  });

  it.each([
    "stale or unknown",
    "wrong target",
    "expired",
    "unauthorized",
    "cannot validate messageRef",
    "broker failed",
  ])("forwards fail-closed daemon result as platform receipt only: %s", async (userMessage) => {
    const answerAction = vi.fn<LarkActionClientLike["answerAction"]>(async () => undefined);
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      actionClient: fakeActionClient(answerAction),
      now: () => NOW,
    });
    const callbackHandle = encodeLarkCallbackHandle("ev_fail_closed", NOW);

    await adapter.start();
    await adapter.answerAction(callbackHandle, { ok: false, userMessage });

    expect(answerAction).toHaveBeenCalledWith({
      callbackHandle,
      eventId: "ev_fail_closed",
      receivedAt: NOW,
      ack: { ok: false, userMessage },
    });
  });

  it("rejects invalid callback handles before calling the action client", async () => {
    const answerAction = vi.fn<LarkActionClientLike["answerAction"]>(async () => undefined);
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      actionClient: fakeActionClient(answerAction),
    });

    await adapter.start();

    await expect(
      adapter.answerAction("v1:ABCDEFGHIJKLMNOP", { ok: false, userMessage: "bad handle" }),
    ).rejects.toThrow("LarkChannelAdapter.answerAction invalid callback handle");
    expect(answerAction).not.toHaveBeenCalled();
  });

  it("requires an injected action client", async () => {
    const adapter = new LarkChannelAdapter({ wsClient: fakeWsClient() });

    await adapter.start();

    await expect(
      adapter.answerAction(encodeLarkCallbackHandle("ev_no_client", NOW), {
        ok: false,
        userMessage: "ack unavailable",
      }),
    ).rejects.toThrow("LarkChannelAdapter.answerAction requires an injected actionClient");
  });

  it("surfaces platform ack failures without leaking callback payloads", async () => {
    const adapter = new LarkChannelAdapter({
      wsClient: fakeWsClient(),
      actionClient: fakeActionClient(async () => {
        throw new Error("ack rejected");
      }),
    });

    await adapter.start();

    await expect(
      adapter.answerAction(encodeLarkCallbackHandle("ev_ack_rejected", NOW), {
        ok: false,
        userMessage: "stale or unknown",
      }),
    ).rejects.toThrow("LarkChannelAdapter.answerAction failed: ack rejected");
  });

  it("decodes only Lark callback handles", () => {
    expect(decodeLarkCallbackHandle(encodeLarkCallbackHandle("ev:colon", NOW))).toEqual({
      eventId: "ev:colon",
      receivedAtMs: NOW.getTime(),
    });
    expect(decodeLarkCallbackHandle("telegram-callback:1:abc")).toBeUndefined();
    expect(decodeLarkCallbackHandle("lark-card-action:not-ms:abc")).toBeUndefined();
    expect(decodeLarkCallbackHandle("lark-card-action:1710000600000:")).toBeUndefined();
  });
});
