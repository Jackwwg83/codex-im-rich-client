import { describe, expect, it } from "vitest";
import {
  DINGTALK_TOPIC_CARD,
  DINGTALK_TOPIC_ROBOT,
  type DingTalkDwClientLike,
  type DingTalkStreamEventHandler,
  createDingTalkStreamClient,
} from "../src/index.js";

describe("DingTalk Stream client wrapper (JAC-90 P1 fix)", () => {
  it("adapts DWClient registration, lifecycle, and callback ack into the adapter surface", async () => {
    const calls: unknown[] = [];
    let robotHandler: DingTalkStreamEventHandler | undefined;
    const dwClient: DingTalkDwClientLike = {
      registerCallbackListener(topic, handler) {
        calls.push({ method: "register", topic });
        if (topic === DINGTALK_TOPIC_ROBOT) {
          robotHandler = handler;
        }
        return this;
      },
      async connect() {
        calls.push({ method: "connect" });
      },
      disconnect() {
        calls.push({ method: "disconnect" });
      },
      socketCallBackResponse(messageId, result) {
        calls.push({ method: "ack", messageId, result });
      },
    };

    const client = createDingTalkStreamClient(
      {
        clientId: "ding_test_client_id",
        clientSecret: "present_value",
        ua: "codex-im-test",
      },
      { createClient: () => dwClient },
    );

    client.registerCallbackListener(DINGTALK_TOPIC_ROBOT, () => {});
    client.registerCallbackListener(DINGTALK_TOPIC_CARD, () => {});
    await client.connect();
    await client.ackCallback?.("stream_msg_ack_001");
    await client.disconnect();

    expect(robotHandler).toBeDefined();
    expect(calls).toEqual([
      { method: "register", topic: DINGTALK_TOPIC_ROBOT },
      { method: "register", topic: DINGTALK_TOPIC_CARD },
      { method: "connect" },
      { method: "ack", messageId: "stream_msg_ack_001", result: { status: "SUCCESS" } },
      { method: "disconnect" },
    ]);
  });
});
