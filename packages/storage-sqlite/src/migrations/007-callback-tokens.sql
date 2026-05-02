-- 007-callback-tokens.sql — Phase 3 T6d / D34
-- Plan: docs/superpowers/plans/2026-05-02-phase-3-plan.md §16.2 T6d
--
-- Stores only the SHA-256-derived token hash. Raw callback token bytes
-- are held in process memory just long enough to render callback_data;
-- they never reach SQLite.

CREATE TABLE IF NOT EXISTS callback_tokens (
  token_hash       TEXT NOT NULL PRIMARY KEY,
  approval_id      TEXT NOT NULL,
  action           TEXT NOT NULL CHECK(action IN ('allow_once','allow_session','decline','abort')),
  callback_nonce   TEXT NOT NULL,
  target_platform   TEXT NOT NULL,
  target_chat_id    TEXT NOT NULL,
  target_thread_key TEXT,
  target_topic_id   TEXT,
  actor_kind       TEXT NOT NULL CHECK(actor_kind IN ('im','system')),
  actor_user_id    TEXT,
  actor_platform   TEXT,
  actor_reason     TEXT,
  msg_chat_id      TEXT,
  msg_message_id   TEXT,
  status           TEXT NOT NULL CHECK(status IN ('issued','bound','used','expired','revoked')),
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_callback_tokens_approval
  ON callback_tokens(approval_id);

CREATE INDEX IF NOT EXISTS idx_callback_tokens_status_expires
  ON callback_tokens(status, expires_at);
