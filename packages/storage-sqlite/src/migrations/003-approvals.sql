-- 003-approvals.sql — Phase 3 T5a
-- Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T5a
--
-- Durable approval snapshot storage for daemon restart, operator
-- inspection, and later audit/redaction tests. Storage keeps approval
-- fields opaque: no core/protocol types or method literals live here.

CREATE TABLE IF NOT EXISTS approvals (
  id                    TEXT PRIMARY KEY NOT NULL,
  app_server_request_id TEXT NOT NULL,
  kind                  TEXT NOT NULL,
  status                TEXT NOT NULL CHECK(status IN ('pending', 'resolved', 'expired', 'transport_lost')),
  target_platform       TEXT NOT NULL,
  target_chat_id        TEXT NOT NULL,
  target_thread_key     TEXT,
  target_topic_id       TEXT,
  codex_thread_id       TEXT,
  codex_turn_id         TEXT,
  title                 TEXT NOT NULL,
  body                  TEXT NOT NULL,
  risk_level            TEXT NOT NULL DEFAULT 'medium',
  requested_by_user_id  TEXT,
  decided_by_user_id    TEXT,
  decision              TEXT,
  expires_at            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  decided_at            TEXT,
  raw_json              TEXT
);

CREATE INDEX IF NOT EXISTS idx_approvals_status
  ON approvals(status);

CREATE INDEX IF NOT EXISTS idx_approvals_target
  ON approvals (
    target_platform,
    target_chat_id,
    COALESCE(target_thread_key, ''),
    COALESCE(target_topic_id, '')
  );
