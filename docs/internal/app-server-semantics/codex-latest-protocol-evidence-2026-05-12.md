# Codex Latest Protocol Evidence Report - 2026-05-12

Scope: evidence only. No Codex pin bump, generated protocol commit, or runtime
behavior change was made.

## Inputs

- Local repo pin: `codex-cli 0.128.0`
- Local version gate: `pnpm check:codex-version` passed for `0.128.0`
- Upstream source inspected: `openai/codex`
- Upstream commit inspected: `46f30d02828bd4c52827e5f0482a6f2a982cce5b`
- Upstream commit date: `2026-05-11 23:04:28 -0700`
- Upstream commit subject: `feat(sandbox): add Windows deny-read parity (#18202)`

## Thread Start / Resume / Fork Parameters

Evidence from upstream generated TypeScript and JSON schema:

| Params | Top-level `permissions` | `additionalWritableRoot` request path | Notable delta vs 0.128.0 pin |
| --- | --- | --- | --- |
| `ThreadStartParams` | absent | absent | adds `threadSource`; no permissions field |
| `ThreadResumeParams` | absent | absent | removes `excludeTurns` from generated schema |
| `ThreadForkParams` | absent | absent | adds `threadSource`; removes `excludeTurns` from generated schema |

Conclusion: do not implement `writableRoots` enforcement from IM config yet.
The upstream source still has permission-profile model declarations, but the
thread start/resume/fork request path needed by this client is not exposed in
the inspected generated schema.

## Method Surface Signals

Compared with the local `0.128.0` generated protocol:

| Surface | Local 0.128.0 | Upstream latest source | Impact |
| --- | --- | --- | --- |
| `thread/turns/list` client request | present | absent from generated `ClientRequest` schema | pin bump likely needs runtime/thread-history work |
| `process/outputDelta` notification | absent | present | output streaming support likely needs normalizer work |
| `process/exited` notification | absent | present | output streaming support likely needs normalizer work |
| `plugin/skill/read` client request | absent | present | plugin/skill controls can become more native after bump |
| `plugin/share/*` client requests | absent | present | plugin sharing surface can be mapped later |
| `windowsSandbox/readiness` client request | absent | present | Windows-only readiness path; not an IM launch blocker |
| `remoteControl/status/changed` notification | present | present | status-only handling remains aligned; do not implement remote-control transport |

## Existing Runtime Wrapper Risk

The largest observed break risk is `thread/turns/list`: the local runtime can
wrap it because it exists in the current generated `ClientRequest` union, while
the inspected upstream latest generated `ClientRequest` no longer exposes it.
A Codex pin bump should therefore be treated as blocked until a dedicated
implementation pass decides whether to replace, guard, or drop the native
turn-list path.

## Recommendation

Do not proceed to a Codex pin bump now.

Proceed only after a separate protocol-upgrade branch:

1. Runs the actual target Codex binary version, not just source inspection.
2. Regenerates protocol into an isolated branch or temporary worktree.
3. Updates runtime wrappers and semantic guards for the missing
   `thread/turns/list` path.
4. Adds normalizer support for `process/outputDelta` and `process/exited` if
   the target binary emits them.
5. Keeps `writable_roots` metadata-only unless `permissions` appears on a
   request type this client can call.
