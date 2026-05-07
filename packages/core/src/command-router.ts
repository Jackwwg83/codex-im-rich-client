import {
  type ComputerUseCommandRejectedResult,
  type ComputerUseCommandResult,
  isComputerUseCommand,
  parseComputerUseCommand,
} from "./computer-use-command.js";

export const COMMAND_ROUTER_COMMANDS = Object.freeze([
  "start",
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
] as const);

export type CommandRouterCommandName = (typeof COMMAND_ROUTER_COMMANDS)[number];

export type CommandRouterAttachment = {
  readonly kind: "image" | "file";
  readonly filename: string;
  readonly contentType: string;
  readonly localPath: string;
  readonly sizeBytes?: number;
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
  | ComputerUseCommandResult
  | {
      readonly kind: "rejected";
      readonly reason: ComputerUseCommandRejectedResult["reason"] | "unknown_command";
      readonly message: string;
      readonly rawText: string;
    };

const COMMANDS = new Set<string>(COMMAND_ROUTER_COMMANDS);

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
  if (isComputerUseCommand(command)) {
    return parseComputerUseCommand(args, text);
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
