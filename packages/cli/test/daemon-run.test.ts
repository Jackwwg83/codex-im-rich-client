import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DAEMON_CODEX_CONFIG_OVERRIDES,
  DAEMON_SERVER_REQUEST_HANDLER_TIMEOUT_MS,
  MultiPlatformDaemonAdapter,
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

  it("preserves the original approval kind, risk, and summary on resolved cards", () => {
    const originalCard = {
      schemaVersion: "approval-card.v1",
      kind: "command_execution",
      approvalId: "approval-1",
      summary: "Run command: touch /tmp/example",
      target: { riskLevel: "high" },
      actions: [
        { kind: "allow_once", wirePayload: "v1:ABCDEFGHIJKLMNOP" },
        { kind: "decline", wirePayload: "v1:QRSTUVWXYZ234567" },
      ],
      status: "pending",
      createdAt: new Date("2026-05-03T11:28:37.158Z"),
    } as const;

    const card = renderResolvedCallbackApprovalCard(
      {
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
      },
      originalCard,
    );

    expect(card).toEqual({
      schemaVersion: "approval-card.v1",
      kind: "command_execution",
      approvalId: "approval-1",
      summary: "Decision recorded: allow once\nRun command: touch /tmp/example",
      target: { riskLevel: "high" },
      actions: [],
      status: "resolved",
      createdAt: new Date("2026-05-03T11:28:37.158Z"),
    });
    expect(originalCard.actions).toEqual([
      { kind: "allow_once", wirePayload: "v1:ABCDEFGHIJKLMNOP" },
      { kind: "decline", wirePayload: "v1:QRSTUVWXYZ234567" },
    ]);
  });

  it("wires durable thread sessions into the production daemon", () => {
    const source = readFileSync(join(import.meta.dirname, "../src/daemon-run.ts"), "utf8");

    expect(source).toContain("new ThreadSessionRepository(db)");
    expect(source).toContain("threadSessionRepository");
    expect(source).toContain("switchCurrent");
  });

  it("wires Telegram, Lark, and DingTalk production adapters behind one daemon surface", () => {
    const source = readFileSync(join(import.meta.dirname, "../src/daemon-run.ts"), "utf8");

    expect(source).toContain("new TelegramChannelAdapter");
    expect(source).toContain("createLarkSdkChannelAdapter");
    expect(source).toContain("new DingTalkChannelAdapter");
    expect(source).toContain("createDingTalkSessionReplyTextClient");
    expect(source).toContain("createDingTalkStreamClient");
  });

  it("routes multi-platform daemon sends and callback acknowledgements by platform", async () => {
    const calls: unknown[] = [];
    const makeAdapter = (platform: string) => ({
      onAction: () => () => calls.push({ platform, method: "unsubscribeAction" }),
      onMessage: () => () => calls.push({ platform, method: "unsubscribeMessage" }),
      async start() {
        calls.push({ platform, method: "start" });
      },
      async stop() {
        calls.push({ platform, method: "stop" });
      },
      async answerAction(callbackHandle: string) {
        calls.push({ platform, method: "answerAction", callbackHandle });
      },
      async sendText(target: { platform: string; chatId: string }, body: string) {
        calls.push({ platform, method: "sendText", target, body });
        return { target, messageId: `${platform}-text-1` };
      },
      async sendCard(target: { platform: string; chatId: string }) {
        calls.push({ platform, method: "sendCard", target });
        return {
          messageRef: { target, messageId: `${platform}-card-1` },
          callbackNonce: "",
        };
      },
      async updateCard(ref: { target: { platform: string; chatId: string }; messageId: string }) {
        calls.push({ platform, method: "updateCard", ref });
      },
      async editText(
        ref: { target: { platform: string; chatId: string }; messageId: string },
        body: string,
      ) {
        calls.push({ platform, method: "editText", ref, body });
      },
    });
    const adapter = new MultiPlatformDaemonAdapter([
      { platform: "telegram", adapter: makeAdapter("telegram") },
      { platform: "lark", adapter: makeAdapter("lark") },
      { platform: "dingtalk", adapter: makeAdapter("dingtalk") },
    ]);
    const larkTarget = { platform: "lark", chatId: "oc_test" };
    const dingTalkRef = {
      target: { platform: "dingtalk", chatId: "cid_test" },
      messageId: "ding-card-1",
    };

    await adapter.start();
    await adapter.sendText(larkTarget, "hello");
    await adapter.sendCard(dingTalkRef.target, {
      schemaVersion: "approval-card.v1",
      kind: "unknown",
      approvalId: "approval-test",
      summary: "approve",
      target: { riskLevel: "low" },
      actions: [],
      status: "pending",
      createdAt: new Date(0),
    });
    await adapter.updateCard(dingTalkRef, {
      schemaVersion: "approval-card.v1",
      kind: "unknown",
      approvalId: "approval-test",
      summary: "approved",
      target: { riskLevel: "low" },
      actions: [],
      status: "resolved",
      createdAt: new Date(0),
    });
    await adapter.editText(dingTalkRef, "done");
    await adapter.answerAction("lark-card-action:1777751000000:event-1", {
      ok: true,
      userMessage: "ok",
    });
    await adapter.stop();

    expect(calls).toEqual([
      { platform: "telegram", method: "start" },
      { platform: "lark", method: "start" },
      { platform: "dingtalk", method: "start" },
      { platform: "lark", method: "sendText", target: larkTarget, body: "hello" },
      { platform: "dingtalk", method: "sendCard", target: dingTalkRef.target },
      { platform: "dingtalk", method: "updateCard", ref: dingTalkRef },
      { platform: "dingtalk", method: "editText", ref: dingTalkRef, body: "done" },
      {
        platform: "lark",
        method: "answerAction",
        callbackHandle: "lark-card-action:1777751000000:event-1",
      },
      { platform: "dingtalk", method: "stop" },
      { platform: "lark", method: "stop" },
      { platform: "telegram", method: "stop" },
    ]);
  });

  it("lets IM approval handlers outlive the default 30s client safety timeout", () => {
    const source = readFileSync(join(import.meta.dirname, "../src/daemon-run.ts"), "utf8");

    expect(DAEMON_SERVER_REQUEST_HANDLER_TIMEOUT_MS).toBeGreaterThan(30 * 60 * 1000);
    expect(source).toContain(
      "serverRequestHandlerTimeoutMs: DAEMON_SERVER_REQUEST_HANDLER_TIMEOUT_MS",
    );
    expect(source).toContain("createDaemonAppServerClient(transport, logger)");
    expect(source).toContain("createDaemonAppServerClient(placeholderTransport, logger)");
  });
});
