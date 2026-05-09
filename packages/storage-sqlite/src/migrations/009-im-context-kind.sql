-- 009-im-context-kind.sql — IM project/conversation entry alignment
-- Design: docs/superpowers/specs/2026-05-09-im-project-conversation-entry-design.md
--
-- Project is now an optional IM selector, while conversation maps to a
-- Codex App Server thread. Default App Server conversations must not be
-- forced into a fake project_id, so the current binding/session tables
-- get explicit context metadata and nullable project_id.

DROP INDEX IF EXISTS idx_thread_bindings_target;
DROP INDEX IF EXISTS idx_thread_bindings_project;

ALTER TABLE thread_bindings RENAME TO thread_bindings_old;

CREATE TABLE thread_bindings (
  id                TEXT PRIMARY KEY NOT NULL,
  target_platform   TEXT NOT NULL,
  target_chat_id    TEXT NOT NULL,
  target_thread_key TEXT,
  target_topic_id   TEXT,
  context_kind      TEXT NOT NULL DEFAULT 'configured_project'
                    CHECK(context_kind IN (
                      'configured_project',
                      'codex_project',
                      'app_default',
                      'native_thread'
                    )),
  project_id        TEXT,
  project_label     TEXT,
  codex_thread_id   TEXT,
  cwd               TEXT NOT NULL,
  default_model     TEXT,
  active_turn_id    TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

INSERT INTO thread_bindings (
  id,
  target_platform,
  target_chat_id,
  target_thread_key,
  target_topic_id,
  context_kind,
  project_id,
  project_label,
  codex_thread_id,
  cwd,
  default_model,
  active_turn_id,
  created_at,
  updated_at
)
SELECT
  id,
  target_platform,
  target_chat_id,
  target_thread_key,
  target_topic_id,
  'configured_project',
  project_id,
  project_id,
  codex_thread_id,
  cwd,
  default_model,
  active_turn_id,
  created_at,
  updated_at
FROM thread_bindings_old;

DROP TABLE thread_bindings_old;

CREATE UNIQUE INDEX idx_thread_bindings_target
  ON thread_bindings (
    target_platform,
    target_chat_id,
    COALESCE(target_thread_key, ''),
    COALESCE(target_topic_id, '')
  );

CREATE INDEX idx_thread_bindings_project
  ON thread_bindings(project_id);

DROP INDEX IF EXISTS idx_thread_sessions_target_thread;
DROP INDEX IF EXISTS idx_thread_sessions_target_project_last_used;

ALTER TABLE thread_sessions RENAME TO thread_sessions_old;

CREATE TABLE thread_sessions (
  id                TEXT PRIMARY KEY NOT NULL,
  target_platform   TEXT NOT NULL,
  target_chat_id    TEXT NOT NULL,
  target_thread_key TEXT,
  target_topic_id   TEXT,
  context_kind      TEXT NOT NULL DEFAULT 'configured_project'
                    CHECK(context_kind IN (
                      'configured_project',
                      'codex_project',
                      'app_default',
                      'native_thread'
                    )),
  project_id        TEXT,
  project_label     TEXT,
  cwd               TEXT,
  codex_thread_id   TEXT NOT NULL,
  title             TEXT,
  status            TEXT NOT NULL CHECK(status IN ('open', 'archived')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_used_at      TEXT NOT NULL
);

INSERT INTO thread_sessions (
  id,
  target_platform,
  target_chat_id,
  target_thread_key,
  target_topic_id,
  context_kind,
  project_id,
  project_label,
  cwd,
  codex_thread_id,
  title,
  status,
  created_at,
  updated_at,
  last_used_at
)
SELECT
  id,
  target_platform,
  target_chat_id,
  target_thread_key,
  target_topic_id,
  'configured_project',
  project_id,
  project_id,
  NULL,
  codex_thread_id,
  title,
  status,
  created_at,
  updated_at,
  last_used_at
FROM thread_sessions_old;

DROP TABLE thread_sessions_old;

CREATE UNIQUE INDEX idx_thread_sessions_target_thread
  ON thread_sessions (
    target_platform,
    target_chat_id,
    COALESCE(target_thread_key, ''),
    COALESCE(target_topic_id, ''),
    codex_thread_id
  );

CREATE INDEX idx_thread_sessions_target_project_last_used
  ON thread_sessions (
    target_platform,
    target_chat_id,
    COALESCE(target_thread_key, ''),
    COALESCE(target_topic_id, ''),
    project_id,
    last_used_at DESC
  );
