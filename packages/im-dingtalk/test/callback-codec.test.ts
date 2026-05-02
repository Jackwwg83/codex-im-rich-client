import { describe, expect, it, vi } from "vitest";
import {
  DINGTALK_TOPIC_CARD,
  DingTalkChannelAdapter,
  type DingTalkStreamClientLike,
  type DingTalkStreamEventHandler,
  type DingTalkStreamEventLike,
  extractDingTalkActionWirePayload,
  extractDingTalkCardCallbackWirePayload,
  redactDingTalkActionPayloadForLog,
  renderDingTalkApprovalCard,
} from "../src/index.js";

const VALID_WIRE_PAYLOAD = "v1:ABCDEFGHIJKLMNOP";

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

describe("DingTalk callback payload codec (JAC-83)", () => {
  it("extracts exact v1 opaque payload from rendered DingTalk card actions", () => {
    const card = renderDingTalkApprovalCard({
      schemaVersion: "approval-card.v1",
      kind: "command_execution",
      approvalId: "approval-must-not-be-decoded",
      summary: "Run pnpm test",
      target: { riskLevel: "high" },
      actions: [{ kind: "decline", wirePayload: VALID_WIRE_PAYLOAD }],
      status: "pending",
      createdAt: new Date(0),
    });

    expect(extractDingTalkActionWirePayload(card.actions[0]?.value)).toBe(VALID_WIRE_PAYLOAD);
  });

  it.each([
    "approval-1",
    "allow_once",
    "decline",
    "actor-user-id",
    "dingtalk:chat:message",
    "approval-1|decline|nonce",
    JSON.stringify({ wirePayload: VALID_WIRE_PAYLOAD }),
    "v2:ABCDEFGHIJKLMNOP",
    "v1:abcdefghijklmnop",
    "v1:ABCDEFGHIJKLMNO",
    "v1:ABCDEFGHIJKLMNOPQ",
    "v1:ABCDEFGHIJKLMN01",
  ])("rejects unsafe string payload %s", (value) => {
    expect(extractDingTalkActionWirePayload(value)).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    123,
    true,
    [],
    {},
    { value: VALID_WIRE_PAYLOAD },
    { wirePayload: VALID_WIRE_PAYLOAD },
    { wirePayload: undefined },
    { wirePayload: "approval-1|decline|nonce" },
    { wirePayload: VALID_WIRE_PAYLOAD, action: "decline" },
    { wirePayload: VALID_WIRE_PAYLOAD, approvalId: "approval-1" },
    { rawCallbackData: VALID_WIRE_PAYLOAD },
    { action: "decline" },
  ])("rejects non-exact value shape %#", (value) => {
    expect(extractDingTalkActionWirePayload(value)).toBeUndefined();
  });

  it("extracts exact payload from sanitized Stream card callback data", () => {
    expect(
      extractDingTalkCardCallbackWirePayload({
        headers: { messageId: "stream_card_1", topic: DINGTALK_TOPIC_CARD },
        data: JSON.stringify({ value: VALID_WIRE_PAYLOAD }),
      }),
    ).toBe(VALID_WIRE_PAYLOAD);
  });

  it.each([
    undefined,
    "",
    "{}",
    "not-json",
    JSON.stringify({ value: { wirePayload: VALID_WIRE_PAYLOAD } }),
    JSON.stringify({ value: "approval-1|decline|nonce" }),
    JSON.stringify({ value: VALID_WIRE_PAYLOAD, approvalId: "approval-1" }),
    JSON.stringify({ action: "decline" }),
  ])("fails closed for malformed Stream card callback data %#", (data) => {
    const event: DingTalkStreamEventLike =
      data === undefined
        ? { headers: { messageId: "stream_card_bad", topic: DINGTALK_TOPIC_CARD } }
        : {
            headers: { messageId: "stream_card_bad", topic: DINGTALK_TOPIC_CARD },
            data,
          };

    expect(extractDingTalkCardCallbackWirePayload(event)).toBeUndefined();
  });

  it("does not log while decoding invalid callback payloads", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(extractDingTalkActionWirePayload({ approvalId: "approval-1" })).toBeUndefined();
    } finally {
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("redacts decoded and rejected payloads for future logs", () => {
    expect(redactDingTalkActionPayloadForLog(VALID_WIRE_PAYLOAD)).toBe("v1:[redacted]");
    expect(redactDingTalkActionPayloadForLog({ approvalId: "approval-must-not-log" })).toBe(
      "[invalid-dingtalk-action-payload]",
    );
    expect(redactDingTalkActionPayloadForLog(VALID_WIRE_PAYLOAD)).not.toContain(VALID_WIRE_PAYLOAD);
    expect(
      redactDingTalkActionPayloadForLog({ approvalId: "approval-must-not-log" }),
    ).not.toContain("approval-must-not-log");
  });

  it("does not emit InboundAction from card callbacks before JAC-84 messageRef proof", async () => {
    const streamClient = new FakeDingTalkStreamClient();
    const adapter = new DingTalkChannelAdapter({ streamClient });
    const seen = vi.fn();

    adapter.onAction(seen);
    await adapter.start();
    await streamClient.inject(DINGTALK_TOPIC_CARD, {
      headers: { messageId: "stream_card_1", topic: DINGTALK_TOPIC_CARD },
      data: JSON.stringify({ value: VALID_WIRE_PAYLOAD }),
    });

    expect(seen).not.toHaveBeenCalled();
  });
});
