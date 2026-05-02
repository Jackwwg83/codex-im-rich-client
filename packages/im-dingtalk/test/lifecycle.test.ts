import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DINGTALK_TOPIC_CARD,
  DINGTALK_TOPIC_ROBOT,
  DingTalkChannelAdapter,
  type DingTalkStreamClientLike,
} from "../src/index.js";

const SRC_DIR = "packages/im-dingtalk/src";

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("DingTalkChannelAdapter Stream lifecycle (JAC-80)", () => {
  it("registers robot/card callbacks before accepting inbound events", async () => {
    const events: string[] = [];
    const topics: string[] = [];
    const state: { adapter?: DingTalkChannelAdapter } = {};

    const streamClient: DingTalkStreamClientLike = {
      registerCallbackListener(topic, _handler) {
        events.push(`register:${topic}`);
        topics.push(topic);
        return undefined;
      },
      async connect() {
        events.push("stream.connect");
        expect(state.adapter?._inboundPausedForTest()).toBe(true);
      },
      disconnect() {
        events.push("stream.disconnect");
      },
    };

    const adapter = new DingTalkChannelAdapter({ streamClient });
    state.adapter = adapter;

    expect(adapter._inboundPausedForTest()).toBe(true);
    await adapter.start();

    expect(topics).toEqual([DINGTALK_TOPIC_ROBOT, DINGTALK_TOPIC_CARD]);
    expect(events).toEqual([
      `register:${DINGTALK_TOPIC_ROBOT}`,
      `register:${DINGTALK_TOPIC_CARD}`,
      "stream.connect",
    ]);
    expect(adapter._startedForTest()).toBe(true);
    expect(adapter._inboundPausedForTest()).toBe(false);

    await adapter.start();
    expect(events).toEqual([
      `register:${DINGTALK_TOPIC_ROBOT}`,
      `register:${DINGTALK_TOPIC_CARD}`,
      "stream.connect",
    ]);
  });

  it("stops idempotently and pauses inbound before disconnecting", async () => {
    const events: string[] = [];
    const state: { adapter?: DingTalkChannelAdapter } = {};

    const streamClient: DingTalkStreamClientLike = {
      registerCallbackListener(topic) {
        events.push(`register:${topic}`);
        return undefined;
      },
      async connect() {
        events.push("stream.connect");
      },
      disconnect() {
        events.push("stream.disconnect");
        expect(state.adapter?._inboundPausedForTest()).toBe(true);
      },
    };

    const adapter = new DingTalkChannelAdapter({ streamClient });
    state.adapter = adapter;

    await adapter.start();
    await adapter.stop();
    await adapter.stop();

    expect(events).toEqual([
      `register:${DINGTALK_TOPIC_ROBOT}`,
      `register:${DINGTALK_TOPIC_CARD}`,
      "stream.connect",
      "stream.disconnect",
    ]);
    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);
  });

  it("fails closed when injected Stream connect fails", async () => {
    const adapter = new DingTalkChannelAdapter({
      streamClient: {
        registerCallbackListener() {
          return undefined;
        },
        async connect() {
          throw new Error("connect failed");
        },
        disconnect() {
          throw new Error("must not disconnect a failed start");
        },
      },
    });

    await expect(adapter.start()).rejects.toThrow("connect failed");
    expect(adapter._startedForTest()).toBe(false);
    expect(adapter._inboundPausedForTest()).toBe(true);
  });

  it("does not introduce webhook or public listener code", () => {
    const source = listTsFiles(SRC_DIR)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(source).not.toMatch(/\bcreateServer\s*\(/);
    expect(source).not.toMatch(/\bnew\s+Server\s*\(/);
    expect(source).not.toMatch(/\.listen\s*\(/);
    expect(source).not.toMatch(/\bwebhookCallback\b/);
    expect(source).not.toMatch(/\bstartWebhook\b/);
  });
});
