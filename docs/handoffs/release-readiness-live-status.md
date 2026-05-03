# Release Readiness Live Status

> Single source of truth while bringing Codex IM Rich Client from Phase 7
> complete to上线运行标准.
> **Last updated:** 2026-05-03 - JAC-167 plan/live-status complete; JAC-168
> CI is next.

---

## 1. Current State

- **Mode:** Release readiness / production hardening.
- **Plan:** `docs/superpowers/plans/2026-05-03-release-readiness-plan.md`.
- **Linear project:** Codex IM Rich Client Release Readiness.
- **Parent Linear issue:** JAC-166 - Release readiness parent -上线运行标准.
- **Current Linear issue:** JAC-168 - RR T1 GitHub Actions CI for mandatory gates.
- **Branch:** `codex/release-readiness`.
- **Base tag:** `phase-7-extended-platforms-web-console-complete`.
- **Version:** `0.1.0-phase7`.
- **Next exact action:** implement `.github/workflows/ci.yml` for mandatory
  non-live gates.

## 2. Production Readiness Target

- CI runs mandatory non-live gates on PR/push.
- Local release-readiness preflight verifies dry-run operational safety.
- Mac mini launch checklist covers install, status, logs, backup, smoke, and
  rollback.
- Live smokes stay explicit/env-gated/default-skip.
- No secret material appears in docs, fixtures, logs, SQLite, Linear, or review
  packets.
- Final outside-voice review clears P0/P1 before production-readiness tag.

## 3. Active Redlines

- No public listener.
- No live external call by default.
- No Keychain write by default.
- No launchd install/uninstall by default.
- No approval bypass.
- No raw callback token persistence or display.
- No generic chat abstraction replacing App Server rich semantics.
- No implicit Computer Use.

## 4. Linear Queue

| Issue | Scope | Status |
|---|---|---|
| JAC-166 | release readiness parent | in progress |
| JAC-167 | plan + live status | complete |
| JAC-168 | GitHub Actions CI | current |
| JAC-169 | production ops preflight command | todo |
| JAC-170 | operator launch checklist + rollback runbook | todo |
| JAC-171 | final review, handoff, tag | todo |

## 5. Current Gate Evidence

Baseline from Phase 7 tag gate:

| Gate | Result |
|---|---|
| `pnpm typecheck` | green |
| `pnpm typecheck:tests` | green |
| `pnpm test` | green: 136 files, 1237 passing, 1 skipped |
| `pnpm lint` | green |
| `pnpm protocol:check` | green |
| `git diff --check phase-6-computer-use-complete` | green |

Release-readiness gates will be re-run per issue before commit.

Latest JAC-167 docs gate:

| Gate | Result |
|---|---|
| `pnpm lint` | green: 308 files checked |
| `git diff --check` | green |

## 6. Compact / Resume

If resuming release-readiness work:

1. Read this file first.
2. Read `docs/superpowers/plans/2026-05-03-release-readiness-plan.md`.
3. Read `AGENTS.md` and
   `docs/automation/codex-app-autonomous-loop-runbook.md`.
4. Run `git status --short` and `git log --oneline -8`.
5. Continue from the current Linear issue when branch/HEAD/scope are clear.
