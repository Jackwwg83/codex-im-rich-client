import type { Target } from "@codex-im/core";
import { describe, expect, it } from "vitest";

import {
  codexWorkingMessage,
  redactLocalPathsForNormalIm,
  resolveTurnOutputPolicy,
} from "../src/im-output-policy.js";

const telegramTarget = { platform: "telegram", chatId: "chat-1" } as const satisfies Target;
const slackTarget = { platform: "slack", chatId: "chat-1" } as const satisfies Target;

describe("IM output policy", () => {
  it("defaults ordinary turns to normal output", () => {
    expect(resolveTurnOutputPolicy({ config: {}, target: telegramTarget, text: "hello" })).toEqual({
      suppressAuxiliarySummaries: true,
      redactLocalPaths: true,
      suppressCommandLogFiles: true,
      language: "en",
    });
  });

  it("keeps verbose/debug ordinary turn behavior visible", () => {
    expect(
      resolveTurnOutputPolicy({
        config: { im: { output: { mode: "verbose" } } },
        target: telegramTarget,
        text: "hello",
      }),
    ).toMatchObject({
      suppressAuxiliarySummaries: false,
      redactLocalPaths: false,
      suppressCommandLogFiles: false,
      language: "en",
    });
    expect(
      resolveTurnOutputPolicy({
        config: { im: { output: { mode: "debug" } } },
        target: telegramTarget,
        text: "hello",
      }),
    ).toMatchObject({
      suppressAuxiliarySummaries: false,
      redactLocalPaths: false,
      suppressCommandLogFiles: false,
      language: "en",
    });
  });

  it("still suppresses auxiliary sections for Slack exact-output prompts", () => {
    expect(
      resolveTurnOutputPolicy({
        config: { im: { output: { mode: "debug" } } },
        target: slackTarget,
        text: "Reply exactly: OK",
      }),
    ).toMatchObject({
      suppressAuxiliarySummaries: true,
      redactLocalPaths: false,
      suppressCommandLogFiles: false,
    });
  });

  it("selects localized wrapper language from user text", () => {
    expect(
      resolveTurnOutputPolicy({ config: {}, target: telegramTarget, text: "你是谁" }),
    ).toMatchObject({
      language: "zh",
    });
    expect(
      resolveTurnOutputPolicy({ config: {}, target: telegramTarget, text: "Who are you?" }),
    ).toMatchObject({
      language: "en",
    });
    expect(codexWorkingMessage("zh")).toBe("Codex 正在处理...");
    expect(codexWorkingMessage("en")).toBe("Codex is working...");
  });

  it("redacts local paths for normal IM output", () => {
    expect(
      redactLocalPathsForNormalIm(
        "cwd /Users/example/projects/codex-im-rich-client and home /Users/example/.codex",
      ),
    ).toBe("cwd <project:codex-im-rich-client> and home <home>/.codex");
  });
});
