import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ChannelAdapter, OutboundFile, Target } from "@codex-im/channel-core";
import { describe, expect, it, vi } from "vitest";
import {
  TELEGRAM_CAPABILITIES,
  type TelegramBotApiLike,
  type TelegramBotLike,
  TelegramChannelAdapter,
} from "../src/index.js";

const PACKAGES_DIR = "packages";
const IM_TELEGRAM_SRC_DIR = "packages/im-telegram/src";
const IM_TELEGRAM_TEST_DIR = "packages/im-telegram/test";
const IGNORED_DIR_NAMES = new Set(["node_modules", "dist", "coverage"]);
const TARGET: Target = { platform: "telegram", chatId: "chat-1" };
const FILE: OutboundFile = {
  filename: "evidence.txt",
  bytes: new TextEncoder().encode("not sent"),
  contentType: "text/plain",
};

const CLOSED_CHANNEL_ADAPTER_METHODS = [
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
  { label: "webhookCallback", pattern: /\bwebhookCallback\b/g },
  { label: "startWebhook", pattern: /\bstartWebhook\b/g },
  { label: "setWebhook", pattern: /\bsetWebhook\b/g },
] as const;

const RAW_TELEGRAM_BOUNDARY_PATTERNS = [
  { label: "grammY import", pattern: /\bfrom\s+["']grammy["']/g },
  { label: "callback_query wire key", pattern: /\bcallback_query\b/g },
  { label: "message_thread_id wire key", pattern: /\bmessage_thread_id\b/g },
  { label: "reply_markup wire key", pattern: /\breply_markup\b/g },
  { label: "inline_keyboard wire key", pattern: /\binline_keyboard\b/g },
  { label: "answerCallbackQuery API", pattern: /\banswerCallbackQuery\b/g },
  { label: "editMessageReplyMarkup API", pattern: /\beditMessageReplyMarkup\b/g },
  { label: "editMessageText API", pattern: /\beditMessageText\b/g },
] as const;

const TELEGRAM_BOT_TOKEN_SHAPE = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g;

type ApiMocks = {
  readonly sendMessage: ReturnType<typeof vi.fn<TelegramBotApiLike["sendMessage"]>>;
  readonly editMessageReplyMarkup: ReturnType<
    typeof vi.fn<TelegramBotApiLike["editMessageReplyMarkup"]>
  >;
  readonly editMessageText: ReturnType<typeof vi.fn<TelegramBotApiLike["editMessageText"]>>;
  readonly answerCallbackQuery: ReturnType<typeof vi.fn<TelegramBotApiLike["answerCallbackQuery"]>>;
};

function makeBot(): { readonly bot: TelegramBotLike; readonly api: ApiMocks } {
  const api: ApiMocks = {
    sendMessage: vi.fn<TelegramBotApiLike["sendMessage"]>(async () => ({ message_id: 1 })),
    editMessageReplyMarkup: vi.fn<TelegramBotApiLike["editMessageReplyMarkup"]>(async () => true),
    editMessageText: vi.fn<TelegramBotApiLike["editMessageText"]>(async () => true),
    answerCallbackQuery: vi.fn<TelegramBotApiLike["answerCallbackQuery"]>(async () => true),
  };
  return {
    bot: {
      start: vi.fn(async () => undefined),
      stop: vi.fn(() => undefined),
      api,
    },
    api,
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

describe("TelegramChannelAdapter contract and boundaries (JAC-61)", () => {
  it("conforms to the closed ChannelAdapter public method surface", () => {
    const { bot } = makeBot();
    const adapter = new TelegramChannelAdapter({ bot });
    const channel: ChannelAdapter = adapter;

    expect(channel.capabilities).toBe(TELEGRAM_CAPABILITIES);
    expect(channel.capabilities).toEqual({
      supportsButtons: true,
      canEditMessage: true,
      supportsAttachments: false,
      maxCallbackDataBytes: 64,
    });
    expect(Object.isFrozen(channel.capabilities)).toBe(true);
    expect(
      Object.getOwnPropertyNames(TelegramChannelAdapter.prototype)
        .filter((name) => name !== "constructor")
        .sort(),
    ).toEqual([...CLOSED_CHANNEL_ADAPTER_METHODS].sort());
  });

  it("fails closed for unsupported attachment sends", async () => {
    const { api, bot } = makeBot();
    const channel: ChannelAdapter = new TelegramChannelAdapter({ bot });

    await expect(channel.sendFile(TARGET, FILE)).rejects.toThrow(/sendFile/);

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(api.editMessageText).not.toHaveBeenCalled();
    expect(api.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("production source has no webhook, public listener, or HTTP server entry point", () => {
    const offenders = listTsFiles(IM_TELEGRAM_SRC_DIR).flatMap((file) =>
      lineRefs(file, readFileSync(file, "utf8"), LISTENER_PATTERNS),
    );

    expect(offenders).toEqual([]);
  });

  it("does not commit Telegram bot-token-shaped literals in source, tests, or fixtures", () => {
    const scanned = [
      ...listTsFiles(IM_TELEGRAM_SRC_DIR),
      ...listFiles(IM_TELEGRAM_TEST_DIR, (file) => file.endsWith(".ts") || file.endsWith(".json")),
    ];
    const offenders = scanned.flatMap((file) =>
      lineRefs(file, readFileSync(file, "utf8"), [
        { label: "Telegram bot token shaped literal", pattern: TELEGRAM_BOT_TOKEN_SHAPE },
      ]),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps raw Telegram wire/API details inside im-telegram production source", () => {
    const offenders = listFiles(
      PACKAGES_DIR,
      (file) =>
        file.endsWith(".ts") &&
        file.includes("/src/") &&
        !file.startsWith(`${IM_TELEGRAM_SRC_DIR}/`) &&
        // Phase 2 intentionally keeps a Telegram-shaped fake adapter as
        // channel-core's contract test reference; JAC-61 guards new real
        // adapter wire/API details from spreading beyond im-telegram.
        file !== "packages/channel-core/src/fake.ts",
    ).flatMap((file) =>
      lineRefs(file, stripComments(readFileSync(file, "utf8")), RAW_TELEGRAM_BOUNDARY_PATTERNS),
    );

    expect(offenders).toEqual([]);
  });
});
