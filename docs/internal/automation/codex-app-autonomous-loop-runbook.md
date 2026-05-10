# Codex App Autonomous Loop Runbook

This runbook is the control document for long-running autonomous development
sessions on Codex IM Rich Client.

The loop goal is to complete as much of the project as safely possible by using
Linear as the execution queue, repo docs as the source of truth, and GPT Pro as
an external technical advisor when technical uncertainty appears.

This runbook does not weaken project redlines in `AGENTS.md` or `CLAUDE.md`.
If there is a conflict, the stricter rule wins.

## Source Of Truth

- Linear project: `Codex IM Rich Client`
- Current parent issue: read the active phase parent from Linear and the latest
  `docs/internal/handoffs/phaseN-live-status.md` file. Historical examples may still
  mention JAC-8 for Phase 3; do not treat that as current after later phases.
- Current live status: read the latest active `docs/internal/handoffs/phaseN-live-status.md`
  file before each issue.
- Current phase plan: read the matching active phase plan under
  `docs/internal/superpowers/plans/` before each issue.
- Project rules: `AGENTS.md` and `CLAUDE.md`
- Data model: `08-DATA-MODEL.md`
- Historical roadmap: `09-ROADMAP.md`
- Backlog index: `TODOS.md`

Linear is the execution board. Repo docs remain implementation source of truth.

## Core Product Boundary

This project is a native Codex App Server IM rich client.

It is not:

- an OpenClaw plugin
- a Codex CLI/TUI wrapper
- a terminal-output parser
- a generic LLM chat bot
- a public App Server proxy

Architecture:

```text
IM Adapter -> ChannelAdapter -> Core -> CodexRuntime -> AppServerClient -> codex app-server
```

## Loop Objective

Default objective for an overnight autonomous session:

1. Complete as many unblocked Linear issues as possible.
2. Work on exactly one Linear issue at a time.
3. Keep each issue to one focused behavior, one focused commit, and one
   completion report.
4. Keep the working tree clean between issues.
5. Update Linear and the active `docs/internal/handoffs/phaseN-live-status.md` at task
   boundaries.
6. Consult GPT Pro automatically for technical ambiguity instead of asking the
   human operator for technical advice.

The human operator is not expected to make routine technical decisions.
The human operator is still required for operator-gated actions listed below.

## Phase Queues

The active queue is the current Linear parent/child chain plus the active phase
live-status file. Historical Phase 3 queue is retained below only for recovery
from old logs.

### Historical Phase 3 Queue

Start with the next exact issue:

```text
JAC-14
```

Then follow dependency order:

```text
JAC-30
JAC-31
JAC-32
JAC-33
JAC-34
JAC-35
JAC-36
JAC-37
JAC-17
JAC-16
JAC-18 children if split and unblocked
JAC-38
JAC-39
JAC-40
JAC-41
JAC-42
JAC-43
JAC-44
JAC-45
JAC-46
JAC-47
JAC-48
JAC-49
JAC-50
JAC-51
JAC-52
JAC-53
```

Before entering these areas, consult GPT Pro or stop for operator gate as
appropriate:

- `JAC-54` or any real Telegram adapter implementation
- `JAC-22` launchd install/uninstall
- `JAC-23` live Telegram smokes
- Phase 4/5/6/7+
- any task involving real secrets, Keychain, real Telegram token, launchd
  installation, live external calls, Computer Use, or irreversible local/system
  operations

## Per-Issue Start Protocol

Before writing code for each issue:

1. Read the Linear issue.
2. Read the current phase parent issue.
3. Read the latest active `docs/internal/handoffs/phaseN-live-status.md`.
4. Read the matching current phase plan under `docs/internal/superpowers/plans/`.
5. Run:

```bash
git status --short
git log --oneline -8
pnpm typecheck
pnpm test
pnpm lint
pnpm protocol:check
```

6. Output an Issue Start Report:

```text
Linear issue id/title:
Branch/HEAD:
Exact goal:
Allowed files:
Forbidden files/work:
First failing test:
Exit criteria:
Risk review:
SAFE_TO_START / BLOCKED / NEED_GPT_ADVICE / NEED_OPERATOR_AUTHORIZATION
```

In unattended loop mode, if the issue is clearly `SAFE_TO_START`, continue
without waiting for the human operator.

If it is not clearly safe, consult GPT Pro using the consultation protocol below
unless the issue requires operator authorization.

If context recovery or auto-compaction occurs during a human-authorized
unattended loop, output the recovery report to the log and continue when the
state is clearly safe. Do not wait for a non-technical product approval after a
clean recovery. Use GPT Pro for technical uncertainty and use reversible
commits/branches/tests to contain risk.

## Implementation Protocol

For each executable issue:

1. Use TDD where practical.
2. Write the first failing test before implementation unless the issue is
   docs-only or planning-only.
3. Implement the minimum code to pass the current issue.
4. Do not start the next Linear issue in the same code step.
5. Run targeted tests after the focused change.
6. Run full gates at issue completion:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm protocol:check
```

7. Update the active `docs/internal/handoffs/phaseN-live-status.md` when current task,
   completed tasks, next task, HEAD, or gate state changes.
8. Commit one focused commit.
9. Update Linear with a completion report if Linear write tools are available.

## Completion Report Format

Each issue completion report must include:

```text
Linear issue completed:
Commit SHA:
Files changed:
Tests added/updated:
Gate results:
Redline check:
Drift check:
Next recommended issue:
Loop decision: CONTINUE / CONSULT_GPT / OPERATOR_GATE / STOP_FOR_REVIEW
```

## GPT Pro Consultation Protocol

Use the existing GPT Pro conversation when technical ambiguity appears:

```text
https://chatgpt.com/c/69f1490c-4858-8398-921d-e5cca99df2b9
```

GPT Pro is an advisor, not an authority that can override project redlines,
tool safety rules, or operator-gated actions.

Consult GPT Pro automatically when:

- any gate fails twice
- the fix would modify files outside the current issue scope
- behavior may belong to a future issue
- plan, repo, and Linear disagree
- protocol or method-name uncertainty appears
- approval/callback/messageRef/security behavior needs a decision
- a test failure has multiple plausible fixes
- scope drift is detected
- auto-compaction happened and state is not clearly safe
- crossing from storage/config/core into daemon approval flow
- crossing from daemon fake tests into real Telegram
- crossing from Phase 3 to Phase 4+

### Consultation Packet

Paste only sanitized technical context.

````text
BEGIN CODEX LOOP CONSULTATION

You are GPT Pro acting as technical advisor for the Codex IM Rich Client
autonomous loop.

Project:
Codex IM Rich Client — native Codex App Server IM rich client.

Current Linear issue:
- ID:
- Title:
- URL:
- Parent:
- Milestone:
- Status:

Current repo state:
- Branch:
- HEAD:
- Last commits:
- Working tree status:
- Files changed:

Relevant source-of-truth docs read:
- AGENTS.md / CLAUDE.md:
- docs/internal/handoffs/phase3-live-status.md:
- docs/internal/superpowers/plans/2026-05-02-phase-3-plan.md section:
- Linear issue description:

Current task goal:
...

Allowed files:
...

Forbidden files / forbidden work:
...

What happened:
...

Commands run and results:
```text
paste sanitized command outputs here
```

Relevant diff, sanitized:

```diff
paste only relevant diff
do not include secrets, tokens, private env values, cookies, or Keychain data
```

Current options:
A. ...
B. ...
C. ...

Question:
Please decide what I should do next.

Important redlines:
- No Codex CLI/TUI wrapper.
- No terminal output parsing as product protocol.
- No public App Server listener.
- No Computer Use production flow unless approved phase.
- No raw approvalId|kind|nonce callback_data.
- No raw callback token persistence.
- messageRef must be validated before broker.resolve.
- Approval decisions must go through ApprovalBroker.resolve.
- SecurityPolicy must run before rendering actionable buttons.
- Unknown, unauthorized, stale, expired, replayed, malformed, transport-lost,
  or security-uncertain paths must fail closed.
- Do not leak secrets.

Please output:
1. Verdict: CONTINUE / PATCH_PLAN_FIRST / REVERT / SPLIT_ISSUE /
   NEED_OPERATOR_AUTHORIZATION / BLOCKED.
2. Recommended option.
3. Exact files allowed to change.
4. Exact next prompt I should follow.
5. Tests/gates to run.
6. Whether I may continue the loop after this issue.

END CODEX LOOP CONSULTATION
````

### After GPT Pro Replies

Before applying advice:

```text
I received GPT Pro consultation.

1. Summarize GPT Pro's verdict.
2. List exact allowed files.
3. List exact commands to run.
4. Confirm no secrets are involved.
5. Confirm whether operator authorization is required.
```

Then apply only the approved next step.

After applying:

- run targeted tests
- run full gates if the issue is complete
- update live status if needed
- commit one focused commit if complete
- update Linear if available
- continue loop only if GPT Pro allowed continuation and no operator gate is hit

## Redaction Rules

Never paste these into GPT Pro, Linear, docs, logs, or commits:

- Telegram bot token
- `.env` content
- Keychain content
- browser cookies
- private keys
- API keys / access tokens / OAuth tokens
- full plist containing a token
- unredacted real user IDs if not strictly necessary
- long logs that may contain secrets

Allowed after review/redaction:

- sanitized diff
- failing test output
- Linear issue id/title
- plan section
- git status
- gate results
- stack trace after redaction
- small code excerpts relevant to the issue

If unsure whether data is sensitive, redact it or consult without including it.

## Operator-Gated Actions

Do not ask GPT Pro to authorize these. GPT Pro may advise, but the human
operator must explicitly authorize the final action at action time:

- using, revealing, or transmitting a real Telegram bot token
- writing tokens/secrets to environment, Keychain, Linear, docs, fixtures, or
  logs
- installing, unloading, or changing launchd agents
- running live Telegram smoke
- running real Codex plus real Telegram smoke
- triggering production Computer Use
- deleting local or cloud data
- destructive git operations such as force push or reset hard
- public network listener
- external publishing, deployment, or uploading private project data
- creating persistent external access credentials

When operator authorization is required, create an Operator Authorization
Request with:

```text
Action:
Why needed:
Exact command or UI action:
Data transmitted or changed:
Rollback:
Risk:
```

Then stop until the operator explicitly approves that action.

## Auto-Compaction Recovery

After auto-compaction, manual compact, resume, interruption, or context loss:

1. Do not continue implementation.
2. Enter Recovery Mode.
3. Read:

```text
AGENTS.md
CLAUDE.md
latest active docs/internal/handoffs/phaseN-live-status.md
matching current phase plan under docs/internal/superpowers/plans/
current Linear issue
current phase parent Linear issue
```

4. Run:

```bash
git status --short
git diff --stat
git diff --name-only
git log --oneline -8
pnpm typecheck
pnpm test
pnpm lint
pnpm protocol:check
```

5. Output:

```text
Current issue:
Branch/HEAD:
Changed files:
Whether current changes are within issue scope:
Gates:
Suspected drift:
SAFE_TO_CONTINUE / NEED_GPT_ADVICE / NEED_REVERT / BLOCKED
```

If not clearly `SAFE_TO_CONTINUE`, consult GPT Pro using the consultation
template.

## Phase Crossing Rules

Phase 3 may implement:

- storage/config/core prerequisites
- daemon fake/test path
- Telegram adapter package and unit/contract fixtures

Phase 3 must not run unattended:

- real Telegram bot
- real Telegram token
- live Telegram smoke
- real Codex plus real Telegram smoke
- launchd installation or removal
- production Computer Use

Phase 4/5/6/7+ should be planned and split in Linear before implementation.
Do not cross into those phases without a reviewed plan and explicit phase gate.

## Linear Update Format

At issue completion, add a Linear comment:

```text
Completed.

Commit:
Files changed:
Tests:
Gates:
Redline check:
Drift:
Next issue:
Loop decision:
```

If blocked:

```text
Blocked.

Reason:
Evidence:
Options:
GPT Pro consulted:
Operator authorization needed:
Recommended next step:
```

## Current Known State At Runbook Creation

- Date: 2026-05-02
- Branch: `phase-3-implementation`
- HEAD: `f493360`
- Next exact issue: `JAC-14`
- Tracked working tree: clean
- Known untracked files:
  - `.claude/scheduled_tasks.lock`
  - `AGENTS.md`
  - `docs/internal/phase-2/codex-review-t18-t22.stderr`
  - `docs/internal/phase-2/codex-review-t24-integrated.stderr`
  - `docs/internal/phase-3/plan-v1-codex-review.stderr`
  - `docs/internal/phase-3/plan-v2.1-codex-round2.stderr`
  - `docs/internal/phase-3/plan-v2.2-codex-round3.stderr`
  - `docs/internal/phase-3/plan-v2.3-codex-round4.stderr`
