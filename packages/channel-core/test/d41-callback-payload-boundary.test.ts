import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApprovalCard } from "@codex-im/render";
import { describe, expect, it, vi } from "vitest";
import { TelegramShapeFakeChannelAdapter } from "../src/fake.js";
import type { InboundAction, Target } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET: Target = { platform: "fake-telegram", chatId: "c-1" };

const CARD_WITH_WIRE_PAYLOAD: ApprovalCard = {
  schemaVersion: "approval-card.v1",
  kind: "command_execution",
  approvalId: "approval-7",
  summary: "Run command",
  target: { riskLevel: "high" },
  actions: [
    { kind: "allow_once", wirePayload: "v1:allow-token" },
    { kind: "decline", wirePayload: "v1:decline-token" },
  ],
  status: "pending",
  createdAt: new Date(0),
};

describe("D41 callback payload boundary", () => {
  it("InboundAction carries rawCallbackData as the production callback source", () => {
    const action: InboundAction = {
      approvalId: "approval-7",
      uiAction: { kind: "allow_once" },
      target: TARGET,
      sender: { userId: "u-1" },
      callbackNonce: "nonce-legacy-fallback",
      rawCallbackData: "v1:allow-token",
      receivedAt: new Date(),
      callbackHandle: "cb-q-1",
    };
    expect(action.rawCallbackData).toBe("v1:allow-token");
  });

  it("uses action.wirePayload verbatim as fake Telegram callback_data", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();

    const sent = await adapter.sendCard(TARGET, CARD_WITH_WIRE_PAYLOAD);

    expect(adapter._callbackDataForTest(sent.messageRef)).toEqual([
      "v1:allow-token",
      "v1:decline-token",
    ]);
    await adapter.stop();
  });

  it("falls back to legacy callbackNonce encoding when wirePayload is absent", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();

    const sent = await adapter.sendCard(TARGET, {
      ...CARD_WITH_WIRE_PAYLOAD,
      actions: [{ kind: "allow_once" }],
    });

    expect(adapter._callbackDataForTest(sent.messageRef)).toEqual([
      `approval-7|allow_once|${sent.callbackNonce}`,
    ]);
    await adapter.stop();
  });

  it("injectAction supplies rawCallbackData to action subscribers", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    const seen = vi.fn();
    adapter.onAction(seen);

    adapter.injectAction({
      approvalId: "approval-7",
      uiAction: { kind: "allow_once" },
      target: TARGET,
      sender: { userId: "u-1" },
      callbackNonce: "nonce-legacy-fallback",
      rawCallbackData: "v1:allow-token",
      receivedAt: new Date(),
      callbackHandle: "cb-q-1",
    });

    expect(seen.mock.calls[0]?.[0]?.rawCallbackData).toBe("v1:allow-token");
    await adapter.stop();
  });

  it("defaults rawCallbackData from callbackNonce for legacy fake-adapter tests", async () => {
    const adapter = new TelegramShapeFakeChannelAdapter();
    await adapter.start();
    const seen = vi.fn();
    adapter.onAction(seen);

    adapter.injectAction({
      approvalId: "approval-7",
      uiAction: { kind: "decline" },
      target: TARGET,
      sender: { userId: "u-1" },
      callbackNonce: "nonce-legacy-fallback",
      receivedAt: new Date(),
      callbackHandle: "cb-q-1",
    });

    expect(seen.mock.calls[0]?.[0]?.rawCallbackData).toBe("v1:nonce-legacy-fallback");
    await adapter.stop();
  });

  it("documents callbackNonce as legacy fallback and rawCallbackData as production source", () => {
    const source = readFileSync(join(__dirname, "../src/adapter.ts"), "utf8");

    expect(source).toMatch(/callbackNonce[\s\S]*legacy fallback/);
    expect(source).toMatch(/production[\s\S]*ignores[\s\S]*callbackNonce/);
    expect(source).toMatch(/rawCallbackData[\s\S]*source of truth/);
  });
});
