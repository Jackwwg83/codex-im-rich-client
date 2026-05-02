import type { DatabaseHandle } from "./database.js";

export interface ApprovalTarget {
  platform: string;
  chatId: string;
  threadKey?: string;
  topicId?: string;
}

export type ApprovalStatus = "pending" | "resolved" | "expired" | "transport_lost";

export interface ApprovalUpsert {
  id: string;
  appServerRequestId: string | number;
  kind: string;
  status: ApprovalStatus;
  target: ApprovalTarget;
  codexThreadId?: string;
  codexTurnId?: string;
  title: string;
  body: string;
  riskLevel: string;
  requestedByUserId?: string;
  decidedByUserId?: string;
  decision?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  rawJson?: string;
}

export interface ApprovalRecord {
  id: string;
  appServerRequestId: string;
  kind: string;
  status: ApprovalStatus;
  target: ApprovalTarget;
  codexThreadId?: string;
  codexTurnId?: string;
  title: string;
  body: string;
  riskLevel: string;
  requestedByUserId?: string;
  decidedByUserId?: string;
  decision?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  rawJson?: string;
}

export interface ApprovalRepositoryOptions {
  redact?: (text: string) => string;
}

interface ApprovalRow {
  id: string;
  app_server_request_id: string;
  kind: string;
  status: ApprovalStatus;
  target_platform: string;
  target_chat_id: string;
  target_thread_key: string | null;
  target_topic_id: string | null;
  codex_thread_id: string | null;
  codex_turn_id: string | null;
  title: string;
  body: string;
  risk_level: string;
  requested_by_user_id: string | null;
  decided_by_user_id: string | null;
  decision: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  raw_json: string | null;
}

function hydrate(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    appServerRequestId: row.app_server_request_id,
    kind: row.kind,
    status: row.status,
    target: {
      platform: row.target_platform,
      chatId: row.target_chat_id,
      ...(row.target_thread_key !== null ? { threadKey: row.target_thread_key } : {}),
      ...(row.target_topic_id !== null ? { topicId: row.target_topic_id } : {}),
    },
    ...(row.codex_thread_id !== null ? { codexThreadId: row.codex_thread_id } : {}),
    ...(row.codex_turn_id !== null ? { codexTurnId: row.codex_turn_id } : {}),
    title: row.title,
    body: row.body,
    riskLevel: row.risk_level,
    ...(row.requested_by_user_id !== null ? { requestedByUserId: row.requested_by_user_id } : {}),
    ...(row.decided_by_user_id !== null ? { decidedByUserId: row.decided_by_user_id } : {}),
    ...(row.decision !== null ? { decision: row.decision } : {}),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.decided_at !== null ? { decidedAt: row.decided_at } : {}),
    ...(row.raw_json !== null ? { rawJson: row.raw_json } : {}),
  };
}

export class ApprovalRepository {
  readonly #redact: (text: string) => string;

  constructor(
    private readonly db: DatabaseHandle,
    opts: ApprovalRepositoryOptions = {},
  ) {
    this.#redact = opts.redact ?? ((text) => text);
  }

  upsert(input: ApprovalUpsert): ApprovalRecord {
    this.db
      .prepare(
        `
          INSERT INTO approvals (
            id,
            app_server_request_id,
            kind,
            status,
            target_platform,
            target_chat_id,
            target_thread_key,
            target_topic_id,
            codex_thread_id,
            codex_turn_id,
            title,
            body,
            risk_level,
            requested_by_user_id,
            decided_by_user_id,
            decision,
            expires_at,
            created_at,
            updated_at,
            decided_at,
            raw_json
          ) VALUES (
            @id,
            @appServerRequestId,
            @kind,
            @status,
            @targetPlatform,
            @targetChatId,
            @targetThreadKey,
            @targetTopicId,
            @codexThreadId,
            @codexTurnId,
            @title,
            @body,
            @riskLevel,
            @requestedByUserId,
            @decidedByUserId,
            @decision,
            @expiresAt,
            @createdAt,
            @updatedAt,
            @decidedAt,
            @rawJson
          )
          ON CONFLICT(id) DO UPDATE SET
            app_server_request_id = excluded.app_server_request_id,
            kind = excluded.kind,
            status = excluded.status,
            target_platform = excluded.target_platform,
            target_chat_id = excluded.target_chat_id,
            target_thread_key = excluded.target_thread_key,
            target_topic_id = excluded.target_topic_id,
            codex_thread_id = excluded.codex_thread_id,
            codex_turn_id = excluded.codex_turn_id,
            title = excluded.title,
            body = excluded.body,
            risk_level = excluded.risk_level,
            requested_by_user_id = excluded.requested_by_user_id,
            decided_by_user_id = excluded.decided_by_user_id,
            decision = excluded.decision,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at,
            decided_at = excluded.decided_at,
            raw_json = excluded.raw_json
        `,
      )
      .run({
        id: input.id,
        appServerRequestId: String(input.appServerRequestId),
        kind: input.kind,
        status: input.status,
        targetPlatform: input.target.platform,
        targetChatId: input.target.chatId,
        targetThreadKey: input.target.threadKey ?? null,
        targetTopicId: input.target.topicId ?? null,
        codexThreadId: input.codexThreadId ?? null,
        codexTurnId: input.codexTurnId ?? null,
        title: this.#redact(input.title),
        body: this.#redact(input.body),
        riskLevel: input.riskLevel,
        requestedByUserId: this.#redactOptional(input.requestedByUserId),
        decidedByUserId: this.#redactOptional(input.decidedByUserId),
        decision: this.#redactOptional(input.decision),
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        decidedAt: input.decidedAt ?? null,
        rawJson: this.#redactOptional(input.rawJson),
      });

    return this.findById(input.id) as ApprovalRecord;
  }

  findById(id: string): ApprovalRecord | undefined {
    const row = this.db
      .prepare(
        `
          SELECT id,
                 app_server_request_id,
                 kind,
                 status,
                 target_platform,
                 target_chat_id,
                 target_thread_key,
                 target_topic_id,
                 codex_thread_id,
                 codex_turn_id,
                 title,
                 body,
                 risk_level,
                 requested_by_user_id,
                 decided_by_user_id,
                 decision,
                 expires_at,
                 created_at,
                 updated_at,
                 decided_at,
                 raw_json
            FROM approvals
           WHERE id = ?
        `,
      )
      .get(id) as ApprovalRow | undefined;

    return row === undefined ? undefined : hydrate(row);
  }

  #redactOptional(value: string | undefined): string | null {
    return value === undefined ? null : this.#redact(value);
  }
}
