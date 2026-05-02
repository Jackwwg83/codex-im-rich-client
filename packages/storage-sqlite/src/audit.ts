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

export interface AuditRepositoryOptions {
  redact?: (text: string) => string;
  nowMs?: () => number;
  onUnavailable?: (marker: AuditUnavailableMarker) => void;
  unavailableWindowMs?: number;
}

export interface AuditUnavailableMarker {
  action: "audit.sqlite_unavailable";
  result: "failed";
  metadataJson: string;
  createdAt: string;
}

export type AuditInsertBestEffortResult =
  | { ok: true; record: AuditRecord; droppedCount: number }
  | {
      ok: false;
      droppedCount: number;
      markerEmitted: boolean;
      errorMessage: string;
    };

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
  readonly #redact: (text: string) => string;
  readonly #nowMs: () => number;
  readonly #onUnavailable: ((marker: AuditUnavailableMarker) => void) | null;
  readonly #unavailableWindowMs: number;
  #droppedCount = 0;
  #lastUnavailableMarkerAt: number | null = null;

  constructor(
    private readonly db: DatabaseHandle,
    opts: AuditRepositoryOptions = {},
  ) {
    this.#redact = opts.redact ?? ((text) => text);
    this.#nowMs = opts.nowMs ?? (() => Date.now());
    this.#onUnavailable = opts.onUnavailable ?? null;
    this.#unavailableWindowMs = opts.unavailableWindowMs ?? 60_000;
  }

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
        actorUserId: this.#redactOptional(input.actorUserId),
        action: this.#redact(input.action),
        targetKey: this.#redactOptional(input.targetKey),
        projectId: this.#redactOptional(input.projectId),
        codexThreadId: this.#redactOptional(input.codexThreadId),
        codexTurnId: this.#redactOptional(input.codexTurnId),
        approvalId: this.#redactOptional(input.approvalId),
        result: this.#redactOptional(input.result),
        metadataJson: this.#redactOptional(input.metadataJson),
        createdAt: input.createdAt,
      });

    return this.findById(input.id) as AuditRecord;
  }

  insertBestEffort(input: AuditInsert): AuditInsertBestEffortResult {
    try {
      return { ok: true, record: this.insert(input), droppedCount: this.#droppedCount };
    } catch (error) {
      this.#droppedCount += 1;
      const now = this.#nowMs();
      const markerEmitted = this.#maybeEmitUnavailableMarker(now, error);
      return {
        ok: false,
        droppedCount: this.#droppedCount,
        markerEmitted,
        errorMessage: errorMessage(error),
      };
    }
  }

  droppedCount(): number {
    return this.#droppedCount;
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

  #redactOptional(value: string | undefined): string | null {
    return value === undefined ? null : this.#redact(value);
  }

  #maybeEmitUnavailableMarker(now: number, error: unknown): boolean {
    if (
      this.#lastUnavailableMarkerAt !== null &&
      now - this.#lastUnavailableMarkerAt < this.#unavailableWindowMs
    ) {
      return false;
    }

    this.#lastUnavailableMarkerAt = now;
    if (this.#onUnavailable !== null) {
      try {
        this.#onUnavailable({
          action: "audit.sqlite_unavailable",
          result: "failed",
          metadataJson: JSON.stringify({
            droppedCount: this.#droppedCount,
            error: errorMessage(error),
          }),
          createdAt: new Date(now).toISOString(),
        });
      } catch {
        // Best-effort audit sink errors must never block broker/daemon paths.
      }
    }
    return true;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
