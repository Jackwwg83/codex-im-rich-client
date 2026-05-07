import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SocketModeClient } from "@slack/socket-mode";
import {
  SlackChannelAdapter,
  type SlackChannelAdapterOptions,
  type SlackDownloadedFile,
  type SlackFileDownloadInput,
  type SlackFilesUploadV2Input,
  type SlackMessageResult,
  type SlackPostMessageInput,
  type SlackSocketModeClientLike,
  type SlackSocketModeEventName,
  type SlackUpdateMessageInput,
  type SlackWebClientLike,
} from "./adapter.js";

export interface SlackSdkChannelAdapterOptions {
  readonly botToken: string;
  readonly appToken: string;
  readonly attachmentDir?: string;
  readonly fetchImpl?: typeof fetch;
  readonly socketClient?: SlackSocketModeClientLike;
  readonly webClient?: SlackWebClientLike;
}

export interface SlackWebApiClientOptions {
  readonly botToken: string;
  readonly attachmentDir?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface SlackSocketModeClientOptions {
  readonly appToken: string;
}

const SLACK_API_ORIGIN = "https://slack.com/api";

export function createSlackSdkChannelAdapter(
  options: SlackSdkChannelAdapterOptions,
): SlackChannelAdapter {
  return new SlackChannelAdapter({
    socketClient:
      options.socketClient ?? createSlackSocketModeClient({ appToken: options.appToken }),
    webClient:
      options.webClient ??
      createSlackWebApiClient({
        botToken: options.botToken,
        ...(options.attachmentDir === undefined ? {} : { attachmentDir: options.attachmentDir }),
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      }),
  } satisfies SlackChannelAdapterOptions);
}

export function createSlackSocketModeClient(
  options: SlackSocketModeClientOptions,
): SlackSocketModeClientLike {
  assertSecretPresent("Slack app token", options.appToken);
  return new SlackSocketModeClientAdapter(
    new SocketModeClient({ appToken: options.appToken, autoReconnectEnabled: true }),
  );
}

export function createSlackWebApiClient(options: SlackWebApiClientOptions): SlackWebClientLike {
  assertSecretPresent("Slack bot token", options.botToken);
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    chatPostMessage: (input) => slackChatPostMessage(options.botToken, input, fetchImpl),
    chatUpdate: (input) => slackChatUpdate(options.botToken, input, fetchImpl),
    filesUploadV2: (input) => slackFilesUploadV2(options.botToken, input, fetchImpl),
    downloadFile: (input) =>
      slackDownloadFile(options.botToken, input, options.attachmentDir, fetchImpl),
  };
}

class SlackSocketModeClientAdapter implements SlackSocketModeClientLike {
  readonly #client: SocketModeClient;

  constructor(client: SocketModeClient) {
    this.#client = client;
  }

  async start(): Promise<void> {
    await this.#client.start();
  }

  async disconnect(): Promise<void> {
    await this.#client.disconnect();
  }

  on(
    event: SlackSocketModeEventName,
    handler: (payload: unknown) => void | Promise<void>,
  ): unknown {
    this.#client.on(event, async (payload: unknown) => {
      await handler(normalizeSlackSocketModePayload(event, payload));
    });
    return undefined;
  }
}

async function slackChatPostMessage(
  token: string,
  input: SlackPostMessageInput,
  fetchImpl: typeof fetch,
): Promise<SlackMessageResult> {
  const response = await slackJsonApi(
    "chat.postMessage",
    token,
    omitUndefined({
      channel: input.channel,
      text: input.text,
      blocks: input.blocks,
      thread_ts: input.thread_ts,
    }),
    fetchImpl,
  );
  return optionalMessageResult(response);
}

async function slackChatUpdate(
  token: string,
  input: SlackUpdateMessageInput,
  fetchImpl: typeof fetch,
): Promise<SlackMessageResult> {
  const response = await slackJsonApi(
    "chat.update",
    token,
    omitUndefined({
      channel: input.channel,
      ts: input.ts,
      text: input.text,
      blocks: input.blocks,
    }),
    fetchImpl,
  );
  return optionalMessageResult(response);
}

async function slackFilesUploadV2(
  token: string,
  input: SlackFilesUploadV2Input,
  fetchImpl: typeof fetch,
): Promise<SlackMessageResult> {
  const upload = await slackJsonApi(
    "files.getUploadURLExternal",
    token,
    {
      filename: input.filename,
      length: input.file.byteLength,
    },
    fetchImpl,
  );
  const uploadUrl = readString(upload, "upload_url");
  const fileId = readString(upload, "file_id");
  const uploadResponse = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: input.file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Slack file upload failed with HTTP ${uploadResponse.status}`);
  }
  await slackJsonApi(
    "files.completeUploadExternal",
    token,
    omitUndefined({
      channel_id: input.channel_id,
      files: [{ id: fileId, title: input.title }],
      thread_ts: input.thread_ts,
    }),
    fetchImpl,
  );
  return { channel: input.channel_id, ts: fileId };
}

async function slackDownloadFile(
  token: string,
  input: SlackFileDownloadInput,
  attachmentDir: string | undefined,
  fetchImpl: typeof fetch,
): Promise<SlackDownloadedFile> {
  const response = await fetchImpl(input.url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Slack file download failed with HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const dir = attachmentDir ?? defaultSlackAttachmentDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const localPath = join(
    dir,
    `${safeSlackPathPart(input.fileId)}-${safeSlackFilename(input.filename)}`,
  );
  await writeFile(localPath, bytes, { mode: 0o600 });
  return { localPath, sizeBytes: bytes.byteLength };
}

async function slackJsonApi(
  method: string,
  token: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${SLACK_API_ORIGIN}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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

function normalizeSlackSocketModePayload(
  event: SlackSocketModeEventName,
  payload: unknown,
): unknown {
  const record = asRecord(payload);
  if (record === undefined) {
    return payload;
  }

  const body = asRecord(record.body);
  if (body !== undefined) {
    return withAck(body, record.ack);
  }

  if (event === "message" || event === "app_mention") {
    if (asRecord(record.event) !== undefined) {
      return record;
    }
    return { event: record, ...teamFields(record) };
  }

  return record;
}

function withAck(body: Record<string, unknown>, ack: unknown): Record<string, unknown> {
  return typeof ack === "function" ? { ...body, ack } : body;
}

function teamFields(record: Record<string, unknown>): Record<string, unknown> {
  if (typeof record.team_id === "string") {
    return { team_id: record.team_id };
  }
  if (typeof record.team === "string") {
    return { team_id: record.team };
  }
  return {};
}

function omitUndefined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Slack response missing ${key}`);
  }
  return value;
}

function readOptionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalMessageResult(input: Record<string, unknown>): SlackMessageResult {
  const channel = readOptionalString(input, "channel");
  const ts = readOptionalString(input, "ts");
  return {
    ...(channel === undefined ? {} : { channel }),
    ...(ts === undefined ? {} : { ts }),
  };
}

function assertSecretPresent(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}

function defaultSlackAttachmentDir(): string {
  return join(tmpdir(), "codex-im-slack-attachments");
}

function safeSlackFilename(filename: string): string {
  const base = basename(filename)
    .replace(/[^\w .@+-]/gu, "_")
    .trim();
  const safe = base.length === 0 || base === "." || base === ".." ? "attachment" : base;
  return safe.slice(0, 160);
}

function safeSlackPathPart(value: string): string {
  const safe = value.replace(/[^\w.@+-]/gu, "_").trim();
  return (safe.length === 0 ? "slack-file" : safe).slice(0, 80);
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}
