import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ChannelAdapter, OutboundFile, Target } from "@codex-im/channel-core";
import { describe, expect, it, vi } from "vitest";
import {
  DINGTALK_CAPABILITIES,
  DINGTALK_TOPIC_CARD,
  DINGTALK_TOPIC_ROBOT,
  type DingTalkActionClientLike,
  type DingTalkCardClientLike,
  DingTalkChannelAdapter,
  type DingTalkInboundAction,
  type DingTalkProactiveMessageClientLike,
  type DingTalkSessionReplyTextClientLike,
  type DingTalkStreamClientLike,
  type DingTalkStreamEventHandler,
  type DingTalkStreamEventLike,
  renderDingTalkApprovalCard,
} from "../src/index.js";

const PACKAGES_DIR = "packages";
const IM_DINGTALK_SRC_DIR = "packages/im-dingtalk/src";
const IM_DINGTALK_FIXTURE_DIR = "packages/im-dingtalk/test/fixtures";
const IGNORED_DIR_NAMES = new Set(["node_modules", "dist", "coverage"]);
const NOW = new Date("2026-05-02T20:00:00.000Z");
const TARGET: Target = { platform: "dingtalk", chatId: "cid_card_group" };
const FILE: OutboundFile = {
  filename: "evidence.txt",
  bytes: new TextEncoder().encode("not sent"),
  contentType: "text/plain",
};
const CARD: Parameters<ChannelAdapter["sendCard"]>[1] = {
  schemaVersion: "approval-card.v1",
  kind: "command_execution",
  approvalId: "approval-contract-hidden",
  summary: "Run pnpm test",
  target: { riskLevel: "high" },
  actions: [{ kind: "allow_once", wirePayload: "v1:ABCDEFGHIJKLMNOP" }],
  status: "pending",
  createdAt: new Date(0),
};
const REQUIRED_CHANNEL_ADAPTER_METHODS = [
  "answerAction",
  "editText",
  "onAction",
  "onMessage",
  "sendCard",
  "sendText",
  "sendFile",
  "start",
  "stop",
  "updateCard",
] as const;
const LISTENER_PATTERNS = [
  { label: "node:http import", pattern: /\bfrom\s+["']node:http["']/g },
  { label: "node:https import", pattern: /\bfrom\s+["']node:https["']/g },
  { label: "node:net import", pattern: /\bfrom\s+["']node:net["']/g },
  { label: "createServer", pattern: /\bcreateServer\s*\(/g },
  { label: "server listen", pattern: /\.listen\s*\(/g },
  { label: "webhook", pattern: /\bwebhook\b/g },
] as const;
const LOGGING_PATTERNS = [
  { label: "console logging", pattern: /\bconsole\.(?:debug|error|info|log|warn)\s*\(/g },
  { label: "logger logging", pattern: /\blogger\.(?:debug|error|info|log|warn)\s*\(/g },
] as const;
const SENSITIVE_DINGTALK_FIXTURE_PATTERNS = [
  { label: "DingTalk client secret", pattern: /(?:\\"|")clientSecret(?:\\"|")\s*:/g },
  { label: "DingTalk client secret", pattern: /(?:\\"|")client_secret(?:\\"|")\s*:/g },
  { label: "DingTalk app secret", pattern: /(?:\\"|")appSecret(?:\\"|")\s*:/g },
  { label: "DingTalk app secret", pattern: /(?:\\"|")app_secret(?:\\"|")\s*:/g },
  { label: "DingTalk access token", pattern: /(?:\\"|")accessToken(?:\\"|")\s*:/g },
  { label: "DingTalk access token", pattern: /(?:\\"|")access_token(?:\\"|")\s*:/g },
  { label: "DingTalk session webhook", pattern: /(?:\\"|")sessionWebhook(?:\\"|")\s*:/g },
  { label: "authorization header", pattern: /(?:\\"|")Authorization(?:\\"|")\s*:/g },
  { label: "bearer credential", pattern: /\bBearer\s+[A-Za-z0-9._-]+/g },
] as const;
const RAW_DINGTALK_BOUNDARY_PATTERNS = [
  { label: "DingTalk robot topic", pattern: /\/v1\.0\/im\/bot\/messages\/get/g },
  { label: "DingTalk card callback topic", pattern: /\/v1\.0\/card\/instances\/callback/g },
  { label: "DingTalk outTrackId", pattern: /\boutTrackId\b/g },
  { label: "DingTalk spaceId", pattern: /\bspaceId\b/g },
  { label: "DingTalk spaceType", pattern: /\bspaceType\b/g },
  { label: "DingTalk senderStaffId", pattern: /\bsenderStaffId\b/g },
  { label: "DingTalk stream SDK import", pattern: /\bdingtalk-stream\b/g },
  { label: "DingTalk OpenAPI SDK import", pattern: /\b@alicloud\/dingtalk\b/g },
] as const;

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

type ContractHarness = {
  readonly adapter: DingTalkChannelAdapter;
  readonly streamClient: FakeDingTalkStreamClient;
  readonly cardCalls: unknown[];
  readonly actionCalls: unknown[];
  readonly proactiveCalls: unknown[];
  readonly textCalls: unknown[];
};

function makeHarness(opts: { readonly proactive?: boolean } = {}): ContractHarness {
  const streamClient = new FakeDingTalkStreamClient();
  const cardCalls: unknown[] = [];
  const actionCalls: unknown[] = [];
  const proactiveCalls: unknown[] = [];
  const textCalls: unknown[] = [];
  const cardClient: DingTalkCardClientLike = {
    async sendCard(input) {
      cardCalls.push({ method: "sendCard", input });
      return { messageId: "ding_card_group_001" };
    },
    async updateCard(input) {
      cardCalls.push({ method: "updateCard", input });
    },
    async editText(input) {
      cardCalls.push({ method: "editText", input });
    },
  };
  const actionClient: DingTalkActionClientLike = {
    async answerAction(input) {
      actionCalls.push(input);
    },
  };
  const textClient: DingTalkSessionReplyTextClientLike = {
    async sendText(input) {
      textCalls.push(input);
      return { messageId: "ding_text_private_001" };
    },
    async sendFile(input) {
      textCalls.push(input);
      return { messageId: "ding_file_private_001" };
    },
  };
  const proactiveClient: DingTalkProactiveMessageClientLike = {
    async sendFile(input) {
      proactiveCalls.push(input);
      return { messageId: "ding_proactive_file_001" };
    },
  };
  return {
    adapter: new DingTalkChannelAdapter({
      streamClient,
      cardClient,
      actionClient,
      textClient,
      ...(opts.proactive === false ? {} : { proactiveClient }),
      now: () => NOW,
    }),
    streamClient,
    cardCalls,
    actionCalls,
    proactiveCalls,
    textCalls,
  };
}

function loadFixture(name: string): DingTalkStreamEventLike {
  return JSON.parse(
    readFileSync(join(IM_DINGTALK_FIXTURE_DIR, name), "utf8"),
  ) as DingTalkStreamEventLike;
}

function loadFixtureWithSessionReply(name: string): DingTalkStreamEventLike {
  const event = loadFixture(name);
  const data = JSON.parse(event.data ?? "{}") as Record<string, unknown>;
  return {
    ...event,
    data: JSON.stringify({
      ...data,
      sessionWebhook: "https://dingtalk.example.test/session-reply",
    }),
  };
}

function listFiles(root: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (IGNORED_DIR_NAMES.has(name)) {
      continue;
    }
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full, accept));
    } else if (accept(full)) {
      out.push(full);
    }
  }
  return out.sort();
}

function listTsFiles(root: string): string[] {
  return listFiles(root, (file) => file.endsWith(".ts"));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function lineRefs(
  file: string,
  source: string,
  rules: readonly { readonly label: string; readonly pattern: RegExp }[],
): string[] {
  const offenders: string[] = [];
  for (const rule of rules) {
    for (const match of source.matchAll(rule.pattern)) {
      const lineNo = source.slice(0, match.index ?? 0).split("\n").length;
      offenders.push(`${file}:${lineNo}: ${rule.label}`);
    }
  }
  return offenders;
}

describe("DingTalkChannelAdapter contract and boundaries (JAC-87)", () => {
  it("conforms to the ChannelAdapter required public method surface", () => {
    const { adapter } = makeHarness();
    const channel: ChannelAdapter = adapter;

    expect(channel.capabilities).toBe(DINGTALK_CAPABILITIES);
    expect(channel.capabilities).toEqual({
      supportsButtons: true,
      canEditMessage: true,
      supportsAttachments: true,
      maxCallbackDataBytes: 64,
    });
    expect(Object.isFrozen(channel.capabilities)).toBe(true);
    for (const method of REQUIRED_CHANNEL_ADAPTER_METHODS) {
      expect(typeof channel[method]).toBe("function");
    }
  });

  it("round-trips message, card, update, edit, action, and ack through fake clients", async () => {
    const { actionCalls, adapter, cardCalls, streamClient, textCalls } = makeHarness();
    const seenMessages = vi.fn();
    const seenActions = vi.fn();
    adapter.onMessage(seenMessages);
    adapter.onAction(seenActions);

    await adapter.start();
    await streamClient.inject(
      DINGTALK_TOPIC_ROBOT,
      loadFixtureWithSessionReply("private-text-message.json"),
    );
    const sentText = await adapter.sendText(
      { platform: "dingtalk", chatId: "staff_test_private" },
      "Codex is working...",
    );
    const sentFile = await adapter.sendFile(
      { platform: "dingtalk", chatId: "staff_test_private" },
      FILE,
    );
    await adapter.editText(sentText, "Done");
    const sentCard = await adapter.sendCard(TARGET, CARD);
    await adapter.updateCard(sentCard.messageRef, { ...CARD, status: "resolved" });
    await adapter.editText(sentCard.messageRef, "edited");
    await streamClient.inject(DINGTALK_TOPIC_CARD, loadFixture("card-action-group.json"));
    const inboundAction = seenActions.mock.calls[0]?.[0] as DingTalkInboundAction;
    await adapter.answerAction(inboundAction.callbackHandle, {
      ok: false,
      userMessage: "stale or unknown",
    });

    expect(seenMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { platform: "dingtalk", chatId: "staff_test_private" },
        text: "hello from dingtalk",
      }),
    );
    expect(sentCard).toEqual({
      messageRef: {
        target: TARGET,
        messageId: "ding_card_group_001",
        kind: "approval_card",
        textUpdateMode: "edit",
      },
      callbackNonce: "",
    });
    expect(sentText).toEqual({
      target: { platform: "dingtalk", chatId: "staff_test_private" },
      messageId: "dingtalk-text:ding_text_private_001",
      kind: "text",
      textUpdateMode: "append",
    });
    expect(sentFile).toEqual({
      target: { platform: "dingtalk", chatId: "staff_test_private" },
      messageId: "dingtalk-file:ding_file_private_001",
      kind: "file",
      textUpdateMode: "append",
    });
    expect(seenActions).toHaveBeenCalledWith(
      expect.objectContaining({
        rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
        messageRef: {
          target: TARGET,
          messageId: "ding_card_group_001",
          kind: "approval_card",
          textUpdateMode: "edit",
        },
      }),
    );
    expect(cardCalls).toEqual([
      { method: "sendCard", input: { target: TARGET, card: renderDingTalkApprovalCard(CARD) } },
      {
        method: "updateCard",
        input: {
          messageRef: {
            target: TARGET,
            messageId: "ding_card_group_001",
            kind: "approval_card",
            textUpdateMode: "edit",
          },
          card: renderDingTalkApprovalCard({ ...CARD, status: "resolved" }),
        },
      },
      {
        method: "editText",
        input: {
          messageRef: {
            target: TARGET,
            messageId: "ding_card_group_001",
            kind: "approval_card",
            textUpdateMode: "edit",
          },
          text: "edited",
        },
      },
    ]);
    expect(JSON.stringify(actionCalls)).not.toContain("v1:ABCDEFGHIJKLMNOP");
    expect(textCalls).toEqual([
      {
        sessionWebhook: "https://dingtalk.example.test/session-reply",
        text: "Codex is working...",
      },
      {
        sessionWebhook: "https://dingtalk.example.test/session-reply",
        file: FILE,
      },
      {
        sessionWebhook: "https://dingtalk.example.test/session-reply",
        text: "Done",
      },
    ]);
    expect(actionCalls).toEqual([
      expect.objectContaining({
        streamMessageId: "stream_card_group_001",
        outTrackId: "ding_card_group_001",
        ack: { ok: false, userMessage: "stale or unknown" },
      }),
    ]);
  });

  it("fails closed for attachment sends before a session reply URL is known", async () => {
    const { adapter, cardCalls } = makeHarness({ proactive: false });
    const channel: ChannelAdapter = adapter;

    await adapter.start();
    await expect(channel.sendFile(TARGET, FILE)).rejects.toThrow(
      /requires a recent inbound session reply URL/,
    );

    expect(cardCalls).toEqual([]);
  });

  it("falls back to proactive media when no session reply URL is known", async () => {
    const { adapter, proactiveCalls, textCalls } = makeHarness();

    await adapter.start();
    const sentFile = await adapter.sendFile(TARGET, FILE);

    expect(sentFile).toEqual({
      target: TARGET,
      messageId: "dingtalk-file:ding_proactive_file_001",
      kind: "file",
      textUpdateMode: "append",
    });
    expect(textCalls).toEqual([]);
    expect(proactiveCalls).toEqual([{ target: TARGET, file: FILE }]);
  });

  it("production source has no webhook, public listener, HTTP server, or logging sink", () => {
    const offenders = listTsFiles(IM_DINGTALK_SRC_DIR).flatMap((file) =>
      lineRefs(file, stripComments(readFileSync(file, "utf8")), [
        ...LISTENER_PATTERNS,
        ...LOGGING_PATTERNS,
      ]),
    );

    expect(offenders).toEqual([]);
  });

  it("does not commit DingTalk secret-bearing fields in fixtures", () => {
    const offenders = listFiles(IM_DINGTALK_FIXTURE_DIR, (file) => file.endsWith(".json")).flatMap(
      (file) => lineRefs(file, readFileSync(file, "utf8"), SENSITIVE_DINGTALK_FIXTURE_PATTERNS),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps raw DingTalk wire/API details inside im-dingtalk production source", () => {
    const offenders = listFiles(
      PACKAGES_DIR,
      (file) =>
        file.endsWith(".ts") &&
        file.includes("/src/") &&
        !file.startsWith(`${IM_DINGTALK_SRC_DIR}/`) &&
        !file.includes("/codex-protocol/src/generated/"),
    ).flatMap((file) =>
      lineRefs(file, stripComments(readFileSync(file, "utf8")), RAW_DINGTALK_BOUNDARY_PATTERNS),
    );

    expect(offenders).toEqual([]);
  });
});
