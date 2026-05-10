Verdict: APPROVE_WITH_CHANGES

Findings:
- [P1] [db-backup.ts](<repo>/packages/cli/src/db-backup.ts:101) — SQLite backup is not WAL-safe  
  Explanation: `backupDatabase()` copies only the main DB file, but storage opens SQLite with `journal_mode = WAL` in [database.ts](<repo>/packages/storage-sqlite/src/database.ts:55). A live daemon can have committed state in `state.db-wal`, so this backup can silently miss recent callback/session data. Current tests use a dummy file copy path, not an open WAL database.  
  Required change: use SQLite’s online backup path or a safe checkpoint/copy strategy, and add a WAL-mode test proving committed rows survive the backup.

- [P1] [adapter.ts](<repo>/packages/im-telegram/src/adapter.ts:175) — Telegram inbound is not paused before shutdown settlement  
  Explanation: `Daemon.stop()` calls `pauseInbound()` when present before failing pending approvals as `transport_lost` in [daemon.ts](<repo>/packages/daemon/src/daemon.ts:373), but `TelegramChannelAdapter` has no pause path. Its emitters still invoke handlers without checking paused/stopped state in [adapter.ts](<repo>/packages/im-telegram/src/adapter.ts:323). That leaves a shutdown race where queued Telegram messages/actions can enter routing while broker shutdown settlement is in progress.  
  Required change: implement adapter-level inbound pausing/stopped guards, make post-pause/post-stop events drop closed, and add message/action tests for that behavior.

- [P2] [install-launchd.mjs](<repo>/bin/install-launchd.mjs:76) — Live launchd install can render an unloadable service  
  Explanation: the installer writes/loads a plist pointing at `~/.codex-im-bridge/bin/load-and-run.sh`, but it does not install that wrapper, verify it exists, or verify the daemon entry exists/executable. The smoke docs dry-run the repo-local wrapper, which does not prove the launchd `ProgramArguments` path will work.  
  Required change: either install/copy the wrapper and daemon entry with expected modes, or fail closed with a clear error if those paths are missing. Update tests/docs to cover the live path.

- [P2] [callback-tokens.ts](<repo>/packages/storage-sqlite/src/callback-tokens.ts:340) — Issued callback tokens are never expired by prune  
  Explanation: `pruneExpired()` only marks `bound` tokens expired. If `sendCard()` throws, daemon intentionally leaves rows as `issued`, so repeated transport failures can leave unbounded stale issued rows. This fails closed for approvals, but it weakens D33’s audit/retention story.  
  Required change: expire/prune `issued` rows by `expires_at`, or explicitly revoke/rollback them on send failure, with tests for the failure path.

- [P2] [daemon-status.ts](<repo>/packages/cli/src/daemon-status.ts:53) — Status CLI has no producer in daemon code  
  Explanation: the CLI reads `~/.codex-im-bridge/daemon-status.json`, but I did not find daemon code that writes that snapshot. As shipped, `codex-im daemon status` is a formatter for a hypothetical file rather than an operational status surface.  
  Required change: add a daemon-side snapshot writer with redaction/atomic replace semantics, or document T32 as reader-only and move the writer to a tracked follow-up before tag expectations depend on it.

Open Questions:
- Is there an external packaging step that creates `~/.codex-im-bridge/bin/daemon.mjs` and `load-and-run.sh`? If yes, the Phase 3 ops docs should name it explicitly.
- Is daemon status snapshot production intentionally deferred beyond Phase 3? If so, make that explicit in the handoff and TODOs.

Positive Checks:
- No P0 findings.
- I did not see Phase 4+ Lark, DingTalk, Computer Use production flow, web console, public listener, OpenClaw, CLI/TUI parsing, or chat-abstraction drift.
- Boundary spot checks passed: storage has no upper-layer imports, channel-core has no runtime core/runtime/client imports, and Telegram wire details stay in `packages/im-telegram`.
- Approval callback flow largely matches D33-D42: raw callback data is the source of truth, message refs are validated before resolve, broker success precedes `bound -> used`, and policy denial goes through broker decline.
- Telegram smoke gates default closed and require explicit live/real env flags; token output paths use redaction.

Gate / Scope Notes:
- I did not rerun the full `pnpm` gates because this review ran in a read-only sandbox. The handoff reports green `typecheck`, `typecheck:tests`, `test`, `lint`, and `protocol:check`.
- Current HEAD is docs checkpoint `36d8903`; latest code commit in scope is `2b42eff`.
- The working tree contains untracked review/stdout-stderr artifacts. Keep those out of the Phase 3 tag, especially anything with token-shaped test text.
