import { describe, expect, it } from "vitest";
import {
  diff,
  extractDocsCommands,
  extractHelpCommands,
  extractRouterCommands,
  main,
} from "./check-help-docs-alignment.mjs";

const DAEMON_FIXTURE = `
async #routeHelpCommand(inbound) {
  await this.#editInboundMessage(
    inbound.messageRef,
    [
      "Commands:",
      "Send any non-command message as a Codex prompt for the current thread.",
      "/start - Show these commands.",
      "/projects - List Codex projects available to this IM chat.",
      "/use <project> - Select a project by number or name.",
      "/rename <title> - Rename current thread.",
      "/archive - Archive current thread.",
      "/unarchive - Reopen an archived thread.",
      "/cu (explicit) - Bounded Computer Use; see commands.md for the accepted scope.",
    ].join("\\n"),
  );
}
`;

const COMMANDS_MD_FIXTURE = `
| Command | Use |
|---|---|
| \`/projects\` | List Codex projects available to this IM chat. |
| \`/cwds\` | Technical alias for /projects. |
| \`/use <number-or-name>\` | Select a project. |
| \`/rename <title>\` | Rename current thread. |
| \`/archive\` | Archive. |
| \`/unarchive\` | Reopen. |
| \`/cu status\` | Bounded Computer Use. |
`;

const ROUTER_FIXTURE = `
export const COMMAND_ROUTER_COMMANDS = Object.freeze([
  "start",
  "help",
  "projects",
  "cwds",
  "use",
  "rename",
  "archive",
  "unarchive",
] as const);
`;

describe("check-help-docs-alignment", () => {
  it("extracts /help commands from a daemon snippet", () => {
    expect(extractHelpCommands(DAEMON_FIXTURE)).toEqual(
      new Set(["start", "projects", "use", "rename", "archive", "unarchive", "cu"]),
    );
  });

  it("extracts commands.md table commands", () => {
    expect(extractDocsCommands(COMMANDS_MD_FIXTURE)).toEqual(
      new Set(["projects", "cwds", "use", "rename", "archive", "unarchive", "cu"]),
    );
  });

  it("extracts COMMAND_ROUTER_COMMANDS array entries", () => {
    expect(extractRouterCommands(ROUTER_FIXTURE)).toEqual(
      new Set(["start", "help", "projects", "cwds", "use", "rename", "archive", "unarchive"]),
    );
  });

  it("reports zero errors when /help, commands.md, and the router agree", () => {
    const router = extractRouterCommands(ROUTER_FIXTURE);
    const help = extractHelpCommands(DAEMON_FIXTURE);
    const docs = extractDocsCommands(COMMANDS_MD_FIXTURE);
    expect(diff({ router, help, docs })).toEqual([]);
  });

  it("flags a router command missing from /help", () => {
    const router = new Set(["projects", "rename"]);
    const help = new Set(["projects"]);
    const docs = new Set(["projects", "rename"]);
    const errors = diff({ router, help, docs });
    expect(errors).toContain('router command "/rename" not in /help output');
  });

  it("flags a router command missing from commands.md", () => {
    const router = new Set(["projects", "rename"]);
    const help = new Set(["projects", "rename"]);
    const docs = new Set(["projects"]);
    const errors = diff({ router, help, docs });
    expect(errors).toContain('router command "/rename" not in docs/user/commands.md');
  });

  it("flags an /help advertisement that is not in the router or the NOT_IN_ROUTER allowlist", () => {
    const router = new Set(["projects"]);
    const help = new Set(["projects", "phantom"]);
    const docs = new Set(["projects"]);
    const errors = diff({ router, help, docs });
    expect(errors).toContain(
      '/help advertises "/phantom" but command-router does not recognise it',
    );
  });

  it("agrees with the real repo state (regression guard)", () => {
    expect(main()).toBe(0);
  });
});
