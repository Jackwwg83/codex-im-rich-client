export type SlackLiveSmokeStatus = "skip" | "blocked" | "ready_dry_run" | "checked" | "sent";

export interface SlackLiveSmokeRedactedStatus {
  readonly status: SlackLiveSmokeStatus;
  readonly gate: "enabled" | "disabled";
  readonly mode: "auth" | "text" | "file";
  readonly botTokenEnv: string;
  readonly botToken: "present" | "missing";
  readonly targetChannelId?: "present" | "missing";
  readonly messageId?: "present";
  readonly missing?: readonly string[];
}

export interface SlackLiveSmokeOptions {
  readonly env?: Record<string, string | undefined>;
  readonly output?: (line: string) => void;
  readonly errorOutput?: (line: string) => void;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

const DEFAULT_BOT_TOKEN_ENV = "SLACK_BOT_TOKEN";
const SLACK_API_ORIGIN = "https://slack.com/api";

export async function runSlackLiveSmokeCore(
  options: SlackLiveSmokeOptions = {},
): Promise<SlackLiveSmokeRedactedStatus> {
  const env = options.env ?? process.env;
  const output = options.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  const errorOutput = options.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`));
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  if (env.SLACK_LIVE !== "1") {
    const status = redactedStatus(env, "skip");
    printStatus(output, status);
    output("[slack-live-smoke] SKIP: set SLACK_LIVE=1 to enable explicit live smoke.");
    return status;
  }

  const missing = missingLiveRequirements(env);
  if (missing.length > 0) {
    const status = { ...redactedStatus(env, "blocked"), missing };
    printStatus(output, status);
    errorOutput(`[slack-live-smoke] BLOCKED: missing ${missing.join(", ")}.`);
    return status;
  }

  if (env.SLACK_LIVE_DRY_RUN === "1") {
    const status = redactedStatus(env, "ready_dry_run");
    printStatus(output, status);
    output("[slack-live-smoke] READY_DRY_RUN: live env is present; no network call made.");
    return status;
  }

  const botToken = requiredSecret(env, botTokenEnvName(env));
  try {
    if (env.SLACK_LIVE_FILE === "1") {
      const messageId = await sendSlackLiveFile({
        botToken,
        channelId: requiredEnv(env, "SLACK_TARGET_CHANNEL_ID"),
        filename: "codex-im-live-attachment.txt",
        bytes: new TextEncoder().encode(`codex-im slack attachment ${now().toISOString()}`),
        fetchImpl,
      });
      const status = { ...redactedStatus(env, "sent"), messageId: presentString(messageId) };
      printStatus(output, status);
      output("[slack-live-smoke] SENT: redacted live file send succeeded.");
      return status;
    }

    if (env.SLACK_LIVE_TEXT === "1") {
      const messageId = await slackApiMessageId(
        "chat.postMessage",
        botToken,
        {
          channel: requiredEnv(env, "SLACK_TARGET_CHANNEL_ID"),
          text: env.SLACK_LIVE_TEXT_BODY ?? `[codex-im] live smoke ${now().toISOString()}`,
        },
        fetchImpl,
      );
      const status = { ...redactedStatus(env, "sent"), messageId: presentString(messageId) };
      printStatus(output, status);
      output("[slack-live-smoke] SENT: redacted live text send succeeded.");
      return status;
    }

    await slackApi("auth.test", botToken, {}, fetchImpl);
    const status = redactedStatus(env, "checked");
    printStatus(output, status);
    output("[slack-live-smoke] CHECKED: Slack Web API auth.test succeeded.");
    return status;
  } catch (error) {
    const status = redactedStatus(env, "blocked");
    printStatus(output, status);
    errorOutput(`[slack-live-smoke] BLOCKED: ${redactSlackSecrets(errorMessage(error))}.`);
    return status;
  }
}

function redactedStatus(
  env: Record<string, string | undefined>,
  status: SlackLiveSmokeStatus,
): SlackLiveSmokeRedactedStatus {
  const mode = env.SLACK_LIVE_FILE === "1" ? "file" : env.SLACK_LIVE_TEXT === "1" ? "text" : "auth";
  return {
    status,
    gate: env.SLACK_LIVE === "1" ? "enabled" : "disabled",
    mode,
    botTokenEnv: botTokenEnvName(env),
    botToken: present(env, botTokenEnvName(env)),
    ...(mode === "file" || mode === "text"
      ? { targetChannelId: present(env, "SLACK_TARGET_CHANNEL_ID") }
      : {}),
  };
}

async function sendSlackLiveFile(input: {
  readonly botToken: string;
  readonly channelId: string;
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly fetchImpl: typeof fetch;
}): Promise<string> {
  const upload = await slackApi(
    "files.getUploadURLExternal",
    input.botToken,
    {
      filename: input.filename,
      length: String(input.bytes.byteLength),
    },
    input.fetchImpl,
  );
  const uploadUrl = readString(upload, "upload_url");
  const fileId = readString(upload, "file_id");
  const uploadResponse = await input.fetchImpl(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: input.bytes,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Slack file upload failed with HTTP ${uploadResponse.status}`);
  }
  await slackApi(
    "files.completeUploadExternal",
    input.botToken,
    {
      channel_id: input.channelId,
      files: JSON.stringify([{ id: fileId, title: input.filename }]),
    },
    input.fetchImpl,
  );
  return fileId;
}

async function slackApiMessageId(
  method: string,
  token: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await slackApi(method, token, body, fetchImpl);
  return readString(response, "ts");
}

async function slackApi(
  method: string,
  token: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${SLACK_API_ORIGIN}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  if (!response.ok) {
    throw new Error(`Slack Web API ${method} failed with HTTP ${response.status}`);
  }
  const json = (await response.json()) as Record<string, unknown>;
  if (json.ok !== true) {
    throw new Error(`Slack Web API ${method} failed: ${String(json.error ?? "unknown_error")}`);
  }
  return json;
}

function missingLiveRequirements(env: Record<string, string | undefined>): string[] {
  const missing: string[] = [];
  const tokenEnvName = botTokenEnvName(env);
  if (env[tokenEnvName] === undefined || env[tokenEnvName]?.trim().length === 0) {
    missing.push(tokenEnvName);
  }
  if (
    (env.SLACK_LIVE_FILE === "1" || env.SLACK_LIVE_TEXT === "1") &&
    (env.SLACK_TARGET_CHANNEL_ID === undefined || env.SLACK_TARGET_CHANNEL_ID.length === 0)
  ) {
    missing.push("SLACK_TARGET_CHANNEL_ID");
  }
  return missing;
}

function botTokenEnvName(env: Record<string, string | undefined>): string {
  return env.SLACK_BOT_TOKEN_ENV ?? DEFAULT_BOT_TOKEN_ENV;
}

function requiredSecret(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`required env missing: ${name}`);
  }
  return value;
}

function requiredEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`required env missing: ${name}`);
  }
  return value;
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Slack response missing ${key}`);
  }
  return value;
}

function present(env: Record<string, string | undefined>, name: string): "present" | "missing" {
  return env[name] === undefined || env[name]?.length === 0 ? "missing" : "present";
}

function presentString(value: string): "present" {
  if (value.length === 0) {
    throw new Error("Slack live smoke expected a non-empty message id");
  }
  return "present";
}

function printStatus(output: (line: string) => void, status: SlackLiveSmokeRedactedStatus): void {
  output(JSON.stringify(status, undefined, 2));
}

function redactSlackSecrets(value: string): string {
  return value.replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "<redacted:slack-token>");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
