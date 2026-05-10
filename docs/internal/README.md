# Internal documentation

Process documents kept for transparency and audit, not for first-time users.
Anything here is one of:

- phase plans, reviews, audits, and live-status under `phase-0/` … `phase-7/`;
- handoffs between phases under `handoffs/`;
- superpowers workflow plans and specs under `superpowers/`;
- release-readiness evidence under `release-readiness/`;
- live-smoke evidence and acceptance records under `ops-smoke/`;
- autonomous-loop runbook under `automation/`.

User-facing documentation lives at the parent level: `docs/user/`,
`docs/setup/`, `docs/maintainer/`, `docs/ops/` (runbooks only), and
`docs/architecture/` (decision records).

## Path references inside frozen documents

These documents were written before the 2026-05-10 docs reorg. Any path
of the form `docs/handoffs/X`, `docs/phase-N/X`, `docs/superpowers/X`,
`docs/release-readiness/X`, `docs/automation/X`, or
`docs/ops/{computer-use,dingtalk-live,keychain-launchd,lark-live,
live-im-acceptance,slack-live}-smoke.md` quoted inside a document under
this tree refers to the pre-reorg layout. To resolve such a path today,
substitute:

| Old path prefix              | New path prefix                  |
|------------------------------|----------------------------------|
| `docs/handoffs/`             | `docs/internal/handoffs/`        |
| `docs/phase-N/`              | `docs/internal/phase-N/`         |
| `docs/superpowers/`          | `docs/internal/superpowers/`     |
| `docs/release-readiness/`    | `docs/internal/release-readiness/` |
| `docs/automation/`           | `docs/internal/automation/`      |
| `docs/ops/<name>-smoke.md`   | `docs/internal/ops-smoke/<name>-smoke.md` |
| `docs/ops/live-im-acceptance.md` | `docs/internal/ops-smoke/live-im-acceptance.md` |

Frozen evidence content is intentionally left unchanged; we do not
rewrite history to make link checkers happy.
