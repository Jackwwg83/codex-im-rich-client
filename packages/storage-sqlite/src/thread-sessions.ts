import { BindingRepository, type ThreadBindingRecord } from "./bindings.js";
import type { DatabaseHandle } from "./database.js";

export interface ThreadSessionTarget {
  platform: string;
  chatId: string;
  threadKey?: string;
  topicId?: string;
}

export type ThreadSessionStatus = "open" | "archived";

export interface ThreadSessionUpsert {
  target: ThreadSessionTarget;
  projectId: string;
  codexThreadId: string;
  title?: string;
  status?: ThreadSessionStatus;
  now?: string;
  lastUsedAt?: string;
}

export interface ThreadSessionListOptions {
  projectId?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface ThreadSessionSwitchCurrent {
  target: ThreadSessionTarget;
  projectId: string;
  codexThreadId: string;
  cwd: string;
  defaultModel?: string;
  now?: string;
}

export interface ThreadSessionSwitchResult {
  binding: ThreadBindingRecord;
  session: ThreadSessionRecord;
}

export interface ThreadSessionRecord {
  id: string;
  target: ThreadSessionTarget;
  projectId: string;
  codexThreadId: string;
  title?: string;
  status: ThreadSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
}

interface ThreadSessionRow {
  id: string;
  target_platform: string;
  target_chat_id: string;
  target_thread_key: string | null;
  target_topic_id: string | null;
  project_id: string;
  codex_thread_id: string;
  title: string | null;
  status: ThreadSessionStatus;
  created_at: string;
  updated_at: string;
  last_used_at: string;
}

interface TargetParams {
  targetPlatform: string;
  targetChatId: string;
  targetThreadKey: string | null;
  targetTopicId: string | null;
}

const SELECT_COLUMNS = `
  id,
  target_platform,
  target_chat_id,
  target_thread_key,
  target_topic_id,
  project_id,
  codex_thread_id,
  title,
  status,
  created_at,
  updated_at,
  last_used_at
`;

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

function normalizeTarget(target: ThreadSessionTarget): TargetParams {
  return {
    targetPlatform: target.platform,
    targetChatId: target.chatId,
    targetThreadKey: target.threadKey ?? null,
    targetTopicId: target.topicId ?? null,
  };
}

function threadSessionId(target: ThreadSessionTarget, codexThreadId: string): string {
  const encoded = Buffer.from(
    JSON.stringify([
      target.platform,
      target.chatId,
      target.threadKey ?? null,
      target.topicId ?? null,
      codexThreadId,
    ]),
    "utf8",
  ).toString("base64url");
  return `ts_${encoded}`;
}

function sanitizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIST_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(limit, MAX_LIST_LIMIT);
}

function hydrate(row: ThreadSessionRow): ThreadSessionRecord {
  return {
    id: row.id,
    target: {
      platform: row.target_platform,
      chatId: row.target_chat_id,
      ...(row.target_thread_key !== null ? { threadKey: row.target_thread_key } : {}),
      ...(row.target_topic_id !== null ? { topicId: row.target_topic_id } : {}),
    },
    projectId: row.project_id,
    codexThreadId: row.codex_thread_id,
    ...(row.title !== null ? { title: row.title } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

export class ThreadSessionRepository {
  constructor(private readonly db: DatabaseHandle) {}

  upsert(input: ThreadSessionUpsert): ThreadSessionRecord {
    const now = input.now ?? new Date().toISOString();
    const lastUsedAt = input.lastUsedAt ?? now;
    const existing = this.findByTargetAndThread(input.target, input.codexThreadId);
    const target = normalizeTarget(input.target);

    if (existing !== undefined) {
      this.db
        .prepare(
          `
            UPDATE thread_sessions
               SET project_id = @projectId,
                   title = CASE WHEN @hasTitle = 1 THEN @title ELSE title END,
                   status = @status,
                   updated_at = @updatedAt,
                   last_used_at = @lastUsedAt
             WHERE id = @id
          `,
        )
        .run({
          id: existing.id,
          projectId: input.projectId,
          hasTitle: input.title === undefined ? 0 : 1,
          title: input.title ?? null,
          status: input.status ?? existing.status,
          updatedAt: now,
          lastUsedAt,
        });
      return this.findByTargetAndThread(input.target, input.codexThreadId) as ThreadSessionRecord;
    }

    this.db
      .prepare(
        `
          INSERT INTO thread_sessions (
            id,
            target_platform,
            target_chat_id,
            target_thread_key,
            target_topic_id,
            project_id,
            codex_thread_id,
            title,
            status,
            created_at,
            updated_at,
            last_used_at
          ) VALUES (
            @id,
            @targetPlatform,
            @targetChatId,
            @targetThreadKey,
            @targetTopicId,
            @projectId,
            @codexThreadId,
            @title,
            @status,
            @createdAt,
            @updatedAt,
            @lastUsedAt
          )
        `,
      )
      .run({
        id: threadSessionId(input.target, input.codexThreadId),
        ...target,
        projectId: input.projectId,
        codexThreadId: input.codexThreadId,
        title: input.title ?? null,
        status: input.status ?? "open",
        createdAt: now,
        updatedAt: now,
        lastUsedAt,
      });

    return this.findByTargetAndThread(input.target, input.codexThreadId) as ThreadSessionRecord;
  }

  findByTargetAndThread(
    target: ThreadSessionTarget,
    codexThreadId: string,
  ): ThreadSessionRecord | undefined {
    const row = this.db
      .prepare(
        `
          SELECT ${SELECT_COLUMNS}
            FROM thread_sessions
           WHERE target_platform = @targetPlatform
             AND target_chat_id = @targetChatId
             AND target_thread_key IS @targetThreadKey
             AND target_topic_id IS @targetTopicId
             AND codex_thread_id = @codexThreadId
        `,
      )
      .get({ ...normalizeTarget(target), codexThreadId }) as ThreadSessionRow | undefined;

    return row === undefined ? undefined : hydrate(row);
  }

  listForTarget(
    target: ThreadSessionTarget,
    options: ThreadSessionListOptions = {},
  ): ThreadSessionRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT ${SELECT_COLUMNS}
            FROM thread_sessions
           WHERE target_platform = @targetPlatform
             AND target_chat_id = @targetChatId
             AND target_thread_key IS @targetThreadKey
             AND target_topic_id IS @targetTopicId
             AND (@projectId IS NULL OR project_id = @projectId)
             AND (@includeArchived = 1 OR status = 'open')
        ORDER BY last_used_at DESC, updated_at DESC, id ASC
           LIMIT @limit
        `,
      )
      .all({
        ...normalizeTarget(target),
        projectId: options.projectId ?? null,
        includeArchived: options.includeArchived === true ? 1 : 0,
        limit: sanitizeLimit(options.limit),
      }) as ThreadSessionRow[];

    return rows.map(hydrate);
  }

  touch(
    target: ThreadSessionTarget,
    codexThreadId: string,
    now = new Date().toISOString(),
  ): ThreadSessionRecord | undefined {
    this.db
      .prepare(
        `
          UPDATE thread_sessions
             SET updated_at = @updatedAt,
                 last_used_at = @lastUsedAt
           WHERE target_platform = @targetPlatform
             AND target_chat_id = @targetChatId
             AND target_thread_key IS @targetThreadKey
             AND target_topic_id IS @targetTopicId
             AND codex_thread_id = @codexThreadId
        `,
      )
      .run({
        ...normalizeTarget(target),
        codexThreadId,
        updatedAt: now,
        lastUsedAt: now,
      });

    return this.findByTargetAndThread(target, codexThreadId);
  }

  rename(
    target: ThreadSessionTarget,
    codexThreadId: string,
    title: string | undefined,
    now = new Date().toISOString(),
  ): ThreadSessionRecord | undefined {
    this.db
      .prepare(
        `
          UPDATE thread_sessions
             SET title = @title,
                 updated_at = @updatedAt
           WHERE target_platform = @targetPlatform
             AND target_chat_id = @targetChatId
             AND target_thread_key IS @targetThreadKey
             AND target_topic_id IS @targetTopicId
             AND codex_thread_id = @codexThreadId
        `,
      )
      .run({
        ...normalizeTarget(target),
        codexThreadId,
        title: title ?? null,
        updatedAt: now,
      });

    return this.findByTargetAndThread(target, codexThreadId);
  }

  switchCurrent(input: ThreadSessionSwitchCurrent): ThreadSessionSwitchResult {
    const now = input.now ?? new Date().toISOString();
    return this.db.transaction(() => {
      const binding = new BindingRepository(this.db).upsert({
        target: input.target,
        projectId: input.projectId,
        codexThreadId: input.codexThreadId,
        cwd: input.cwd,
        ...(input.defaultModel === undefined ? {} : { defaultModel: input.defaultModel }),
        now,
      });
      const session = this.touch(input.target, input.codexThreadId, now);
      if (session === undefined) {
        throw new Error("Cannot switch current thread to an unknown thread session");
      }
      return { binding, session };
    })();
  }
}
