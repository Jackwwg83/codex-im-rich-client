-- 008-thread-sessions.sql — Direct Use Completion / Phase 8 B2
-- Plan: docs/superpowers/plans/2026-05-03-direct-use-completion-plan.md §B2
--
-- Stores known real Codex App threads for an IM target. This table is
-- not an IM-only task model: every row maps to a real codex_thread_id.
-- thread_bindings remains the current project/thread pointer.

CREATE TABLE IF NOT EXISTS thread_sessions (
  id                TEXT PRIMARY KEY NOT NULL,
  target_platform   TEXT NOT NULL,
  target_chat_id    TEXT NOT NULL,
  target_thread_key TEXT,
  target_topic_id   TEXT,
  project_id        TEXT NOT NULL,
  codex_thread_id   TEXT NOT NULL,
  title             TEXT,
  status            TEXT NOT NULL CHECK(status IN ('open', 'archived')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_used_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_sessions_target_thread
  ON thread_sessions (
    target_platform,
    target_chat_id,
    COALESCE(target_thread_key, ''),
    COALESCE(target_topic_id, ''),
    codex_thread_id
  );

CREATE INDEX IF NOT EXISTS idx_thread_sessions_target_project_last_used
  ON thread_sessions (
    target_platform,
    target_chat_id,
    COALESCE(target_thread_key, ''),
    COALESCE(target_topic_id, ''),
    project_id,
    last_used_at DESC
  );
