# Phase 3 T1-T36 Final Review Response

Generated: 2026-05-02  
Review: `docs/phase-3/impl-t1-t36-final-codex-review.md`  
Verdict: APPROVE_WITH_CHANGES

## Summary

The final Codex outside-voice review found 0 P0, 2 P1, and 3 P2 issues. All findings are closed at HEAD `eb05753`.

## Finding Closure

| Review finding | Severity | Fix commit | Closure |
|---|---:|---|---|
| SQLite backup copied only the main DB file and was not WAL-safe | P1 | `28adc64` | `backupDatabase()` now uses SQLite online backup via `better-sqlite3`; the test keeps a WAL-mode database open and proves committed rows survive backup. |
| Telegram inbound was not paused before shutdown settlement | P1 | `f57acc0` | `TelegramChannelAdapter.pauseInbound()` drops message/action events after pause and after stop; contract and raw event tests cover the closed path. |
| launchd install could write/load a plist pointing at missing runtime paths | P2 | `938a917` | Non-dry-run install now validates wrapper, daemon entry, and node binary before plist write/load; tests prove missing paths fail closed. |
| stale `issued` callback tokens were never expired by prune | P2 | `0b0eb98` | `CallbackTokenRepository.pruneExpired()` expires both `issued` and `bound` rows by `expires_at`, while preserving used rows. |
| daemon status CLI had no daemon-side producer | P2 | `eb05753` | Daemon can write token-redacted local status snapshots atomically after startup; daemon and status writer tests cover the producer. |

## Gate Result After Fixes

All 5 Phase 3 gates passed at `eb05753`:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 99 files, 970 passing, 1 skipped |
| `pnpm lint` | green: 222 files checked |
| `pnpm protocol:check` | green: 234 schema files canonical |

## Next Task

Proceed to JAC-64 / T39-T40: create the Phase 3 to Phase 4 handoff and execute the Phase 3 tag gate.
