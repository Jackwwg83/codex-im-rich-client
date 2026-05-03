import { describe, expect, it } from "vitest";
import {
  DAEMON_CODEX_CONFIG_OVERRIDES,
  renderResolvedCallbackApprovalCard,
} from "../src/daemon-run.js";

describe("daemon run safety rails", () => {
  it("starts Codex app-server with read-only sandbox and on-request approvals", () => {
    expect(DAEMON_CODEX_CONFIG_OVERRIDES).toEqual({
      sandbox_mode: "read-only",
      approval_policy: "on-request",
    });
  });

  it("renders a terminal callback card with no actions so IM buttons are removed", () => {
    const card = renderResolvedCallbackApprovalCard({
      tokenHash: "hash",
      approvalId: "approval-1",
      action: "allow_once",
      callbackNonce: "nonce",
      target: { platform: "telegram", chatId: "123" },
      actor: { kind: "im", userId: "456", platform: "telegram" },
      status: "used",
      messageRef: { chatId: "123", messageId: "9" },
      createdAt: "2026-05-03T11:28:37.158Z",
      expiresAt: "2026-05-03T11:58:37.158Z",
    });

    expect(card).toEqual({
      schemaVersion: "approval-card.v1",
      kind: "unknown",
      approvalId: "approval-1",
      summary: "Decision recorded: allow once",
      target: { riskLevel: "low" },
      actions: [],
      status: "resolved",
      createdAt: new Date("2026-05-03T11:28:37.158Z"),
    });
  });
});
