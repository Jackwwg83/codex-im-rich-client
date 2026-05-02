import { describe, expect, it } from "vitest";
import {
  LarkChannelAdapter,
  type LarkEventDispatcherLike,
  type LarkWsClientLike,
} from "../src/index.js";

describe("LarkChannelAdapter lifecycle (JAC-151)", () => {
  it("starts the injected WS client before accepting inbound events", async () => {
    const events: string[] = [];
    const dispatcher: LarkEventDispatcherLike = { kind: "fake-dispatcher" };
    const state: { adapter?: LarkChannelAdapter } = {};

    const wsClient: LarkWsClientLike = {
      async start(input) {
        events.push("ws.start");
        expect(input.eventDispatcher).toBe(dispatcher);
        expect(state.adapter?._inboundPausedForTest()).toBe(true);
      },
      close() {
        events.push("ws.close");
      },
    };

    const adapter = new LarkChannelAdapter({
      wsClient,
      createEventDispatcher: () => {
        events.push("dispatcher.create");
        return dispatcher;
      },
    });
    state.adapter = adapter;

    expect(adapter._inboundPausedForTest()).toBe(true);
    await adapter.start();

    expect(events).toEqual(["dispatcher.create", "ws.start"]);
    expect(adapter._startedForTest()).toBe(true);
    expect(adapter._inboundPausedForTest()).toBe(false);

    await adapter.start();
    expect(events).toEqual(["dispatcher.create", "ws.start"]);
  });

  it("stops idempotently and pauses inbound before closing the WS client", async () => {
    const events: string[] = [];
    const state: { adapter?: LarkChannelAdapter } = {};

    const wsClient: LarkWsClientLike = {
      async start() {
        events.push("ws.start");
      },
      close() {
        events.push("ws.close");
        expect(state.adapter?._inboundPausedForTest()).toBe(true);
      },
    };

    const adapter = new LarkChannelAdapter({ wsClient });
    state.adapter = adapter;

    await adapter.start();
    await adapter.stop();
    await adapter.stop();

    expect(events).toEqual(["ws.start", "ws.close"]);
    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);
  });

  it("fails closed when injected WS start fails", async () => {
    const adapter = new LarkChannelAdapter({
      wsClient: {
        async start() {
          throw new Error("connect failed");
        },
        close() {
          throw new Error("must not close a failed start");
        },
      },
    });

    await expect(adapter.start()).rejects.toThrow("connect failed");
    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);
  });
});
