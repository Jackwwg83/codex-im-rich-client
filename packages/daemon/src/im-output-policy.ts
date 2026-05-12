import type { Target } from "@codex-im/core";

import type { TurnOutputOpenOptions } from "./turn-output.js";

export type ImOutputMode = "normal" | "verbose" | "debug";
export type ImOutputLanguage = "en" | "zh";

export interface ResolveTurnOutputPolicyInput {
  readonly config: unknown;
  readonly target: Target;
  readonly text: string;
}

export function resolveTurnOutputPolicy(
  input: ResolveTurnOutputPolicyInput,
): Required<TurnOutputOpenOptions> {
  const outputMode = imOutputModeFromConfig(input.config);
  const normalMode = outputMode === "normal";
  return {
    suppressAuxiliarySummaries: shouldSuppressAuxiliaryTurnSections(
      input.target,
      input.text,
      outputMode,
    ),
    redactLocalPaths: normalMode,
    suppressCommandLogFiles: normalMode,
    language: isLikelyChineseText(input.text) ? "zh" : "en",
  };
}

export function imOutputModeFromConfig(config: unknown): ImOutputMode {
  if (typeof config !== "object" || config === null) {
    return "normal";
  }
  const im = (config as { im?: unknown }).im;
  if (typeof im !== "object" || im === null) {
    return "normal";
  }
  const output = (im as { output?: unknown }).output;
  if (typeof output !== "object" || output === null) {
    return "normal";
  }
  const mode = (output as { mode?: unknown }).mode;
  return mode === "verbose" || mode === "debug" ? mode : "normal";
}

export function isLikelyChineseText(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

export function shouldSuppressAuxiliaryTurnSections(
  target: Target,
  text: string,
  outputMode: ImOutputMode = "normal",
): boolean {
  return (
    outputMode === "normal" ||
    (target.platform === "slack" && /^\s*(reply|respond)\s+exactly\b/i.test(text))
  );
}

export function redactLocalPathsForNormalIm(text: string): string {
  return text
    .replace(/\/Users\/[^/\s]+\/projects\/([A-Za-z0-9._-]+)/gu, "<project:$1>")
    .replace(/\/Users\/[^/\s]+/gu, "<home>");
}

export function codexWorkingMessage(language: ImOutputLanguage): string {
  return language === "zh" ? "Codex 正在处理..." : "Codex is working...";
}

export function codexTurnCompletedMessage(language: ImOutputLanguage): string {
  return language === "zh" ? "Codex 已完成。" : "Codex turn completed.";
}

export function codexTurnFailedMessage(language: ImOutputLanguage): string {
  return language === "zh" ? "Codex 执行失败。" : "Codex turn failed.";
}

export function codexTurnInterruptedMessage(language: ImOutputLanguage): string {
  return language === "zh" ? "Codex 已停止。" : "Codex turn interrupted.";
}
