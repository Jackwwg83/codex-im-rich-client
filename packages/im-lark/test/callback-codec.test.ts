import { describe, expect, it, vi } from "vitest";
import {
  extractLarkActionWirePayload,
  redactLarkActionPayloadForLog,
  renderLarkApprovalCard,
} from "../src/index.js";

const VALID_WIRE_PAYLOAD = "v1:ABCDEFGHIJKLMNOP";

describe("Lark callback payload codec (JAC-156)", () => {
  it("extracts the exact v1 opaque payload from rendered Lark button values", () => {
    const card = renderLarkApprovalCard({
      schemaVersion: "approval-card.v1",
      kind: "command_execution",
      approvalId: "approval-must-not-be-decoded",
      summary: "Run pnpm test",
      target: { riskLevel: "high" },
      actions: [{ kind: "decline", wirePayload: VALID_WIRE_PAYLOAD }],
      status: "pending",
      createdAt: new Date(0),
    });

    expect(extractLarkActionWirePayload(firstButtonValue(card))).toBe(VALID_WIRE_PAYLOAD);
  });

  it("also accepts an already-normalized exact wire payload string", () => {
    expect(extractLarkActionWirePayload(VALID_WIRE_PAYLOAD)).toBe(VALID_WIRE_PAYLOAD);
  });

  it.each([
    "approval-1",
    "allow_once",
    "decline",
    "actor-open-id",
    "lark:chat:message",
    "approval-1|decline|nonce",
    JSON.stringify({ wirePayload: VALID_WIRE_PAYLOAD }),
    "v2:ABCDEFGHIJKLMNOP",
    "v1:abcdefghijklmnop",
    "v1:ABCDEFGHIJKLMNO",
    "v1:ABCDEFGHIJKLMNOPQ",
    "v1:ABCDEFGHIJKLMN01",
  ])("rejects unsafe string payload %s", (value) => {
    expect(extractLarkActionWirePayload(value)).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    123,
    true,
    [],
    {},
    { wirePayload: undefined },
    { wirePayload: "approval-1|decline|nonce" },
    { wirePayload: VALID_WIRE_PAYLOAD, action: "decline" },
    { wirePayload: VALID_WIRE_PAYLOAD, approvalId: "approval-1" },
    { rawCallbackData: VALID_WIRE_PAYLOAD },
    { action: "decline" },
  ])("rejects non-exact value shape %#", (value) => {
    expect(extractLarkActionWirePayload(value)).toBeUndefined();
  });

  it("does not log while decoding invalid payloads", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(extractLarkActionWirePayload({ approvalId: "approval-1" })).toBeUndefined();
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
    expect(redactLarkActionPayloadForLog({ wirePayload: VALID_WIRE_PAYLOAD })).toBe(
      "v1:[redacted]",
    );
    expect(redactLarkActionPayloadForLog({ approvalId: "approval-must-not-log" })).toBe(
      "[invalid-lark-action-payload]",
    );
    expect(redactLarkActionPayloadForLog({ wirePayload: VALID_WIRE_PAYLOAD })).not.toContain(
      VALID_WIRE_PAYLOAD,
    );
    expect(redactLarkActionPayloadForLog({ approvalId: "approval-must-not-log" })).not.toContain(
      "approval-must-not-log",
    );
  });
});

type RenderedCard = ReturnType<typeof renderLarkApprovalCard>;

function firstButtonValue(card: RenderedCard): unknown {
  const actionElement = card.elements.find((element) => element.tag === "action");
  if (actionElement?.tag !== "action") {
    return undefined;
  }
  return actionElement.actions[0]?.value;
}
