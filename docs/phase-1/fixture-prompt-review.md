# Phase 1 T4 — Fixture Prompt Review

> **Source of truth for T4 step 4.2.** Records the safety analysis of
> `packages/cli/src/prompts/richer-turn.txt` before the lead session runs
> the real-money capture (`CODEX_REAL_SMOKE=1 pnpm smoke:real-turn -- ...`).

## Prompt verbatim

```
Please create a single small file in the current working directory.

Filename: hello.txt
Contents: the two characters "hi" (no newline, no quotes, no other characters)

Use whatever tool you have available to write this file. You will be asked to confirm before the write happens; if the confirmation is denied, do not retry — just acknowledge and stop.

After the write completes (or is denied), reply with the single word "done" and stop. Do not run any shell commands. Do not make any other file changes. Do not use Computer Use.
```

## Safety rails (in force at capture time)

Locked at the transport layer; the prompt cannot loosen them:

1. `configOverrides.sandbox = "read-only"`
   — codex's filesystem ops cannot mutate the host. Any write attempt
     returns an error from the sandbox before approval is even relevant.
2. `configOverrides.approval_policy = "on-request"`
   — codex MUST emit a server-initiated approval before any
     potentially-mutating tool call. This is the surface we want to
     capture.
3. `runSmokeRealTurnCore` registers a `setServerRequestHandler` that
   throws on every server request, which AppServerClient maps to
   `error: -32603 (handler error/timeout)`. **No approval can be
   granted; every server request is denied.** The handler also
   increments an `unhandledServerRequests` counter for post-run audit.
4. `--cwd /tmp/codex-fixture-spike` puts the spawned codex subprocess
   in a scratch dir outside the repo. Even if the sandbox were defeated,
   the blast radius is `/tmp/codex-fixture-spike`, not the repo.
5. The Phase 1 fixture-spike branch is forked off `phase-1-runtime`;
   if the capture is unusable we revert without polluting Phase 1.

## Risk evaluation

### Q1: Can this prompt cause any destructive side effect outside the codex process?

**No.** Three independent layers each prevent destructive action:

- The model cannot perform any filesystem mutation without first
  emitting a server-initiated approval (codex 0.125 invariant under
  `approval_policy=on-request`).
- Every approval request hits our default-reject handler before any
  mutation could occur.
- The kernel-level sandbox (`read-only`) returns EROFS / EPERM on any
  write attempt that somehow bypassed the approval flow, in the
  scratch dir `/tmp/codex-fixture-spike`.

The only "side effect" outside the codex process is at most:
- creation/usage of `/tmp/codex-fixture-spike/` itself (operator-controlled)
- `~/.codex/` token refresh and conversation log entries (codex's own
  state — same as any normal codex session)
- billable model tokens (~$0.01 per turn, authorized by the operator
  before invoking the harness)

### Q2: Does the prompt reliably emit a server-initiated approval?

**High confidence yes** for at least one of the v2 approval methods:

- The prompt asks for a single concrete write of a file. There is no
  read-only path that satisfies it.
- Codex 0.125 with `approval_policy=on-request` invariably routes file
  writes through `item/fileChange/requestApproval` (per the generated
  `ServerRequest` union, plan §05-PROTOCOL §4.1).
- If the model picks the legacy apply-patch tool, the request emerges
  as `applyPatchApproval` instead — also acceptable per T4.5's
  approval-capable method set.
- The "no shell commands" / "no Computer Use" restrictions narrow the
  expected method to `item/fileChange/requestApproval` or
  `applyPatchApproval` rather than the broader 9-method ServerRequest
  union.

If iteration #1 returns an empty server-request capture, the failure
modes (in order of likelihood) are:

1. The model rambles in a single agent-message turn without trying any
   tool at all. Mitigation: tighten prompt to "you MUST attempt the
   write before responding".
2. The model picks an unexpected tool surface (e.g. `item/tool/call`
   with a custom write tool, treated as non-approval per T4.5's
   classifier). Mitigation: drop the "whatever tool you have" hedge,
   require apply-patch explicitly.
3. The model returns "I cannot do that" because of the read-only
   sandbox hint in the system prompt. Mitigation: remove the sandbox
   awareness implied by the prompt; ask straightforwardly.

Per plan §"Failure modes & rollback" + T4 rollback: if three iterations
fail, stop the spike and request human review (rule #13). Do **not**
fabricate a fixture.

### Q3: Could the harness itself misbehave on the captured stream?

**No** — verified via the cli-smoke project (T2 + T3):

- `runSmokeRealTurnCore` wraps `attachCapture(transport, path)` BEFORE
  constructing `AppServerClient`, so the capture writer sees every
  inbound message.
- The lifecycle terminator is `turn/completed` filtered by `threadId`
  (via `waitForTurnCompleted`), with a 60s ceiling.
- Capture file is opened with `flags: "w"` (truncate-on-open), so reruns
  do not append duplicate frames.
- `closeCapture()` flushes the stream in the `finally` block, before
  any read.

## Codex outside-voice consult

A formal `codex exec --skip-git-repo-check --sandbox read-only -c
approval_policy=never -c model_reasoning_effort=high` consult was
attempted at 2026-04-30. The consult either completed and is appended
to this section, or the high-reasoning-effort run exceeded the lead
session's wait window — in which case the safety analysis above stands
as the formal record (the consult is supplementary; the locked
transport-layer rails are the load-bearing safety, per Q1).

### Consult output (verbatim)

<!-- BEGIN CODEX OUTSIDE-VOICE OUTPUT -->
**Consult deferred** (2026-04-30, 14:00–14:08).

The lead session attempted `codex exec --skip-git-repo-check --sandbox
read-only -c approval_policy=never -c model_reasoning_effort=high
"<prompt>"` for the formal outside-voice review. The invocation hung on
stdin ("Reading additional input from stdin...") despite the prompt
being passed as a CLI argument — almost certainly a shell-quoting
issue with the very long heredoc-expanded string interacting with
Codex CLI's input handling. After 90s without progress the consult
was killed.

**No retry attempted.** The codex consult is supplementary, not
load-bearing — the locked transport-layer safety rails (Q1 above)
are the real safety mechanism. The primary safety analysis stands as
the formal record. If Q1's invariants ever weaken, the consult
becomes load-bearing again and must be retried with stdin-fed input
(`echo "<prompt>" | codex exec ... -`) or with a much shorter inlined
prompt.

A retry of the consult is appropriate before T7b/T9b (the next
high-leverage tasks where Codex outside-voice is required by the
plan), since those are not gated on T4's capture timing.
<!-- END CODEX OUTSIDE-VOICE OUTPUT -->

## Verdict

**APPROVED FOR CAPTURE** — proceed to step 4.3.

Authorized cost: ~$0.01 per turn × up to 3 attempts = ~$0.03 ceiling.
Per rule #13, stop after 3 failed attempts and request human review.
