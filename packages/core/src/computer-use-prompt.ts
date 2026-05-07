import type { ComputerUseCommandResult } from "./computer-use-command.js";
import type { ComputerUsePolicyAllowDecision } from "./computer-use-policy.js";
import { redact } from "./redact.js";

export type ComputerUseStartIntent = Extract<
  ComputerUseCommandResult,
  { readonly action: "start" }
>;

export type ComputerUsePromptEnvelope = {
  readonly kind: "computer_use_prompt";
  readonly app: string;
  readonly task: string;
  readonly requiresApproval: boolean;
  readonly approvalReasons: readonly string[];
  readonly prompt: string;
};

export function wrapComputerUsePrompt(
  intent: ComputerUseStartIntent,
  policyDecision: ComputerUsePolicyAllowDecision,
): ComputerUsePromptEnvelope {
  const task = redact(intent.task).trim();
  const app = redact(policyDecision.app).trim();
  const approvalReasons = Object.freeze([...policyDecision.approvalReasons]);
  const prompt = [
    "Computer Use was explicitly requested with /cu.",
    `Allowed app: ${app}.`,
    `Task: ${task}.`,
    "Use Codex App Computer Use explicitly via @Computer or the allowed app mention if that surface is available.",
    "",
    "Rules:",
    "- Operate only inside the allowed app.",
    "- Do not operate through shell commands, terminal automation, or Codex UI automation.",
    "- Do not open, inspect, or control denied apps or system security settings.",
    "- Do not submit credentials, passwords, tokens, payments, purchases, transfers, deletes, posts, comments, or production config changes.",
    "- Stop before any sensitive step and request approval instead of continuing.",
    "- If the requested action cannot be completed safely inside the allowed app, stop and report the blocker.",
  ].join("\n");

  return Object.freeze({
    kind: "computer_use_prompt" as const,
    app,
    task,
    requiresApproval: policyDecision.requiresApproval,
    approvalReasons,
    prompt,
  });
}
