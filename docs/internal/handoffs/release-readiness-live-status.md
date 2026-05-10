# Release Readiness Live Status

> Single source of truth while bringing Codex IM Rich Client from Phase 7
> complete to上线运行标准.
> **Last updated:** 2026-05-08 - JAC-171 remains the release-candidate baseline
> at `production-readiness-2026-05-03-r2`; subsequent enabled live IM
> acceptance for Telegram, Feishu/Lark, DingTalk, bounded Slack workspace use,
> and bounded local Chrome Computer Use provider evidence is tracked in
> `docs/handoffs/live-im-acceptance-status.md` and
> `docs/handoffs/direct-use-live-status.md`. GitHub Actions rows below describe
> workflow content/local evidence unless a specific GitHub run URL is attached.

---

## 1. Current State

- **Mode:** Release candidate complete; enabled Telegram / Feishu-Lark /
  DingTalk live IM acceptance complete in the follow-on live-acceptance track.
- **Plan:** `docs/superpowers/plans/2026-05-03-release-readiness-plan.md`.
- **Linear project:** Codex IM Rich Client Release Readiness.
- **Parent Linear issue:** JAC-166 - Release readiness parent -上线运行标准.
- **Current Linear issue:** none. JAC-171 is complete.
- **Branch:** `codex/release-readiness`.
- **Base tag:** `phase-7-extended-platforms-web-console-complete`.
- **Version:** `0.1.0-phase7`.
- **Release tag:** `production-readiness-2026-05-03-r2`.
- **Follow-on live acceptance tag:** `live-im-acceptance-2026-05-08`.
- **Handoff:** `docs/handoffs/2026-05-03-production-readiness.md`.
- **Next exact action:** continue direct-use hardening / Slack readiness from
  `docs/handoffs/direct-use-live-status.md` and Linear project
  `Codex IM Rich Client Direct Use & Slack Readiness`.

## 2. Production Readiness Target

- CI runs mandatory non-live gates on PR/push.
- Local release-readiness preflight verifies dry-run operational safety.
- Mac mini launch checklist covers install, status, logs, backup, smoke, and
  rollback.
- Live smokes stay explicit/env-gated and either default-skip or fail at an
  explicit operator gate without making network calls.
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
| JAC-166 | release readiness parent | complete |
| JAC-167 | plan + live status | complete |
| JAC-168 | GitHub Actions CI | complete |
| JAC-169 | production ops preflight command | complete |
| JAC-170 | operator launch checklist + rollback runbook | complete |
| JAC-171 | final review, handoff, tag | complete |

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

Latest JAC-168 CI gate:

| Gate | Result |
|---|---|
| `pnpm lint` | green: 308 files checked |
| `git diff --check` | green |
| CI content review | `.github/workflows/ci.yml` uses Node 24, pnpm 10.33.2, pinned `@openai/codex@0.128.0`, and non-live gates only |

Latest JAC-169 preflight gate:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --project unit scripts/release-readiness-check.test.mts scripts/keychain-launchd-smoke-doc.test.mjs` | green: 2 files, 5 passing |
| `pnpm release:check -- --skip-full-gates` | green: launchd dry-run, Keychain wrapper dry-run, SQLite backup proof, fake smokes, and default live gates/skips |
| `pnpm typecheck:tests` | green |
| `pnpm lint` | green: 310 files checked |

Latest JAC-170 docs gate:

| Gate | Result |
|---|---|
| `pnpm lint` | green: 310 files checked |
| `git diff --check` | green |

Final JAC-171 release gate:

| Gate | Result |
|---|---|
| `pnpm exec vitest run --project unit scripts/release-readiness-check.test.mts scripts/keychain-launchd-smoke-doc.test.mjs` | green: 2 files, 8 passing |
| `env TELEGRAM_LIVE=1 ... COMPUTER_USE_LIVE=1 pnpm release:check -- --skip-full-gates` | green: ambient live env scrubbed; default probes stayed gated/skipped |
| `pnpm release:check` | green: full CI-equivalent gates + operational dry-runs + fake smokes + default live gates/skips |
| `git diff --exit-code packages/codex-protocol` | green |
| `git diff --check` | green |

Final outside-voice review chain:

| File | Verdict | Result |
|---|---|---|
| `docs/release-readiness/final-review.md` | `APPROVE_WITH_CHANGES` | found one P1 ambient live-smoke env blocker |
| `docs/release-readiness/final-review-followup.md` | `GO_WITH_LOW_NITS` | confirmed P1 fixed by `16d11ca` |
| `docs/release-readiness/final-review-delta.md` | `GO_WITH_LOW_NITS` | confirmed P3 lazy setup fixed by `7052a8a`; JAC-171 may proceed to handoff/tag |

## 6. Compact / Resume

If resuming release-readiness work:

1. Read this file first.
2. Read `docs/superpowers/plans/2026-05-03-release-readiness-plan.md`.
3. Read `AGENTS.md` and
   `docs/automation/codex-app-autonomous-loop-runbook.md`.
4. Run `git status --short` and `git log --oneline -8`.
5. Continue from the current Linear issue when branch/HEAD/scope are clear.
