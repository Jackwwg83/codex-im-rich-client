import type { DynamicToolCallParams } from "@codex-im/protocol";
import { describe, expect, it } from "vitest";
import { MacChromeComputerUseProvider } from "../src/mac-chrome-computer-use-provider.js";

const PARAMS: DynamicToolCallParams = {
  threadId: "thread-cu",
  turnId: "turn-cu",
  callId: "call-cu",
  namespace: "codex_im.computer_use",
  tool: "operate",
  arguments: {
    app: "Google Chrome",
    action: "observe",
    step: "Read the current tab title",
  },
};

describe("MacChromeComputerUseProvider", () => {
  it("executes a bounded observe action through the injected AppleScript executor", async () => {
    const scripts: string[] = [];
    const provider = new MacChromeComputerUseProvider({
      execAppleScript: async (script) => {
        scripts.push(script);
        return { stdout: "Codex IM Test Page\nfile:///tmp/codex-im-test.html\n", stderr: "" };
      },
    });

    const result = await provider.execute({ app: "Google Chrome", params: PARAMS });

    expect(result.success).toBe(true);
    expect(result.contentItems).toEqual([
      {
        type: "inputText",
        text: [
          "Computer Use provider action completed.",
          "app: Google Chrome",
          "operation: observe",
          "title: Codex IM Test Page",
          "url: file:///tmp/codex-im-test.html",
        ].join("\n"),
      },
    ]);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('tell application "Google Chrome"');
    expect(scripts[0]).toContain("active tab");
  });

  it("fails closed for unsupported apps before executing AppleScript", async () => {
    const provider = new MacChromeComputerUseProvider({
      execAppleScript: async () => {
        throw new Error("should not execute");
      },
    });

    await expect(
      provider.execute({ app: "Safari", params: { ...PARAMS, arguments: { action: "observe" } } }),
    ).resolves.toEqual({
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: "Computer Use provider blocked: unsupported app Safari.",
        },
      ],
    });
  });

  it("rejects non-local navigation URLs", async () => {
    const provider = new MacChromeComputerUseProvider({
      execAppleScript: async () => {
        throw new Error("should not execute");
      },
    });

    await expect(
      provider.execute({
        app: "Google Chrome",
        params: {
          ...PARAMS,
          arguments: {
            app: "Google Chrome",
            action: "navigate",
            url: "https://example.com/",
          },
        },
      }),
    ).resolves.toEqual({
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: "Computer Use provider blocked: navigate only allows local file/http URLs.",
        },
      ],
    });
  });
});
