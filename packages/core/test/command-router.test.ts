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
      "threads",
      "use",
      "switch",
      "alias",
      "fork",
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

  it("parses explicit Computer Use commands without touching normal prompts", () => {
    expect(routeInboundCommand("/cu open Chrome")).toEqual({
      kind: "computer_use",
      action: "start",
      task: "open Chrome",
      rawText: "/cu open Chrome",
    });
    expect(routeInboundCommand("/computer-use click button")).toEqual({
      kind: "computer_use",
      action: "start",
      task: "click button",
      rawText: "/computer-use click button",
    });

    expect(routeInboundCommand("open Chrome")).toEqual({
      kind: "prompt",
      text: "open Chrome",
      attachments: [],
    });
    expect(routeInboundCommand("open Chrome and click the login button")).toEqual({
      kind: "prompt",
      text: "open Chrome and click the login button",
      attachments: [],
    });
  });

  it("parses /cu status and rejects empty Computer Use commands", () => {
    expect(routeInboundCommand("/cu status")).toEqual({
      kind: "computer_use",
      action: "status",
      rawText: "/cu status",
    });
    expect(routeInboundCommand("/computer-use")).toEqual({
      kind: "rejected",
      reason: "computer_use_task_required",
      message: "Usage: /cu <task> or /cu status",
      rawText: "/computer-use",
    });
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
