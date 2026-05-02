import { describe, expect, it } from "vitest";
import {
  COMMAND_ROUTER_COMMANDS,
  type CommandRouterCommandName,
  routeInboundCommand,
} from "../src/command-router.js";

describe("CommandRouter routeInboundCommand (T12 / D26)", () => {
  it("parses the Phase 3 slash commands with args", () => {
    const expected: CommandRouterCommandName[] = [
      "help",
      "projects",
      "new",
      "use",
      "status",
      "stop",
    ];
    expect(COMMAND_ROUTER_COMMANDS).toEqual(expected);

    for (const name of expected) {
      expect(routeInboundCommand(`/${name} alpha beta`)).toEqual({
        kind: "command",
        name,
        args: ["alpha", "beta"],
        rawText: `/${name} alpha beta`,
      });
    }
  });

  it("routes plain text to a prompt with attachments preserved", () => {
    const attachment = {
      filename: "notes.txt",
      contentType: "text/plain",
      bytes: new Uint8Array([1, 2, 3]),
    };
    expect(routeInboundCommand("please inspect the repo", { attachments: [attachment] })).toEqual({
      kind: "prompt",
      text: "please inspect the repo",
      attachments: [attachment],
    });
  });

  it("rejects Computer Use commands explicitly in Phase 3", () => {
    for (const text of ["/cu open Chrome", "/computer-use click button"]) {
      expect(routeInboundCommand(text)).toEqual({
        kind: "rejected",
        reason: "computer_use_not_supported",
        message: "Computer Use is not supported in Phase 3",
        rawText: text,
      });
    }
  });

  it("rejects unknown slash commands instead of treating them as prompts", () => {
    expect(routeInboundCommand("/deploy prod")).toEqual({
      kind: "rejected",
      reason: "unknown_command",
      message: "Unknown command: deploy",
      rawText: "/deploy prod",
    });
  });
});
