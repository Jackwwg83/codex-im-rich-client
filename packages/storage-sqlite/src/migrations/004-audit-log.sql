-- 004-audit-log.sql — Phase 3 T6a
-- Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T6a
--
-- Write-through SQLite copy of the in-memory audit ring. Storage keeps
-- the event shape as opaque primitive columns; core/daemon own the
-- semantic interpretation and redaction policy.

CREATE TABLE IF NOT EXISTS audit_log (
  id              TEXT PRIMARY KEY NOT NULL,
  actor_user_id   TEXT,
  action          TEXT NOT NULL,
  target_key      TEXT,
  project_id      TEXT,
  codex_thread_id TEXT,
  codex_turn_id   TEXT,
  approval_id     TEXT,
  result          TEXT,
  metadata_json   TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON audit_log(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_approval
  ON audit_log(approval_id);
