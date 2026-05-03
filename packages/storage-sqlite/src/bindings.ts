import type { DatabaseHandle } from "./database.js";

export interface BindingTarget {
  platform: string;
  chatId: string;
  threadKey?: string;
  topicId?: string;
}

export interface BindingUpsert {
  target: BindingTarget;
  projectId: string;
  codexThreadId?: string;
  cwd: string;
  defaultModel?: string;
  activeTurnId?: string;
  now?: string;
}

export interface ThreadBindingRecord {
  id: string;
  target: BindingTarget;
  projectId: string;
  codexThreadId?: string;
  cwd: string;
  defaultModel?: string;
  activeTurnId?: string;
  createdAt: string;
  updatedAt: string;
}

interface ThreadBindingRow {
  id: string;
  target_platform: string;
  target_chat_id: string;
  target_thread_key: string | null;
  target_topic_id: string | null;
  project_id: string;
  codex_thread_id: string | null;
  cwd: string;
  default_model: string | null;
  active_turn_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TargetParams {
  targetPlatform: string;
  targetChatId: string;
  targetThreadKey: string | null;
  targetTopicId: string | null;
}

function normalizeTarget(target: BindingTarget): TargetParams {
  return {
    targetPlatform: target.platform,
    targetChatId: target.chatId,
    targetThreadKey: target.threadKey ?? null,
    targetTopicId: target.topicId ?? null,
  };
}

function bindingId(target: BindingTarget): string {
  const encoded = Buffer.from(
    JSON.stringify([
      target.platform,
      target.chatId,
      target.threadKey ?? null,
      target.topicId ?? null,
    ]),
    "utf8",
  ).toString("base64url");
  return `tb_${encoded}`;
}

function hydrate(row: ThreadBindingRow): ThreadBindingRecord {
  return {
    id: row.id,
    target: {
      platform: row.target_platform,
      chatId: row.target_chat_id,
      ...(row.target_thread_key !== null ? { threadKey: row.target_thread_key } : {}),
      ...(row.target_topic_id !== null ? { topicId: row.target_topic_id } : {}),
    },
    projectId: row.project_id,
    ...(row.codex_thread_id !== null ? { codexThreadId: row.codex_thread_id } : {}),
    cwd: row.cwd,
    ...(row.default_model !== null ? { defaultModel: row.default_model } : {}),
    ...(row.active_turn_id !== null ? { activeTurnId: row.active_turn_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class BindingRepository {
  constructor(private readonly db: DatabaseHandle) {}

  upsert(input: BindingUpsert): ThreadBindingRecord {
    const now = input.now ?? new Date().toISOString();
    const existing = this.findByTarget(input.target);
    const target = normalizeTarget(input.target);

    if (existing) {
      this.db
        .prepare(
          `
            UPDATE thread_bindings
               SET project_id = @projectId,
                   codex_thread_id = @codexThreadId,
                   cwd = @cwd,
                   default_model = @defaultModel,
                   active_turn_id = @activeTurnId,
                   updated_at = @updatedAt
             WHERE id = @id
          `,
        )
        .run({
          id: existing.id,
          projectId: input.projectId,
          codexThreadId: input.codexThreadId ?? null,
          cwd: input.cwd,
          defaultModel: input.defaultModel ?? null,
          activeTurnId: input.activeTurnId ?? null,
          updatedAt: now,
        });
      return this.findByTarget(input.target) as ThreadBindingRecord;
    }

    this.db
      .prepare(
        `
          INSERT INTO thread_bindings (
            id,
            target_platform,
            target_chat_id,
            target_thread_key,
            target_topic_id,
            project_id,
            codex_thread_id,
            cwd,
            default_model,
            active_turn_id,
            created_at,
            updated_at
          ) VALUES (
            @id,
            @targetPlatform,
            @targetChatId,
            @targetThreadKey,
            @targetTopicId,
            @projectId,
            @codexThreadId,
            @cwd,
            @defaultModel,
            @activeTurnId,
            @createdAt,
            @updatedAt
          )
        `,
      )
      .run({
        id: bindingId(input.target),
        ...target,
        projectId: input.projectId,
        codexThreadId: input.codexThreadId ?? null,
        cwd: input.cwd,
        defaultModel: input.defaultModel ?? null,
        activeTurnId: input.activeTurnId ?? null,
        createdAt: now,
        updatedAt: now,
      });

    return this.findByTarget(input.target) as ThreadBindingRecord;
  }

  findByTarget(target: BindingTarget): ThreadBindingRecord | undefined {
    const row = this.db
      .prepare(
        `
          SELECT id,
                 target_platform,
                 target_chat_id,
                 target_thread_key,
                 target_topic_id,
                 project_id,
                 codex_thread_id,
                 cwd,
                 default_model,
                 active_turn_id,
                 created_at,
                 updated_at
            FROM thread_bindings
           WHERE target_platform = @targetPlatform
             AND target_chat_id = @targetChatId
             AND target_thread_key IS @targetThreadKey
             AND target_topic_id IS @targetTopicId
        `,
      )
      .get(normalizeTarget(target)) as ThreadBindingRow | undefined;

    return row === undefined ? undefined : hydrate(row);
  }

  list(): ThreadBindingRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT id,
                 target_platform,
                 target_chat_id,
                 target_thread_key,
                 target_topic_id,
                 project_id,
                 codex_thread_id,
                 cwd,
                 default_model,
                 active_turn_id,
                 created_at,
                 updated_at
            FROM thread_bindings
        ORDER BY created_at ASC, id ASC
        `,
      )
      .all() as ThreadBindingRow[];

    return rows.map(hydrate);
  }

  delete(target: BindingTarget): boolean {
    const result = this.db
      .prepare(
        `
          DELETE FROM thread_bindings
           WHERE target_platform = @targetPlatform
             AND target_chat_id = @targetChatId
             AND target_thread_key IS @targetThreadKey
             AND target_topic_id IS @targetTopicId
        `,
      )
      .run(normalizeTarget(target));

    return result.changes > 0;
  }

  clearActiveTurns(): ThreadBindingRecord[] {
    const rows = this.db
      .prepare(
        `
          UPDATE thread_bindings
             SET active_turn_id = NULL,
                 updated_at = @updatedAt
           WHERE active_turn_id IS NOT NULL
       RETURNING id,
                 target_platform,
                 target_chat_id,
                 target_thread_key,
                 target_topic_id,
                 project_id,
                 codex_thread_id,
                 cwd,
                 default_model,
                 active_turn_id,
                 created_at,
                 updated_at
        `,
      )
      .all({ updatedAt: new Date().toISOString() }) as ThreadBindingRow[];

    return rows.map(hydrate);
  }
}
