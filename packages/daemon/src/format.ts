// Pure formatting / parsing helpers extracted from daemon.ts (Slice 2 Cut 0).
//
// These functions had no `this` binding and referenced no Daemon instance
// state; they were already module-level free functions inside daemon.ts.
// Extracting them shrinks daemon.ts by ~1,290 lines without any behavior
// change. They are exercised indirectly through daemon.test.ts and
// turn-output.test.ts; no behavior is modified by this move.

import { randomBytes } from "node:crypto";
import { basename, extname } from "node:path";
import type { CodexRichEvent } from "@codex-im/codex-runtime";
import { type SecurityPolicySender, type Target, redact } from "@codex-im/core";
import type { CallbackTokenAction } from "@codex-im/storage-sqlite";

import type {
  DaemonInboundAttachment,
  DaemonMaterializedInboundAttachment,
  DaemonMessageRef,
  DaemonMessageRefKind,
  DaemonMessageRefTextUpdateMode,
  DaemonTextInput,
  DaemonTurnOutputFile,
  DaemonTurnOutputState,
  DaemonUserInput,
} from "./daemon.js";

export const CALLBACK_TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const MAX_IM_TEXT_CHARS = 3_800;
export const MAX_IM_TEXT_CHUNKS = 6;
export const MAX_IM_TEXT_BUFFER_CHARS = MAX_IM_TEXT_CHARS * MAX_IM_TEXT_CHUNKS;
export const MAX_INLINE_COMMAND_OUTPUT_CHARS = 240;
export const MAX_GENERATED_ATTACHMENT_TEXT_CHARS = 200_000;
export const RAW_CWD_SELECTOR_RE = /(?:^~(?:\/|$)|\/|(?:^|\/)\.\.(?:\/|$)|\$|\s)/u;
export type ImOutputMode = "normal" | "verbose" | "debug";
export type ImOutputLanguage = "en" | "zh";

export function generateRawCallbackToken(): string {
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CALLBACK_TOKEN_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.slice(0, 16);
}

export function textInput(text: string): DaemonTextInput[] {
  return [textInputItem(text)];
}

export function textInputItem(text: string): DaemonTextInput {
  return { type: "text", text, text_elements: [] };
}

export function promptInput(
  text: string,
  attachments: readonly DaemonMaterializedInboundAttachment[] = [],
): DaemonUserInput[] {
  if (attachments.length === 0) {
    return textInput(text);
  }
  const fileAttachments = attachments.filter((attachment) => attachment.kind === "file");
  const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
  const textWithFiles = promptTextWithFileAttachments(text, fileAttachments, imageAttachments);
  const input: DaemonUserInput[] = [];
  if (textWithFiles.length > 0) {
    input.push(textInputItem(textWithFiles));
  }
  for (const attachment of imageAttachments) {
    input.push({ type: "localImage", path: attachment.localPath });
  }
  return input.length === 0 ? textInput("Please inspect the attached file(s).") : input;
}

export function promptTextWithFileAttachments(
  text: string,
  fileAttachments: readonly DaemonMaterializedInboundAttachment[],
  imageAttachments: readonly DaemonMaterializedInboundAttachment[],
): string {
  const trimmed = text.trim();
  const sections: string[] = [];
  if (trimmed.length > 0) {
    sections.push(text);
  } else if (imageAttachments.length > 0 && fileAttachments.length === 0) {
    sections.push("Please inspect the attached image(s).");
  }
  if (fileAttachments.length > 0) {
    sections.push(
      [
        "Attached file(s) saved locally for Codex:",
        ...fileAttachments.map((attachment) => {
          const size = attachment.sizeBytes === undefined ? "" : `, ${attachment.sizeBytes} bytes`;
          return `- ${attachment.filename} (${attachment.contentType}${size}): ${attachment.localPath}`;
        }),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

export function turnOutputKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`;
}

export function truncateImText(text: string): string {
  if (text.length <= MAX_IM_TEXT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_IM_TEXT_CHARS - 24)}\n\n[truncated for IM]`;
}

export function appendImText(base: string, delta: string): string {
  const next = `${base}${delta}`;
  if (next.length <= MAX_IM_TEXT_BUFFER_CHARS) {
    return next;
  }
  return `${next.slice(0, MAX_IM_TEXT_BUFFER_CHARS - 24)}\n\n[truncated for IM]`;
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

export function outputStatusSummaries(state: DaemonTurnOutputState): readonly string[] {
  return state.suppressAuxiliarySummaries ? [] : state.statusSummaries;
}

export function outputItemSummaries(state: DaemonTurnOutputState): readonly string[] {
  return state.suppressAuxiliarySummaries ? [] : state.itemSummaries;
}

export function turnOutputBodyWithSections(
  text: string,
  statusSummaries: readonly string[],
  itemSummaries: readonly string[],
): string {
  const sections = [text.length === 0 ? "Codex is working..." : text];
  if (statusSummaries.length > 0) {
    sections.push(`Codex status:\n${statusSummaries.map((summary) => `- ${summary}`).join("\n")}`);
  }
  if (itemSummaries.length > 0) {
    sections.push(`Codex items:\n${itemSummaries.map((summary) => `- ${summary}`).join("\n")}`);
  }
  return sections.join("\n\n");
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

export function splitImText(text: string): readonly string[] {
  if (text.length <= MAX_IM_TEXT_CHARS) {
    return [text];
  }
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length && chunks.length < MAX_IM_TEXT_CHUNKS) {
    const prefix = chunks.length === 0 ? "" : "[continued]\n";
    const limit = MAX_IM_TEXT_CHARS - prefix.length;
    const lastAllowedChunk = chunks.length === MAX_IM_TEXT_CHUNKS - 1;
    let chunk = text.slice(offset, offset + limit);
    offset += chunk.length;
    if (lastAllowedChunk && offset < text.length) {
      const marker = "\n\n[truncated for IM]";
      chunk = `${chunk.slice(0, Math.max(0, limit - marker.length))}${marker}`;
      offset = text.length;
    }
    chunks.push(`${prefix}${chunk}`);
  }
  return chunks.length === 0 ? [""] : chunks;
}

export function readStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

export function readBooleanField(value: unknown, key: string): boolean | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "boolean" ? field : undefined;
}

export function readNumberField(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

export function readNumberLikeField(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  if (typeof field === "number" && Number.isFinite(field)) {
    return field;
  }
  if (typeof field === "bigint") {
    const numberValue = Number(field);
    return Number.isSafeInteger(numberValue) ? numberValue : undefined;
  }
  return undefined;
}

export function readArrayField(value: unknown, key: string): unknown[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const field = (value as Record<string, unknown>)[key];
  return Array.isArray(field) ? field : [];
}

export function formatModelList(value: unknown, currentModel: string | undefined): string {
  const models = readArrayField(value, "data").map(readRecord).filter(isDefined).slice(0, 20);
  if (models.length === 0) {
    return "Models:\nNo models returned.";
  }
  return [
    "Models:",
    ...models.map((model) => {
      const display =
        readStringField(model, "displayName") ??
        readStringField(model, "model") ??
        readStringField(model, "id") ??
        "unknown";
      const modelId = readStringField(model, "model") ?? readStringField(model, "id");
      const isDefault = readBooleanField(model, "isDefault") === true;
      const hidden = readBooleanField(model, "hidden") === true;
      const current =
        currentModel !== undefined && (modelId === currentModel || display === currentModel);
      const suffix = [
        current ? "current cwd default" : undefined,
        isDefault ? "default" : undefined,
        hidden ? "hidden" : undefined,
      ]
        .filter(isDefined)
        .join(", ");
      return `${current ? "*" : " "} ${display}${
        modelId !== undefined && modelId !== display ? ` (${modelId})` : ""
      }${suffix.length === 0 ? "" : ` - ${suffix}`}`;
    }),
  ].join("\n");
}

export function selectModelIdentifier(value: unknown, selector: string): string | undefined {
  const wanted = selector.toLowerCase();
  const models = readArrayField(value, "data").map(readRecord).filter(isDefined);
  for (const model of models) {
    const id = readStringField(model, "id");
    const modelId = readStringField(model, "model");
    const displayName = readStringField(model, "displayName");
    if (
      id?.toLowerCase() === wanted ||
      modelId?.toLowerCase() === wanted ||
      displayName?.toLowerCase() === wanted
    ) {
      return modelId ?? id ?? displayName;
    }
  }
  return undefined;
}

export function formatModelProviderCapabilities(value: unknown): string {
  return [
    `namespace tools ${yesNo(readBooleanField(value, "namespaceTools"))}`,
    `image generation ${yesNo(readBooleanField(value, "imageGeneration"))}`,
    `web search ${yesNo(readBooleanField(value, "webSearch"))}`,
  ].join(", ");
}

export function formatUsage(value: unknown): string {
  const byLimit = readRecord(readRecord(value)?.rateLimitsByLimitId);
  const snapshots =
    byLimit === undefined
      ? [readRecord(readRecord(value)?.rateLimits)].filter(isDefined)
      : Object.values(byLimit).map(readRecord).filter(isDefined);
  if (snapshots.length === 0) {
    return "Usage:\nNo rate-limit data returned.";
  }
  return [
    "Usage:",
    ...snapshots.slice(0, 8).map((snapshot) => {
      const name =
        readStringField(snapshot, "limitName") ?? readStringField(snapshot, "limitId") ?? "default";
      const primary = formatRateLimitWindow(readRecord(snapshot.primary));
      const secondary = formatRateLimitWindow(readRecord(snapshot.secondary));
      const credits = formatCredits(readRecord(snapshot.credits));
      const reached = readStringField(snapshot, "rateLimitReachedType");
      return `- ${name}: primary ${primary}; secondary ${secondary}; credits ${credits}${
        reached === undefined ? "" : `; limit ${reached}`
      }`;
    }),
  ].join("\n");
}

export function formatRateLimitWindow(value: Record<string, unknown> | undefined): string {
  if (value === undefined) {
    return "unknown";
  }
  const usedPercent = readNumberField(value, "usedPercent");
  const duration = readNumberField(value, "windowDurationMins");
  return `${usedPercent === undefined ? "unknown" : `${Math.round(usedPercent)}%`}${
    duration === undefined ? "" : `/${duration}m`
  }`;
}

export function formatCredits(value: Record<string, unknown> | undefined): string {
  if (value === undefined) {
    return "unknown";
  }
  if (readBooleanField(value, "unlimited") === true) {
    return "unlimited";
  }
  if (readBooleanField(value, "hasCredits") === false) {
    return "depleted";
  }
  return "available";
}

export function formatSkillsList(value: unknown): string {
  const entries = readArrayField(value, "data").map(readRecord).filter(isDefined);
  const skills = entries
    .flatMap((entry) => readArrayField(entry, "skills"))
    .map(readRecord)
    .filter(isDefined);
  if (skills.length === 0) {
    return "Skills:\nNo skills returned.";
  }
  return [
    "Skills:",
    ...skills.slice(0, 20).map((skill) => {
      const enabled = readBooleanField(skill, "enabled") === false ? "disabled" : "enabled";
      const name = readStringField(skill, "name") ?? "unknown";
      const desc =
        readStringField(skill, "shortDescription") ?? readStringField(skill, "description") ?? "";
      return `- ${name} (${enabled})${desc.length === 0 ? "" : ` - ${truncateItemSummary(desc)}`}`;
    }),
  ].join("\n");
}

export function formatPluginList(value: unknown): string {
  const marketplaces = readArrayField(value, "marketplaces").map(readRecord).filter(isDefined);
  const plugins = marketplaces
    .flatMap((marketplace) => readArrayField(marketplace, "plugins"))
    .map(readRecord)
    .filter(isDefined);
  if (plugins.length === 0) {
    return "Plugins:\nNo plugins returned.";
  }
  return [
    "Plugins:",
    ...plugins.slice(0, 20).map((plugin) => {
      const name = readStringField(plugin, "name") ?? readStringField(plugin, "id") ?? "unknown";
      const flags = [
        readBooleanField(plugin, "installed") === true ? "installed" : "not installed",
        readBooleanField(plugin, "enabled") === true ? "enabled" : "disabled",
      ].join(", ");
      return `- ${name} (${flags})`;
    }),
  ].join("\n");
}

export function formatAppsList(value: unknown): string {
  const apps = readArrayField(value, "data").map(readRecord).filter(isDefined);
  if (apps.length === 0) {
    return "Apps:\nNo apps returned.";
  }
  return [
    "Apps:",
    ...apps.slice(0, 20).map((app) => {
      const name = readStringField(app, "name") ?? readStringField(app, "id") ?? "unknown";
      const flags = [
        readBooleanField(app, "isAccessible") === true ? "accessible" : "not accessible",
        readBooleanField(app, "isEnabled") === true ? "enabled" : "disabled",
      ].join(", ");
      return `- ${name} (${flags})`;
    }),
  ].join("\n");
}

export function formatMcpStatus(value: unknown): string {
  const lines = ["MCP servers:", ...formatMcpToolLines(value)];
  return lines.length === 1 ? "MCP servers:\nNo MCP servers returned." : lines.join("\n");
}

export function formatMcpToolLines(value: unknown): string[] {
  const servers = readArrayField(value, "data").map(readRecord).filter(isDefined);
  if (servers.length === 0) {
    return ["MCP: no servers returned"];
  }
  return servers.slice(0, 20).map((server) => {
    const name = readStringField(server, "name") ?? "unknown";
    const auth = readStringField(server, "authStatus") ?? "unknown";
    const tools = readRecord(server.tools);
    const toolNames = tools === undefined ? [] : Object.keys(tools).sort();
    const sample =
      toolNames.length === 0
        ? ""
        : ` - ${toolNames.slice(0, 4).join(", ")}${toolNames.length > 4 ? " ..." : ""}`;
    return `- ${name}: auth ${auth}, tools ${toolNames.length}${sample}`;
  });
}

export function summarizeCodexStatusEvent(
  event: Extract<CodexRichEvent, { type: "unknown" }>,
): string | undefined {
  const params = readRecord(event.params);
  switch (event.method) {
    case "thread/tokenUsage/updated":
      return summarizeTokenUsageStatus(params);
    case "thread/compacted":
      return "thread compacted";
    case "thread/status/changed":
      return summarizeThreadStatus(params);
    case "model/rerouted":
      return summarizeModelReroute(params);
    case "model/verification":
      return summarizeModelVerification(params);
    case "mcpServer/startupStatus/updated":
      return summarizeMcpStartupStatus(params);
    case "mcpServer/oauthLogin/completed":
      return summarizeMcpOauthStatus(params);
    case "account/rateLimits/updated":
      return "usage updated";
    case "remoteControl/status/changed":
      return summarizeRemoteControlStatus(params);
    case "configWarning":
      return summarizeConfigWarningStatus(params);
    case "item/mcpToolCall/progress":
      return summarizeMcpToolProgressStatus(params);
    case "item/commandExecution/terminalInteraction":
      return "command interaction: terminal input requested";
    case "item/autoApprovalReview/started":
      return summarizeAutoApprovalReviewStatus(params, "started");
    case "item/autoApprovalReview/completed":
      return summarizeAutoApprovalReviewStatus(params, "completed");
    case "guardianWarning":
      return summarizeGuardianWarningStatus(params);
    case "deprecationNotice":
      return summarizeDeprecationStatus(params);
    case "hook/started":
      return summarizeHookStatus(params, "started");
    case "hook/completed":
      return summarizeHookStatus(params, "completed");
    case "turn/plan/updated":
      return summarizePlanStatus(params);
    case "turn/diff/updated":
      return summarizeDiffStatus(params);
    case "thread/name/updated":
      return summarizeThreadNameStatus(params);
    case "thread/goal/updated":
      return summarizeGoalStatus(params);
    case "thread/goal/cleared":
      return "goal cleared";
    case "skills/changed":
      return "skills changed";
    case "app/list/updated":
      return "apps updated";
    default:
      return undefined;
  }
}

export function isGlobalRuntimeStatusMethod(method: string): boolean {
  return (
    method === "mcpServer/startupStatus/updated" ||
    method === "mcpServer/oauthLogin/completed" ||
    method === "account/rateLimits/updated" ||
    method === "remoteControl/status/changed" ||
    method === "configWarning" ||
    method === "deprecationNotice" ||
    method === "skills/changed" ||
    method === "app/list/updated"
  );
}

export function summarizeTokenUsageStatus(params: Record<string, unknown> | undefined): string {
  const tokenUsage = readRecord(params?.tokenUsage);
  const totalTokens = readNumberField(readRecord(tokenUsage?.total), "totalTokens");
  const lastTokens = readNumberField(readRecord(tokenUsage?.last), "totalTokens");
  const contextWindow = readNumberField(tokenUsage, "modelContextWindow");
  const parts = [
    totalTokens === undefined ? undefined : `total ${formatInteger(totalTokens)}`,
    lastTokens === undefined ? undefined : `last ${formatInteger(lastTokens)}`,
    totalTokens === undefined || contextWindow === undefined || contextWindow <= 0
      ? undefined
      : `context ${Math.round((totalTokens / contextWindow) * 100)}%`,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? "token usage updated" : `token usage: ${parts.join(", ")}`;
}

export function summarizeThreadStatus(params: Record<string, unknown> | undefined): string {
  const statusType = readStringField(readRecord(params?.status), "type") ?? "unknown";
  return `thread status: ${safeStatusText(statusType)}`;
}

export function summarizeModelReroute(params: Record<string, unknown> | undefined): string {
  const fromModel = safeStatusText(readStringField(params, "fromModel") ?? "unknown");
  const toModel = safeStatusText(readStringField(params, "toModel") ?? "unknown");
  const reason = readStringField(params, "reason");
  return `model rerouted: ${fromModel} -> ${toModel}${
    reason === undefined ? "" : ` (${safeStatusText(reason)})`
  }`;
}

export function summarizeModelVerification(params: Record<string, unknown> | undefined): string {
  const verifications = readArrayField(params, "verifications");
  return `model verification: ${verifications.length} result${verifications.length === 1 ? "" : "s"}`;
}

export function summarizeMcpStartupStatus(params: Record<string, unknown> | undefined): string {
  const name = safeStatusText(readStringField(params, "name") ?? "unknown");
  const status = safeStatusText(readStringField(params, "status") ?? "unknown");
  const error = readStringField(params, "error");
  return `MCP ${name}: ${status}${
    status === "failed" && error !== undefined ? ` (${safeStatusText(error)})` : ""
  }`;
}

export function summarizeMcpOauthStatus(params: Record<string, unknown> | undefined): string {
  const name = safeStatusText(readStringField(params, "name") ?? "unknown");
  const success = readBooleanField(params, "success");
  const error = readStringField(params, "error");
  return `MCP ${name} OAuth: ${
    success === true
      ? "connected"
      : `failed${error === undefined ? "" : ` (${safeStatusText(error)})`}`
  }`;
}

export function summarizeRemoteControlStatus(params: Record<string, unknown> | undefined): string {
  return `remote control: ${safeStatusText(readStringField(params, "status") ?? "unknown")}`;
}

export function summarizeConfigWarningStatus(params: Record<string, unknown> | undefined): string {
  const message = readNoticeMessage(params);
  return message === undefined ? "config warning" : `config warning: ${message}`;
}

export function summarizeMcpToolProgressStatus(
  params: Record<string, unknown> | undefined,
): string {
  const message = readNoticeMessage(params);
  return message === undefined ? "MCP progress" : `MCP progress: ${message}`;
}

export function summarizeGuardianWarningStatus(
  params: Record<string, unknown> | undefined,
): string {
  const message = readNoticeMessage(params);
  return message === undefined ? "guardian warning" : `guardian warning: ${message}`;
}

export function summarizeDeprecationStatus(params: Record<string, unknown> | undefined): string {
  const summary =
    readStringField(params, "summary") ??
    readStringField(params, "message") ??
    readStringField(params, "details");
  return summary === undefined ? "deprecation notice" : `deprecation: ${safeStatusText(summary)}`;
}

export function summarizeHookStatus(
  params: Record<string, unknown> | undefined,
  phase: "started" | "completed",
): string {
  const run = readRecord(params?.run);
  const eventName =
    readStringField(run, "eventName") ?? readStringField(params, "eventName") ?? "unknown";
  if (phase === "started") {
    return `hook started: ${safeStatusText(eventName)}`;
  }

  const status = readStringField(run, "status") ?? readStringField(params, "status");
  const duration =
    readNumberLikeField(run, "durationMs") ?? readNumberLikeField(params, "durationMs");
  const parts = [
    status === undefined ? undefined : safeStatusText(status),
    duration === undefined ? undefined : `${formatInteger(duration)}ms`,
  ].filter((part): part is string => part !== undefined);
  return `hook completed: ${safeStatusText(eventName)}${
    parts.length === 0 ? "" : ` (${parts.join(", ")})`
  }`;
}

export function summarizeAutoApprovalReviewStatus(
  params: Record<string, unknown> | undefined,
  phase: "started" | "completed",
): string {
  const action = readRecord(params?.action);
  const review = readRecord(params?.review);
  const actionType = safeStatusText(readStringField(action, "type") ?? "unknown");
  const parts = [
    `status ${safeStatusText(readStringField(review, "status") ?? "unknown")}`,
    readStringField(review, "riskLevel") === undefined
      ? undefined
      : `risk ${safeStatusText(readStringField(review, "riskLevel") ?? "")}`,
    readStringField(review, "userAuthorization") === undefined
      ? undefined
      : `user auth ${safeStatusText(readStringField(review, "userAuthorization") ?? "")}`,
    phase === "completed" && readStringField(params, "decisionSource") !== undefined
      ? `decision source ${safeStatusText(readStringField(params, "decisionSource") ?? "")}`
      : undefined,
  ].filter((part): part is string => part !== undefined);
  return `approval review ${phase}: ${actionType}${parts.length === 0 ? "" : `; ${parts.join("; ")}`}`;
}

export function summarizeCodexRuntimeNotice(
  event: Extract<CodexRichEvent, { type: "warning" | "error" }>,
): string | undefined {
  const raw = readRecord(event.raw);
  const params = readRecord(raw?.params) ?? raw;
  const message = readNoticeMessage(params);
  const code = readNoticeCode(params);
  const label = event.type;
  return `${label}: ${message ?? "received"}${code === undefined ? "" : ` (${code})`}`;
}

export function readNoticeMessage(params: Record<string, unknown> | undefined): string | undefined {
  const error = readRecord(params?.error);
  const message =
    readStringField(params, "message") ??
    readStringField(params, "msg") ??
    readStringField(params, "reason") ??
    readStringField(params, "error") ??
    readStringField(error, "message") ??
    readStringField(error, "reason") ??
    readStringField(params, "detail");
  return message === undefined ? undefined : safeStatusText(message);
}

export function readNoticeCode(params: Record<string, unknown> | undefined): string | undefined {
  const error = readRecord(params?.error);
  const code =
    readStringField(params, "code") ??
    readStringField(error, "code") ??
    readStringField(error, "kind");
  if (code !== undefined) {
    return safeStatusText(code);
  }
  const numericCode = readNumberField(params, "code") ?? readNumberField(error, "code");
  return numericCode === undefined ? undefined : safeStatusText(formatInteger(numericCode));
}

export function summarizePlanStatus(params: Record<string, unknown> | undefined): string {
  const steps = readPlanSteps(params);
  if (steps.length === 0) {
    return "plan updated";
  }

  const completed = countStatus(steps, ["completed", "complete", "done", "success", "succeeded"]);
  const inProgress = countStatus(steps, [
    "in_progress",
    "in-progress",
    "in progress",
    "running",
    "active",
  ]);
  const parts = [
    `${steps.length} ${plural(steps.length, "step", "steps")}`,
    completed > 0 ? `${completed} completed` : undefined,
    inProgress > 0 ? `${inProgress} in progress` : undefined,
  ].filter((part): part is string => part !== undefined);
  return `plan updated: ${parts.join(", ")}`;
}

export function summarizeDiffStatus(params: Record<string, unknown> | undefined): string {
  const files = readDiffFiles(params);
  return files === undefined
    ? "diff updated"
    : `diff updated: ${files} ${plural(files, "file", "files")}`;
}

export function summarizeThreadNameStatus(params: Record<string, unknown> | undefined): string {
  const thread = readRecord(params?.thread);
  const name =
    readStringField(params, "name") ??
    readStringField(params, "title") ??
    readStringField(thread, "name") ??
    readStringField(thread, "title");
  return name === undefined ? "thread renamed" : `thread renamed: ${safeStatusText(name)}`;
}

export function summarizeGoalStatus(params: Record<string, unknown> | undefined): string {
  const goal = readRecord(params?.goal);
  const title =
    readStringField(params, "title") ??
    readStringField(params, "name") ??
    readStringField(params, "text") ??
    readStringField(goal, "title") ??
    readStringField(goal, "name") ??
    readStringField(goal, "text");
  const status = readStringField(params, "status") ?? readStringField(goal, "status");
  if (title !== undefined && status !== undefined) {
    return `goal updated: ${safeStatusText(title)} (${safeStatusText(status)})`;
  }
  if (title !== undefined) {
    return `goal updated: ${safeStatusText(title)}`;
  }
  if (status !== undefined) {
    return `goal updated: ${safeStatusText(status)}`;
  }
  return "goal updated";
}

export function readPlanSteps(
  params: Record<string, unknown> | undefined,
): readonly Record<string, unknown>[] {
  const plan = readRecord(params?.plan);
  const candidates = [params?.plan, plan?.steps, params?.steps];
  for (const candidate of candidates) {
    const array = Array.isArray(candidate) ? candidate : undefined;
    if (array !== undefined) {
      return array.filter(
        (step): step is Record<string, unknown> => readRecord(step) !== undefined,
      );
    }
  }
  return [];
}

export function readDiffFiles(params: Record<string, unknown> | undefined): number | undefined {
  const diff = readRecord(params?.diff);
  const candidates = [
    params?.files,
    params?.changes,
    params?.fileChanges,
    diff?.files,
    diff?.changes,
    diff?.fileChanges,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
  }
  return undefined;
}

export function countStatus(
  steps: readonly Record<string, unknown>[],
  statuses: readonly string[],
): number {
  const normalized = new Set(statuses);
  return steps.filter((step) => {
    const status = readStringField(step, "status");
    return status !== undefined && normalized.has(status.trim().toLowerCase());
  }).length;
}

export function plural(count: number, singular: string, pluralText: string): string {
  return count === 1 ? singular : pluralText;
}

export function safeStatusText(value: string): string {
  return truncateItemSummary(redact(value.replace(/\s+/g, " ").trim()));
}

export function formatInteger(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value));
}

export function yesNo(value: boolean | undefined): string {
  return value === true ? "yes" : value === false ? "no" : "unknown";
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function summarizeCodexItem(raw: unknown): string | undefined {
  const item = readRawItem(raw);
  if (item === undefined) {
    return undefined;
  }
  const type = readStringField(item, "type");
  if (
    type === undefined ||
    type === "userMessage" ||
    type === "agentMessage" ||
    type === "reasoning"
  ) {
    return undefined;
  }

  const status = readStringField(item, "status");
  const detail = summarizeItemDetail(item, type);
  const summary = [type, status].filter((part): part is string => part !== undefined).join(" ");
  return truncateItemSummary(detail === undefined ? summary : `${summary}: ${detail}`);
}

export function readRawItem(raw: unknown): Record<string, unknown> | undefined {
  const rawRecord = readRecord(raw);
  const params = readRecord(rawRecord?.params);
  return readRecord(params?.item);
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function summarizeItemChanges(item: Record<string, unknown>): string | undefined {
  const changes = item.changes;
  if (!Array.isArray(changes)) {
    return undefined;
  }
  const paths = changes
    .map((change) => readStringField(change, "path"))
    .filter((path): path is string => path !== undefined)
    .slice(0, 3);
  if (paths.length === 0) {
    return undefined;
  }
  const suffix = changes.length > paths.length ? ` +${changes.length - paths.length} more` : "";
  return `${paths.join(", ")}${suffix}`;
}

export function summarizeItemDetail(
  item: Record<string, unknown>,
  type: string,
): string | undefined {
  if (type === "fileChange") {
    return summarizeItemChanges(item);
  }
  if (type === "commandExecution") {
    return summarizeCommandExecutionItem(item);
  }
  if (type === "mcpToolCall") {
    return summarizeMcpToolCallItem(item);
  }
  if (type === "dynamicToolCall") {
    return summarizeDynamicToolCallItem(item);
  }
  if (type === "collabAgentToolCall") {
    return readStringField(item, "tool");
  }
  if (type === "webSearch") {
    const query = readStringField(item, "query");
    return query === undefined ? undefined : redact(query);
  }
  if (type === "imageView") {
    return readStringField(item, "path");
  }
  if (type === "imageGeneration") {
    return readStringField(item, "savedPath") ?? readStringField(item, "result");
  }
  if (type === "plan") {
    const text = readStringField(item, "text");
    return text === undefined ? undefined : redact(text.replace(/\s+/g, " ").trim());
  }
  return undefined;
}

export function summarizeDynamicToolCallItem(item: Record<string, unknown>): string | undefined {
  const name = summarizeNamedToolItem(item, "namespace");
  if (name === undefined) {
    return undefined;
  }
  const normalized = name.toLowerCase();
  const isComputerUse = normalized.includes("computer_use") || normalized.includes("computer-use");
  const displayName = isComputerUse ? `Computer Use ${name}` : name;
  return summarizeToolDetails(item, displayName, { computerUse: isComputerUse });
}

export function extractCodexItemFiles(raw: unknown): readonly DaemonTurnOutputFile[] {
  const item = readRawItem(raw);
  if (item === undefined) {
    return [];
  }
  const type = readStringField(item, "type");
  const status = readStringField(item, "status");
  if (type === "imageGeneration") {
    if (status !== undefined && status !== "completed") {
      return [];
    }
    return artifactFileFromPath(readStringField(item, "savedPath"));
  }
  if (type === "imageView") {
    return artifactFileFromPath(readStringField(item, "path"));
  }
  if (type === "commandExecution") {
    if (status === "inProgress") {
      return [];
    }
    return commandOutputFile(item);
  }
  if (type === "fileChange") {
    if (status !== undefined && status !== "completed") {
      return [];
    }
    return fileChangePatchFile(item);
  }
  if (type === "dynamicToolCall") {
    if (status === "inProgress") {
      return [];
    }
    return dynamicToolCallImageFiles(item);
  }
  return [];
}

export function artifactFileFromPath(path: string | undefined): readonly DaemonTurnOutputFile[] {
  if (path === undefined || path.length === 0) {
    return [];
  }
  const filename = basename(path);
  if (filename.length === 0) {
    return [];
  }
  return [
    {
      path,
      filename,
      contentType: contentTypeForPath(path),
      kind: "artifact",
    },
  ];
}

export function commandOutputFile(item: Record<string, unknown>): readonly DaemonTurnOutputFile[] {
  const output = readStringField(item, "aggregatedOutput");
  if (output === undefined || output.trim().length === 0) {
    return [];
  }
  if (inlineCommandOutputPreview(output) !== undefined) {
    return [];
  }
  const id = safeFileToken(readStringField(item, "id") ?? "command");
  return [
    {
      filename: `codex-command-${id}.log`,
      bytes: encodeGeneratedAttachment(output),
      contentType: "text/plain",
      kind: "command_log",
    },
  ];
}

export function fileChangePatchFile(
  item: Record<string, unknown>,
): readonly DaemonTurnOutputFile[] {
  const patch = buildFileChangePatch(item);
  if (patch === undefined) {
    return [];
  }
  const id = safeFileToken(readStringField(item, "id") ?? "filechange");
  return [
    {
      filename: `codex-filechange-${id}.patch`,
      bytes: encodeGeneratedAttachment(patch),
      contentType: "text/x-patch",
      kind: "file_patch",
    },
  ];
}

export function dynamicToolCallImageFiles(
  item: Record<string, unknown>,
): readonly DaemonTurnOutputFile[] {
  const files: DaemonTurnOutputFile[] = [];
  for (const contentItem of readArrayField(item, "contentItems")) {
    const record = readRecord(contentItem);
    if (readStringField(record, "type") !== "inputImage") {
      continue;
    }
    const imageUrl = readStringField(record, "imageUrl");
    if (imageUrl === undefined || !imageUrl.startsWith("/")) {
      continue;
    }
    files.push(...artifactFileFromPath(imageUrl));
  }
  return files;
}

export function buildFileChangePatch(item: Record<string, unknown>): string | undefined {
  const changes = item.changes;
  if (!Array.isArray(changes)) {
    return undefined;
  }
  const sections = changes
    .map((change) => {
      const record = readRecord(change);
      const diff = readStringField(record, "diff");
      if (record === undefined || diff === undefined || diff.length === 0) {
        return undefined;
      }
      const path = readStringField(record, "path") ?? "unknown";
      const kind = readStringField(record, "kind") ?? "change";
      return `# ${kind} ${path}\n${diff.trimEnd()}\n`;
    })
    .filter(isDefined);
  return sections.length === 0 ? undefined : sections.join("\n");
}

export function encodeGeneratedAttachment(text: string): Uint8Array {
  const redacted = redact(text);
  const bounded =
    redacted.length <= MAX_GENERATED_ATTACHMENT_TEXT_CHARS
      ? redacted
      : `${redacted.slice(0, MAX_GENERATED_ATTACHMENT_TEXT_CHARS)}\n\n[truncated for IM attachment]\n`;
  return new TextEncoder().encode(bounded);
}

export function turnOutputFileKey(file: DaemonTurnOutputFile): string {
  return file.path === undefined ? `generated:${file.filename}` : `path:${file.path}`;
}

export function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".txt":
    case ".log":
      return "text/plain";
    case ".json":
      return "application/json";
    case ".patch":
    case ".diff":
      return "text/x-patch";
    default:
      return "application/octet-stream";
  }
}

export function isAppendOnlyTextRef(ref: DaemonMessageRef | undefined): boolean {
  return ref?.kind === "text" && ref.textUpdateMode === "append";
}

export function optionalMessageRefKind(
  value: unknown,
): { readonly kind: DaemonMessageRefKind } | Record<string, never> {
  return value === "inbound" || value === "text" || value === "approval_card" || value === "file"
    ? { kind: value }
    : {};
}

export function optionalMessageRefTextUpdateMode(
  value: unknown,
): { readonly textUpdateMode: DaemonMessageRefTextUpdateMode } | Record<string, never> {
  return value === "edit" || value === "append" ? { textUpdateMode: value } : {};
}

export function summarizeCommandExecutionItem(item: Record<string, unknown>): string | undefined {
  const command = readStringField(item, "command");
  const risk = readStringField(item, "riskLevel") ?? readStringField(item, "risk");
  const exitCode = readNumberField(item, "exitCode");
  const durationMs = readNumberField(item, "durationMs");
  const output = readStringField(item, "aggregatedOutput");
  const parts: string[] = [];
  if (command !== undefined) {
    parts.push(redact(command));
  }
  if (risk !== undefined) {
    parts.push(`risk ${safeStatusText(risk)}`);
  }
  if (exitCode !== undefined) {
    parts.push(`exit ${exitCode}`);
  }
  if (durationMs !== undefined) {
    parts.push(`${durationMs}ms`);
  }
  if (output !== undefined && output.trim().length > 0) {
    parts.push(`output: ${inlineCommandOutputPreview(output) ?? "attached"}`);
  }
  return parts.length === 0 ? undefined : parts.join("; ");
}

export function inlineCommandOutputPreview(output: string): string | undefined {
  const oneLine = redact(output.replace(/\s+/g, " ").trim());
  if (oneLine.length === 0 || oneLine.length > MAX_INLINE_COMMAND_OUTPUT_CHARS) {
    return undefined;
  }
  return oneLine;
}

export function summarizeMcpToolCallItem(item: Record<string, unknown>): string | undefined {
  const name = summarizeNamedToolItem(item, "server");
  return name === undefined ? undefined : summarizeToolDetails(item, name);
}

export function summarizeToolDetails(
  item: Record<string, unknown>,
  name: string,
  opts: { readonly computerUse?: boolean } = {},
): string {
  const parts = [name];
  if (opts.computerUse === true) {
    appendComputerUseDetails(parts, item);
  }
  const success = readBooleanField(item, "success");
  if (success !== undefined) {
    parts.push(`success ${success ? "yes" : "no"}`);
  }
  const durationMs = readNumberField(item, "durationMs");
  if (durationMs !== undefined) {
    parts.push(`${durationMs}ms`);
  }
  const contentItems = readArrayField(item, "contentItems");
  if (contentItems.length > 0) {
    const imageCount = contentItems.filter(
      (contentItem) => readStringField(contentItem, "type") === "inputImage",
    ).length;
    const textCount = contentItems.filter(
      (contentItem) => readStringField(contentItem, "type") === "inputText",
    ).length;
    parts.push(
      `content ${contentItems.length}${textCount > 0 ? ` text ${textCount}` : ""}${
        imageCount > 0 ? ` image ${imageCount}` : ""
      }`,
    );
  }
  const error = readRecord(item.error);
  const result = readRecord(item.result);
  const text =
    readStringField(error, "message") ??
    readStringField(result, "text") ??
    readStringField(result, "content");
  if (text !== undefined && text.trim().length > 0) {
    parts.push(`result: ${truncateItemSummary(redact(text.replace(/\s+/g, " ").trim()))}`);
  } else if (error !== undefined) {
    parts.push("error present");
  } else if (result !== undefined) {
    parts.push("result present");
  }
  return parts.join("; ");
}

export function appendComputerUseDetails(parts: string[], item: Record<string, unknown>): void {
  const computerUse = readRecord(item.computerUse);
  const app = readStringField(item, "app") ?? readStringField(computerUse, "app");
  const step =
    readStringField(item, "step") ??
    readStringField(item, "action") ??
    readStringField(computerUse, "step") ??
    readStringField(computerUse, "action");
  const policy =
    readStringField(item, "policyDecision") ??
    readStringField(item, "policy") ??
    readStringField(computerUse, "policyDecision") ??
    readStringField(computerUse, "policy");
  const blocked =
    readStringField(item, "blockedReason") ??
    readStringField(item, "blocked") ??
    readStringField(computerUse, "blockedReason") ??
    readStringField(computerUse, "blocked");
  const requiresApproval =
    readBooleanField(item, "requiresApproval") ?? readBooleanField(computerUse, "requiresApproval");
  if (app !== undefined) {
    parts.push(`app ${safeStatusText(app)}`);
  }
  if (step !== undefined) {
    parts.push(`step ${safeStatusText(step)}`);
  }
  if (policy !== undefined) {
    parts.push(`policy ${safeStatusText(policy)}`);
  }
  if (blocked !== undefined) {
    parts.push(`blocked ${safeStatusText(blocked)}`);
  }
  if (requiresApproval !== undefined) {
    parts.push(`requires approval ${requiresApproval ? "yes" : "no"}`);
  }
}

export function summarizeNamedToolItem(
  item: Record<string, unknown>,
  namespaceKey: string,
): string | undefined {
  const namespace = readStringField(item, namespaceKey);
  const tool = readStringField(item, "tool");
  if (namespace === undefined) {
    return tool;
  }
  if (tool === undefined) {
    return namespace;
  }
  return `${namespace}.${tool}`;
}

export function parseTextApprovalAction(
  value: string | undefined,
): CallbackTokenAction | undefined {
  switch (value) {
    case "allow":
    case "allow_once":
    case "once":
      return "allow_once";
    case "allow_session":
    case "session":
      return "allow_session";
    case "decline":
    case "deny":
      return "decline";
    case "abort":
      return "abort";
    default:
      return undefined;
  }
}

export function truncateItemSummary(summary: string): string {
  return summary.length <= 240 ? summary : `${summary.slice(0, 217)}...`;
}

export function safeFileToken(value: string): string {
  const token = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return token.length === 0 ? "item" : token.slice(0, 80);
}

export function presence(value: string | undefined): "present" | "absent" {
  return value === undefined || value.length === 0 ? "absent" : "present";
}

export function targetEqual(a: Target, b: Target): boolean {
  return (
    a.platform === b.platform &&
    a.chatId === b.chatId &&
    (a.threadKey ?? null) === (b.threadKey ?? null) &&
    (a.topicId ?? null) === (b.topicId ?? null)
  );
}

export function isRawCwdSelector(value: string): boolean {
  return RAW_CWD_SELECTOR_RE.test(value);
}

export function safeDisplayCwd(cwd: string): string {
  const home = process.env.HOME;
  if (home !== undefined && home.length > 1 && (cwd === home || cwd.startsWith(`${home}/`))) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd.replace(/^\/Users\/[^/]+/u, "~");
}

export function projectDisplayNameFromCwd(cwd: string): string {
  const normalized = cwd.replace(/\/+$/u, "");
  const name = basename(normalized);
  return name.length === 0 ? "workspace" : name;
}

export function targetKey(target: Target): string {
  return JSON.stringify([
    target.platform,
    target.chatId,
    target.threadKey ?? null,
    target.topicId ?? null,
  ]);
}

export function actorKey(target: Target, sender: SecurityPolicySender): string {
  return `${target.platform}:${sender.userId}`;
}

export function firstOversizedInboundAttachment(
  attachments: readonly DaemonInboundAttachment[],
  maxBytes: number,
): DaemonInboundAttachment | undefined {
  return attachments.find(
    (attachment) =>
      attachment.rejectionReason === "too_large" ||
      (attachment.sizeBytes !== undefined &&
        Number.isFinite(attachment.sizeBytes) &&
        attachment.sizeBytes > maxBytes),
  );
}

export function materializedInboundAttachments(
  attachments: readonly DaemonInboundAttachment[],
): DaemonMaterializedInboundAttachment[] {
  return attachments.filter(
    (attachment): attachment is DaemonMaterializedInboundAttachment =>
      attachment.rejectionReason === undefined &&
      typeof attachment.localPath === "string" &&
      attachment.localPath.length > 0,
  );
}

export function inboundAttachmentTooLargeMessage(maxBytes: number): string {
  return `Attachment too large. Maximum supported inbound attachment size is ${maxBytes} bytes.`;
}

export function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function redactMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (metadata === undefined) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    out[key] = typeof value === "string" ? redact(value) : value;
  }
  return out;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function forkFailureMessage(error: unknown): string {
  if (errorMessage(error).includes("no rollout found for thread id")) {
    return "Codex thread is not ready to fork yet. Send any prompt in this thread first, then send /fork again.";
  }
  return "Codex thread failed to fork.";
}

export async function drainShutdown(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

export async function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    await Promise.resolve();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
