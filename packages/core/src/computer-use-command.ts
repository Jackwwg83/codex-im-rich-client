export const COMPUTER_USE_COMMANDS = Object.freeze(["cu", "computer-use"] as const);

export type ComputerUseCommandName = (typeof COMPUTER_USE_COMMANDS)[number];

export type ComputerUseCommandResult =
  | {
      readonly kind: "computer_use";
      readonly action: "start";
      readonly task: string;
      readonly rawText: string;
    }
  | {
      readonly kind: "computer_use";
      readonly action: "status";
      readonly rawText: string;
    };

export type ComputerUseCommandRejectedResult = {
  readonly kind: "rejected";
  readonly reason: "computer_use_task_required";
  readonly message: string;
  readonly rawText: string;
};

const COMPUTER_USE_COMMAND_SET = new Set<string>(COMPUTER_USE_COMMANDS);

export function isComputerUseCommand(command: string): command is ComputerUseCommandName {
  return COMPUTER_USE_COMMAND_SET.has(command);
}

export function parseComputerUseCommand(
  args: readonly string[],
  rawText: string,
): ComputerUseCommandResult | ComputerUseCommandRejectedResult {
  if (args.length === 1 && args[0]?.toLowerCase() === "status") {
    return { kind: "computer_use", action: "status", rawText };
  }

  const task = args.join(" ").trim();
  if (task.length === 0) {
    return {
      kind: "rejected",
      reason: "computer_use_task_required",
      message: "Usage: /cu <task> or /cu status",
      rawText,
    };
  }

  return { kind: "computer_use", action: "start", task, rawText };
}
