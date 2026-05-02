import type { DatabaseHandle } from "./database.js";

export interface AuditInsert {
  id: string;
  actorUserId?: string;
  action: string;
  targetKey?: string;
  projectId?: string;
  codexThreadId?: string;
  codexTurnId?: string;
  approvalId?: string;
  result?: string;
  metadataJson?: string;
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  actorUserId?: string;
  action: string;
  targetKey?: string;
  projectId?: string;
  codexThreadId?: string;
  codexTurnId?: string;
  approvalId?: string;
  result?: string;
  metadataJson?: string;
  createdAt: string;
}

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_key: string | null;
  project_id: string | null;
  codex_thread_id: string | null;
  codex_turn_id: string | null;
  approval_id: string | null;
  result: string | null;
  metadata_json: string | null;
  created_at: string;
}

function hydrate(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    ...(row.actor_user_id !== null ? { actorUserId: row.actor_user_id } : {}),
    action: row.action,
    ...(row.target_key !== null ? { targetKey: row.target_key } : {}),
    ...(row.project_id !== null ? { projectId: row.project_id } : {}),
    ...(row.codex_thread_id !== null ? { codexThreadId: row.codex_thread_id } : {}),
    ...(row.codex_turn_id !== null ? { codexTurnId: row.codex_turn_id } : {}),
    ...(row.approval_id !== null ? { approvalId: row.approval_id } : {}),
    ...(row.result !== null ? { result: row.result } : {}),
    ...(row.metadata_json !== null ? { metadataJson: row.metadata_json } : {}),
    createdAt: row.created_at,
  };
}

export class AuditRepository {
  constructor(private readonly db: DatabaseHandle) {}

  insert(input: AuditInsert): AuditRecord {
    this.db
      .prepare(
        `
          INSERT INTO audit_log (
            id,
            actor_user_id,
            action,
            target_key,
            project_id,
            codex_thread_id,
            codex_turn_id,
            approval_id,
            result,
            metadata_json,
            created_at
          ) VALUES (
            @id,
            @actorUserId,
            @action,
            @targetKey,
            @projectId,
            @codexThreadId,
            @codexTurnId,
            @approvalId,
            @result,
            @metadataJson,
            @createdAt
          )
        `,
      )
      .run({
        id: input.id,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetKey: input.targetKey ?? null,
        projectId: input.projectId ?? null,
        codexThreadId: input.codexThreadId ?? null,
        codexTurnId: input.codexTurnId ?? null,
        approvalId: input.approvalId ?? null,
        result: input.result ?? null,
        metadataJson: input.metadataJson ?? null,
        createdAt: input.createdAt,
      });

    return this.findById(input.id) as AuditRecord;
  }

  findById(id: string): AuditRecord | undefined {
    const row = this.db
      .prepare(
        `
          SELECT id,
                 actor_user_id,
                 action,
                 target_key,
                 project_id,
                 codex_thread_id,
                 codex_turn_id,
                 approval_id,
                 result,
                 metadata_json,
                 created_at
            FROM audit_log
           WHERE id = ?
        `,
      )
      .get(id) as AuditRow | undefined;

    return row === undefined ? undefined : hydrate(row);
  }
}
