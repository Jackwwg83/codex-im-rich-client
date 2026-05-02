import type { DatabaseHandle } from "./database.js";

export type CallbackTokenAction = "allow_once" | "allow_session" | "decline" | "abort";
export type CallbackTokenStatus = "issued" | "bound" | "used" | "expired" | "revoked";

export interface CallbackTokenTarget {
  platform: string;
  chatId: string;
  threadKey?: string;
  topicId?: string;
}

export type CallbackTokenActor =
  | { kind: "im"; userId?: string; platform?: string }
  | { kind: "system"; reason?: string };

export interface CallbackMessageRef {
  chatId: string;
  messageId: string;
}

export interface CallbackTokenInsert {
  tokenHash: string;
  approvalId: string;
  action: CallbackTokenAction;
  callbackNonce: string;
  target: CallbackTokenTarget;
  actor: CallbackTokenActor;
  status?: CallbackTokenStatus;
  messageRef?: CallbackMessageRef;
  createdAt: string;
  expiresAt: string;
}

export interface CallbackTokenCasFields {
  actor?: CallbackTokenActor;
  messageRef?: CallbackMessageRef;
  expiresAt?: string;
}

export interface CallbackTokenRecord {
  tokenHash: string;
  approvalId: string;
  action: CallbackTokenAction;
  callbackNonce: string;
  target: CallbackTokenTarget;
  actor: CallbackTokenActor;
  status: CallbackTokenStatus;
  messageRef?: CallbackMessageRef;
  createdAt: string;
  expiresAt: string;
}

interface CallbackTokenRow {
  token_hash: string;
  approval_id: string;
  action: CallbackTokenAction;
  callback_nonce: string;
  target_platform: string;
  target_chat_id: string;
  target_thread_key: string | null;
  target_topic_id: string | null;
  actor_kind: "im" | "system";
  actor_user_id: string | null;
  actor_platform: string | null;
  actor_reason: string | null;
  msg_chat_id: string | null;
  msg_message_id: string | null;
  status: CallbackTokenStatus;
  created_at: string;
  expires_at: string;
}

const SELECT_COLUMNS = `
  token_hash,
  approval_id,
  action,
  callback_nonce,
  target_platform,
  target_chat_id,
  target_thread_key,
  target_topic_id,
  actor_kind,
  actor_user_id,
  actor_platform,
  actor_reason,
  msg_chat_id,
  msg_message_id,
  status,
  created_at,
  expires_at
`;

function actorParams(actor: CallbackTokenActor): {
  actorKind: "im" | "system";
  actorUserId: string | null;
  actorPlatform: string | null;
  actorReason: string | null;
} {
  if (actor.kind === "im") {
    return {
      actorKind: "im",
      actorUserId: actor.userId ?? null,
      actorPlatform: actor.platform ?? null,
      actorReason: null,
    };
  }

  return {
    actorKind: "system",
    actorUserId: null,
    actorPlatform: null,
    actorReason: actor.reason ?? null,
  };
}

function hydrate(row: CallbackTokenRow): CallbackTokenRecord {
  const actor: CallbackTokenActor =
    row.actor_kind === "im"
      ? {
          kind: "im",
          ...(row.actor_user_id !== null ? { userId: row.actor_user_id } : {}),
          ...(row.actor_platform !== null ? { platform: row.actor_platform } : {}),
        }
      : {
          kind: "system",
          ...(row.actor_reason !== null ? { reason: row.actor_reason } : {}),
        };

  return {
    tokenHash: row.token_hash,
    approvalId: row.approval_id,
    action: row.action,
    callbackNonce: row.callback_nonce,
    target: {
      platform: row.target_platform,
      chatId: row.target_chat_id,
      ...(row.target_thread_key !== null ? { threadKey: row.target_thread_key } : {}),
      ...(row.target_topic_id !== null ? { topicId: row.target_topic_id } : {}),
    },
    actor,
    status: row.status,
    ...(row.msg_chat_id !== null && row.msg_message_id !== null
      ? { messageRef: { chatId: row.msg_chat_id, messageId: row.msg_message_id } }
      : {}),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class CallbackTokenRepository {
  constructor(private readonly db: DatabaseHandle) {}

  insert(input: CallbackTokenInsert): CallbackTokenRecord {
    this.db
      .prepare(
        `
          INSERT INTO callback_tokens (
            token_hash,
            approval_id,
            action,
            callback_nonce,
            target_platform,
            target_chat_id,
            target_thread_key,
            target_topic_id,
            actor_kind,
            actor_user_id,
            actor_platform,
            actor_reason,
            msg_chat_id,
            msg_message_id,
            status,
            created_at,
            expires_at
          ) VALUES (
            @tokenHash,
            @approvalId,
            @action,
            @callbackNonce,
            @targetPlatform,
            @targetChatId,
            @targetThreadKey,
            @targetTopicId,
            @actorKind,
            @actorUserId,
            @actorPlatform,
            @actorReason,
            @msgChatId,
            @msgMessageId,
            @status,
            @createdAt,
            @expiresAt
          )
        `,
      )
      .run({
        tokenHash: input.tokenHash,
        approvalId: input.approvalId,
        action: input.action,
        callbackNonce: input.callbackNonce,
        targetPlatform: input.target.platform,
        targetChatId: input.target.chatId,
        targetThreadKey: input.target.threadKey ?? null,
        targetTopicId: input.target.topicId ?? null,
        ...actorParams(input.actor),
        msgChatId: input.messageRef?.chatId ?? null,
        msgMessageId: input.messageRef?.messageId ?? null,
        status: input.status ?? "issued",
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      });

    return this.findByHash(input.tokenHash) as CallbackTokenRecord;
  }

  findByHash(tokenHash: string): CallbackTokenRecord | undefined {
    const row = this.db
      .prepare(
        `
          SELECT ${SELECT_COLUMNS}
            FROM callback_tokens
           WHERE token_hash = ?
        `,
      )
      .get(tokenHash) as CallbackTokenRow | undefined;

    return row === undefined ? undefined : hydrate(row);
  }

  casUpdate(
    tokenHash: string,
    fromStatus: CallbackTokenStatus,
    toStatus: CallbackTokenStatus,
    fields: CallbackTokenCasFields = {},
  ): CallbackTokenRecord | undefined {
    const actor = fields.actor === undefined ? null : actorParams(fields.actor);
    const row = this.db
      .prepare(
        `
          UPDATE callback_tokens
             SET status = @toStatus,
                 actor_kind = CASE WHEN @hasActor = 1 THEN @actorKind ELSE actor_kind END,
                 actor_user_id = CASE WHEN @hasActor = 1 THEN @actorUserId ELSE actor_user_id END,
                 actor_platform = CASE WHEN @hasActor = 1 THEN @actorPlatform ELSE actor_platform END,
                 actor_reason = CASE WHEN @hasActor = 1 THEN @actorReason ELSE actor_reason END,
                 msg_chat_id = CASE WHEN @hasMessageRef = 1 THEN @msgChatId ELSE msg_chat_id END,
                 msg_message_id = CASE WHEN @hasMessageRef = 1 THEN @msgMessageId ELSE msg_message_id END,
                 expires_at = CASE WHEN @expiresAt IS NOT NULL THEN @expiresAt ELSE expires_at END
           WHERE token_hash = @tokenHash
             AND status = @fromStatus
       RETURNING ${SELECT_COLUMNS}
        `,
      )
      .get({
        tokenHash,
        fromStatus,
        toStatus,
        hasActor: fields.actor === undefined ? 0 : 1,
        actorKind: actor?.actorKind ?? null,
        actorUserId: actor?.actorUserId ?? null,
        actorPlatform: actor?.actorPlatform ?? null,
        actorReason: actor?.actorReason ?? null,
        hasMessageRef: fields.messageRef === undefined ? 0 : 1,
        msgChatId: fields.messageRef?.chatId ?? null,
        msgMessageId: fields.messageRef?.messageId ?? null,
        expiresAt: fields.expiresAt ?? null,
      }) as CallbackTokenRow | undefined;

    return row === undefined ? undefined : hydrate(row);
  }

  pruneExpired(now: string): CallbackTokenRecord[] {
    const rows = this.db
      .prepare(
        `
          UPDATE callback_tokens
             SET status = 'expired'
           WHERE status = 'bound'
             AND expires_at < @now
       RETURNING ${SELECT_COLUMNS}
        `,
      )
      .all({ now }) as CallbackTokenRow[];

    return rows.map(hydrate);
  }
}
