-- 002-thread-bindings.sql — Phase 3 T4a
-- Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T4a
--
-- Stores IM target -> project -> Codex thread bindings for the
-- persistent SessionRouter path. Target identity is stored as four
-- explicit opaque columns, not as a parsed protocol/core type and not
-- as a delimiter-split target_key. This preserves the D27 storage
-- boundary and avoids optional-field encoding ambiguity.

CREATE TABLE IF NOT EXISTS thread_bindings (
  id                TEXT PRIMARY KEY NOT NULL,
  target_platform   TEXT NOT NULL,
  target_chat_id    TEXT NOT NULL,
  target_thread_key TEXT,
  target_topic_id   TEXT,
  project_id        TEXT NOT NULL,
  codex_thread_id   TEXT,
  cwd               TEXT NOT NULL,
  default_model     TEXT,
  active_turn_id    TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_bindings_target
  ON thread_bindings (
    target_platform,
    target_chat_id,
    COALESCE(target_thread_key, ''),
    COALESCE(target_topic_id, '')
  );

CREATE INDEX IF NOT EXISTS idx_thread_bindings_project
  ON thread_bindings(project_id);
