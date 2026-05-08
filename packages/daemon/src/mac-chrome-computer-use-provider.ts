import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { ComputerUseProvider, ComputerUseProviderRequest } from "@codex-im/core";
import type { DynamicToolCallResponse } from "@codex-im/protocol";

export type AppleScriptExecResult = {
  readonly stdout: string;
  readonly stderr: string;
};

export type AppleScriptExecutor = (script: string) => Promise<AppleScriptExecResult>;

export interface MacChromeComputerUseProviderOptions {
  readonly execAppleScript?: AppleScriptExecutor;
}

type ComputerUseOperation = "observe" | "navigate" | "click" | "type";

const CHROME_APP = "Google Chrome";
const SECRET_SHAPED_RE =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|xox[abprs]-[A-Za-z0-9-]{10,}|\d{5,}:[A-Za-z0-9_-]{20,})\b/g;

export class MacChromeComputerUseProvider implements ComputerUseProvider {
  readonly #execAppleScript: AppleScriptExecutor;

  constructor(opts: MacChromeComputerUseProviderOptions = {}) {
    this.#execAppleScript = opts.execAppleScript ?? execAppleScript;
  }

  async execute(request: ComputerUseProviderRequest): Promise<DynamicToolCallResponse> {
    if (request.app !== CHROME_APP) {
      return blocked(`unsupported app ${request.app}.`);
    }

    const args = readRecord(request.params.arguments);
    const argApp = readString(args, "app");
    if (argApp !== undefined && argApp !== CHROME_APP) {
      return blocked(`argument app ${argApp} does not match ${CHROME_APP}.`);
    }

    const operation = readOperation(args);
    if (operation === undefined) {
      return blocked("unknown action. Supported actions: observe, navigate, click, type.");
    }

    try {
      switch (operation) {
        case "observe":
          return await this.#observe();
        case "navigate":
          return await this.#navigate(args);
        case "click":
          return await this.#click(args);
        case "type":
          return await this.#type(args);
      }
    } catch {
      return blocked("provider execution failed.");
    }
  }

  async #observe(): Promise<DynamicToolCallResponse> {
    const result = await this.#execAppleScript(chromeObserveScript());
    const [title = "", url = ""] = result.stdout.trimEnd().split("\n");
    return textResponse(
      [
        "Computer Use provider action completed.",
        `app: ${CHROME_APP}`,
        "operation: observe",
        `title: ${redact(title)}`,
        `url: ${redact(url)}`,
      ].join("\n"),
    );
  }

  async #navigate(args: Record<string, unknown>): Promise<DynamicToolCallResponse> {
    const url = readString(args, "url");
    if (url === undefined) {
      return blocked("navigate requires url.");
    }
    if (!isAllowedLocalUrl(url)) {
      return blocked("navigate only allows local file/http URLs.");
    }
    await this.#execAppleScript(chromeNavigateScript(url));
    await delay(500);
    return textResponse(
      [
        "Computer Use provider action completed.",
        `app: ${CHROME_APP}`,
        "operation: navigate",
        `url: ${redact(url)}`,
      ].join("\n"),
    );
  }

  async #click(args: Record<string, unknown>): Promise<DynamicToolCallResponse> {
    const selector = readString(args, "selector");
    if (selector === undefined) {
      return blocked("click requires selector.");
    }
    const result = await this.#execAppleScript(chromeJavaScriptScript(clickJavaScript(selector)));
    return textResponse(
      [
        "Computer Use provider action completed.",
        `app: ${CHROME_APP}`,
        "operation: click",
        `selector: ${redact(selector)}`,
        `result: ${redact(result.stdout.trim())}`,
      ].join("\n"),
    );
  }

  async #type(args: Record<string, unknown>): Promise<DynamicToolCallResponse> {
    const selector = readString(args, "selector");
    const text = readString(args, "text");
    if (selector === undefined) {
      return blocked("type requires selector.");
    }
    if (text === undefined) {
      return blocked("type requires text.");
    }
    const result = await this.#execAppleScript(
      chromeJavaScriptScript(typeJavaScript(selector, text)),
    );
    return textResponse(
      [
        "Computer Use provider action completed.",
        `app: ${CHROME_APP}`,
        "operation: type",
        `selector: ${redact(selector)}`,
        `result: ${redact(result.stdout.trim())}`,
      ].join("\n"),
    );
  }
}

function execAppleScript(script: string): Promise<AppleScriptExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-e", script],
      { encoding: "utf8", timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function chromeObserveScript(): string {
  return [
    `tell application ${osaString(CHROME_APP)}`,
    "activate",
    "if (count of windows) is 0 then make new window",
    "set theTab to active tab of front window",
    "set pageTitle to title of theTab",
    "set pageUrl to URL of theTab",
    'return pageTitle & "\n" & pageUrl',
    "end tell",
  ].join("\n");
}

function chromeNavigateScript(url: string): string {
  return [
    `tell application ${osaString(CHROME_APP)}`,
    "activate",
    "if (count of windows) is 0 then make new window",
    `set URL of active tab of front window to ${osaString(url)}`,
    'return "navigated"',
    "end tell",
  ].join("\n");
}

function chromeJavaScriptScript(js: string): string {
  return [
    `tell application ${osaString(CHROME_APP)}`,
    "activate",
    "if (count of windows) is 0 then make new window",
    `return execute active tab of front window javascript ${osaString(js)}`,
    "end tell",
  ].join("\n");
}

function clickJavaScript(selector: string): string {
  return `(() => { const el = document.querySelector(${JSON.stringify(
    selector,
  )}); if (!el) return "selector_not_found"; el.click(); return "clicked"; })()`;
}

function typeJavaScript(selector: string, text: string): string {
  return `(() => { const el = document.querySelector(${JSON.stringify(
    selector,
  )}); if (!el) return "selector_not_found"; if (!("value" in el)) return "not_text_input"; el.focus(); el.value = ${JSON.stringify(
    text,
  )}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return "typed"; })()`;
}

function readOperation(args: Record<string, unknown>): ComputerUseOperation | undefined {
  const raw = (readString(args, "operation") ?? readString(args, "action"))?.toLowerCase();
  if (raw === undefined) {
    return undefined;
  }
  for (const operation of ["observe", "navigate", "click", "type"] as const) {
    if (raw === operation || raw.includes(operation)) {
      return operation;
    }
  }
  if (raw.includes("inspect") || raw.includes("read")) {
    return "observe";
  }
  if (raw.includes("open")) {
    return "navigate";
  }
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isAllowedLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "file:") {
      return true;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function textResponse(text: string): DynamicToolCallResponse {
  return { success: true, contentItems: [{ type: "inputText", text }] };
}

function blocked(reason: string): DynamicToolCallResponse {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: `Computer Use provider blocked: ${reason}` }],
  };
}

function redact(value: string): string {
  return value.replace(SECRET_SHAPED_RE, "***REDACTED***");
}

function osaString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
