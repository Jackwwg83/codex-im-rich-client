// T18 (Phase 2) — channel-core type surface tests.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T18
//
// Validates that the type shapes a future ChannelAdapter implementation
// will need are present and structurally correct. Logic-bearing tests
// (round-trip, callback bounds, deadline) live in T19's fake-adapter
// test files.

import { describe, expect, it } from "vitest";
import type {
  InboundAction,
  InboundMessage,
  MessageRef,
  OutboundFile,
  Sender,
  Target,
} from "../src/index.js";

describe("channel-core types (T18)", () => {
  it("Target admits required + optional fields", () => {
    const cases: Target[] = [
      { platform: "telegram", chatId: "c-1" },
      { platform: "telegram", chatId: "c-1", threadKey: "t-7" },
      { platform: "lark", chatId: "c-2", topicId: "topic-3" },
      { platform: "fake", chatId: "c-9", threadKey: "t-1", topicId: "topic-1" },
    ];
    expect(cases.length).toBe(4);
  });

  it("Sender admits userId + optional displayName", () => {
    const cases: Sender[] = [{ userId: "u-1" }, { userId: "u-2", displayName: "Alice" }];
    expect(cases.length).toBe(2);
  });

  it("MessageRef carries target + opaque messageId", () => {
    const ref: MessageRef = {
      target: { platform: "telegram", chatId: "c-1" },
      messageId: "msg-42",
    };
    expect(ref.messageId).toBe("msg-42");
  });

  it("OutboundFile accepts Uint8Array bytes + filename + contentType", () => {
    const file: OutboundFile = {
      filename: "diff.patch",
      bytes: new Uint8Array([0x68, 0x69]),
      contentType: "text/plain",
    };
    expect(file.bytes.byteLength).toBe(2);
  });

  it("InboundMessage composes target + sender + text + timestamp + ref", () => {
    const msg: InboundMessage = {
      target: { platform: "telegram", chatId: "c-1" },
      sender: { userId: "u-1" },
      text: "hello",
      receivedAt: new Date(),
      messageRef: {
        target: { platform: "telegram", chatId: "c-1" },
        messageId: "msg-1",
      },
    };
    expect(msg.text).toBe("hello");
  });

  it("InboundAction carries the 4-field broker.resolve contract", () => {
    const action: InboundAction = {
      approvalId: "approval-7",
      uiAction: { kind: "allow_once" },
      target: { platform: "telegram", chatId: "c-1" },
      sender: { userId: "u-1" },
      callbackNonce: "nonce-aaaaaaaaaaa",
      rawCallbackData: "v1:token",
      receivedAt: new Date(),
      callbackHandle: "callback-query-id-1",
    };
    expect(action.uiAction.kind).toBe("allow_once");
    expect(action.callbackNonce).toBeTruthy();
    expect(action.rawCallbackData).toBe("v1:token");
  });

  it("InboundAction.uiAction admits all 4 ApprovalAction variants", () => {
    const variants: InboundAction["uiAction"][] = [
      { kind: "allow_once" },
      { kind: "allow_session" },
      { kind: "decline" },
      { kind: "abort" },
    ];
    expect(variants.length).toBe(4);
  });
});
