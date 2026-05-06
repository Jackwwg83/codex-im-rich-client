import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ChannelAdapter, OutboundFile, Target } from "@codex-im/channel-core";
import { describe, expect, it, vi } from "vitest";
import {
  LARK_CAPABILITIES,
  type LarkActionClientLike,
  LarkChannelAdapter,
  type LarkEventDispatcherLike,
  type LarkEventHandlerMap,
  type LarkMessageClientLike,
  type LarkRawCardActionInput,
  type LarkRawMessageEvent,
  type LarkWsClientLike,
  renderLarkApprovalCard,
} from "../src/index.js";

const PACKAGES_DIR = "packages";
const IM_LARK_SRC_DIR = "packages/im-lark/src";
const IM_LARK_TEST_DIR = "packages/im-lark/test";
const FIXTURE_DIR = "packages/im-lark/test/fixtures";
const IGNORED_DIR_NAMES = new Set(["node_modules", "dist", "coverage"]);
const NOW = new Date(1710000700 * 1000);
const TARGET: Target = { platform: "lark", chatId: "oc_contract" };
const REF = { target: TARGET, messageId: "om_contract" };
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
  actions: [{ kind: "decline", wirePayload: "v1:ABCDEFGHIJKLMNOP" }],
  status: "pending",
  createdAt: new Date(0),
};
const REQUIRED_CHANNEL_ADAPTER_METHODS = [
  "answerAction",
  "editText",
  "onAction",
  "onMessage",
  "sendCard",
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
const RAW_LARK_BOUNDARY_PATTERNS = [
  { label: "card action event", pattern: /\bcard\.action\.trigger\b/g },
  { label: "Lark open_message_id", pattern: /\bopen_message_id\b/g },
  { label: "Lark open_chat_id", pattern: /\bopen_chat_id\b/g },
  { label: "Lark SDK import", pattern: /\b@larksuiteoapi\/node-sdk\b/g },
] as const;
const SENSITIVE_LARK_PATTERNS = [
  { label: "Lark app secret", pattern: /\bapp_secret\b/g },
  { label: "Lark tenant access token", pattern: /\btenant_access_token\b/g },
  { label: "Lark verification token", pattern: /\bverification_token\b/g },
  { label: "Lark encrypt key", pattern: /\bencrypt_key\b/g },
] as const;

class FakeLarkEventDispatcher implements LarkEventDispatcherLike {
  readonly actionHandlers: NonNullable<LarkEventHandlerMap["card.action.trigger"]>[] = [];
  readonly messageHandlers: Array<(event: LarkRawMessageEvent) => void | Promise<void>> = [];

  register(handlers: LarkEventHandlerMap) {
    if (handlers["card.action.trigger"] !== undefined) {
      this.actionHandlers.push(handlers["card.action.trigger"]);
    }
    if (handlers["im.message.receive_v1"] !== undefined) {
      this.messageHandlers.push(handlers["im.message.receive_v1"]);
    }
    return this;
  }

  async injectAction(event: LarkRawCardActionInput): Promise<unknown[]> {
    return Promise.all(this.actionHandlers.map((handler) => handler(event)));
  }

  async injectMessage(event: LarkRawMessageEvent): Promise<void> {
    await Promise.all(this.messageHandlers.map((handler) => handler(event)));
  }
}

type ContractHarness = {
  readonly adapter: LarkChannelAdapter;
  readonly dispatcher: FakeLarkEventDispatcher;
  readonly messageCalls: unknown[];
  readonly actionCalls: unknown[];
};

function makeHarness(): ContractHarness {
  const dispatcher = new FakeLarkEventDispatcher();
  const messageCalls: unknown[] = [];
  const actionCalls: unknown[] = [];
  const wsClient: LarkWsClientLike = {
    async start() {},
    close() {},
  };
  const messageClient: LarkMessageClientLike = {
    async sendText(input) {
      messageCalls.push({ method: "sendText", input });
      return { messageId: "om_text_sent" };
    },
    async editText(input) {
      messageCalls.push({ method: "editText", input });
    },
    async sendCard(input) {
      messageCalls.push({ method: "sendCard", input });
      return { messageId: "om_card_sent" };
    },
    async updateCard(input) {
      messageCalls.push({ method: "updateCard", input });
    },
  };
  const actionClient: LarkActionClientLike = {
    async answerAction(input) {
      actionCalls.push(input);
    },
  };
  return {
    adapter: new LarkChannelAdapter({
      wsClient,
      messageClient,
      actionClient,
      createEventDispatcher: () => dispatcher,
      now: () => NOW,
    }),
    dispatcher,
    messageCalls,
    actionCalls,
  };
}

function loadFixture(name: string): LarkRawCardActionInput {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as LarkRawCardActionInput;
}

function loadMessageFixture(name: string): LarkRawMessageEvent {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as LarkRawMessageEvent;
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

describe("LarkChannelAdapter contract and boundaries (JAC-159)", () => {
  it("conforms to the ChannelAdapter required public method surface", () => {
    const { adapter } = makeHarness();
    const channel: ChannelAdapter = adapter;

    expect(channel.capabilities).toBe(LARK_CAPABILITIES);
    expect(channel.capabilities).toEqual({
      supportsButtons: true,
      canEditMessage: true,
      supportsAttachments: false,
      maxCallbackDataBytes: 256,
    });
    expect(Object.isFrozen(channel.capabilities)).toBe(true);
    for (const method of REQUIRED_CHANNEL_ADAPTER_METHODS) {
      expect(typeof channel[method]).toBe("function");
    }
  });

  it("round-trips message, text, card, update, action, and ack through fake clients", async () => {
    const { actionCalls, adapter, dispatcher, messageCalls } = makeHarness();
    const seenMessages = vi.fn();
    const seenActions = vi.fn();
    adapter.onMessage(seenMessages);
    adapter.onAction(seenActions);

    await adapter.start();
    await dispatcher.injectMessage(loadMessageFixture("private-message.json"));
    const sentTextRef = await adapter.sendText(TARGET, "hello lark");
    const replyRef = await adapter.replyText(REF, "reply");
    await adapter.editText(REF, "edited");
    const sentCard = await adapter.sendCard(TARGET, CARD);
    await adapter.updateCard(sentCard.messageRef, { ...CARD, status: "resolved" });
    const actionResponses = await dispatcher.injectAction(loadFixture("card-action-private.json"));
    const inboundAction = seenActions.mock.calls[0]?.[0];
    await adapter.answerAction(inboundAction.callbackHandle, {
      ok: false,
      userMessage: "stale or unknown",
    });

    expect(seenMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { platform: "lark", chatId: "oc_test_private_chat" },
        text: "hello codex",
      }),
    );
    expect(sentTextRef).toEqual({
      target: TARGET,
      messageId: "om_text_sent",
      kind: "text",
      textUpdateMode: "edit",
    });
    expect(replyRef).toEqual({
      target: TARGET,
      messageId: "om_text_sent",
      kind: "text",
      textUpdateMode: "edit",
    });
    expect(sentCard).toEqual({
      messageRef: {
        target: TARGET,
        messageId: "om_card_sent",
        kind: "approval_card",
        textUpdateMode: "edit",
      },
      callbackNonce: "",
    });
    expect(seenActions).toHaveBeenCalledWith(
      expect.objectContaining({
        rawCallbackData: "v1:ABCDEFGHIJKLMNOP",
        messageRef: {
          target: { platform: "lark", chatId: "oc_card_private" },
          messageId: "om_card_private",
          kind: "approval_card",
          textUpdateMode: "edit",
        },
      }),
    );
    expect(actionResponses).toEqual([{ toast: { type: "info", content: "Decision received" } }]);
    expect(messageCalls).toEqual([
      { method: "sendText", input: { target: TARGET, text: "hello lark" } },
      {
        method: "sendText",
        input: { target: TARGET, text: "reply", replyToMessageId: "om_contract" },
      },
      { method: "editText", input: { messageRef: REF, text: "edited" } },
      { method: "sendCard", input: { target: TARGET, card: renderLarkApprovalCard(CARD) } },
      {
        method: "updateCard",
        input: {
          messageRef: {
            target: TARGET,
            messageId: "om_card_sent",
            kind: "approval_card",
            textUpdateMode: "edit",
          },
          card: renderLarkApprovalCard({ ...CARD, status: "resolved" }),
        },
      },
    ]);
    expect(JSON.stringify(actionCalls)).not.toContain("v1:ABCDEFGHIJKLMNOP");
    expect(actionCalls).toEqual([
      expect.objectContaining({
        eventId: "ev_private_card_action",
        ack: { ok: false, userMessage: "stale or unknown" },
      }),
    ]);
  });

  it("fails closed for unsupported attachment sends", async () => {
    const { adapter, messageCalls } = makeHarness();
    const channel: ChannelAdapter = adapter;

    await expect(channel.sendFile(TARGET, FILE)).rejects.toThrow(/sendFile/);

    expect(messageCalls).toEqual([]);
  });

  it("production source has no webhook, public listener, or HTTP server entry point", () => {
    const offenders = listTsFiles(IM_LARK_SRC_DIR).flatMap((file) =>
      lineRefs(file, stripComments(readFileSync(file, "utf8")), LISTENER_PATTERNS),
    );

    expect(offenders).toEqual([]);
  });

  it("does not commit Lark secret field literals in im-lark source, tests, or fixtures", () => {
    const scanned = [
      ...listTsFiles(IM_LARK_SRC_DIR),
      ...listFiles(IM_LARK_TEST_DIR, (file) => file.endsWith(".ts") || file.endsWith(".json")),
    ];
    const offenders = scanned.flatMap((file) =>
      lineRefs(file, stripComments(readFileSync(file, "utf8")), SENSITIVE_LARK_PATTERNS),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps raw Lark wire/API details inside im-lark production source", () => {
    const offenders = listFiles(
      PACKAGES_DIR,
      (file) =>
        file.endsWith(".ts") && file.includes("/src/") && !file.startsWith(`${IM_LARK_SRC_DIR}/`),
    ).flatMap((file) =>
      lineRefs(file, stripComments(readFileSync(file, "utf8")), RAW_LARK_BOUNDARY_PATTERNS),
    );

    expect(offenders).toEqual([]);
  });
});
