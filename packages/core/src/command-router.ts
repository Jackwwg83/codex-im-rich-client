export const COMMAND_ROUTER_COMMANDS = Object.freeze([
  "help",
  "projects",
  "new",
  "use",
  "status",
  "stop",
] as const);

export type CommandRouterCommandName = (typeof COMMAND_ROUTER_COMMANDS)[number];

export type CommandRouterAttachment = {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
};

export type RouteInboundCommandOptions = {
  readonly attachments?: readonly CommandRouterAttachment[];
};

export type CommandRouterResult =
  | {
      readonly kind: "command";
      readonly name: CommandRouterCommandName;
      readonly args: readonly string[];
      readonly rawText: string;
    }
  | {
      readonly kind: "prompt";
      readonly text: string;
      readonly attachments: readonly CommandRouterAttachment[];
    }
  | {
      readonly kind: "rejected";
      readonly reason: "computer_use_not_supported" | "unknown_command";
      readonly message: string;
      readonly rawText: string;
    };

const COMMANDS = new Set<string>(COMMAND_ROUTER_COMMANDS);
const COMPUTER_USE_COMMANDS = new Set(["cu", "computer-use"]);

export function routeInboundCommand(
  text: string,
  opts: RouteInboundCommandOptions = {},
): CommandRouterResult {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return { kind: "prompt", text, attachments: opts.attachments ?? [] };
  }

  const [rawCommand = "", ...args] = trimmed.slice(1).split(/\s+/u);
  const command = rawCommand.toLowerCase();
  if (COMPUTER_USE_COMMANDS.has(command)) {
    return {
      kind: "rejected",
      reason: "computer_use_not_supported",
      message: "Computer Use is not supported in Phase 3",
      rawText: text,
    };
  }

  if (!COMMANDS.has(command)) {
    return {
      kind: "rejected",
      reason: "unknown_command",
      message: `Unknown command: ${command}`,
      rawText: text,
    };
  }

  return {
    kind: "command",
    name: command as CommandRouterCommandName,
    args,
    rawText: text,
  };
}
