# @codex-im/cli

Phase 0 surface: two smoke commands. Both are **operator-only** — never invoked
by `pnpm test`, `pnpm test:unit`, or `pnpm test:contract`.

## `pnpm smoke:app-server` — initialize-only

```bash
CODEX_SMOKE=1 pnpm smoke:app-server
```

Spawns real `codex app-server`, completes the initialize handshake (JSONL +
JSON-RPC lite), then shuts down cleanly. **No model call. No thread. No turn.**

Verifies:
- codex CLI on PATH and spawnable
- JSONL transport round-trips
- handshake returns valid `InitializeResponse` (`userAgent`, `codexHome`,
  `platformFamily`, `platformOs`)
- clean shutdown — no zombie subprocess

Without `CODEX_SMOKE=1`, exits 1 with an error message. This guards against
accidental subprocess spawning during default test runs.

## `pnpm smoke:real-turn` — end-to-end lifecycle (gated)

```bash
CODEX_REAL_SMOKE=1 pnpm smoke:real-turn
```

**Triggers a real model call. Costs ~$0.01 typical.** Run only after:
- `codex login` completed
- model quota verified
- you understand the operator-only nature of this command

Verifies the FULL Phase 0 stack:
1. spawn `codex app-server`
2. initialize handshake
3. `thread/start`
4. `turn/start` with the harmless prompt (see `src/prompts/harmless-turn.txt`)
5. `turn/completed` notification arrives within 60s
6. no unhandled server-initiated requests leak
7. no command/file/Computer-Use approvals accepted
8. transport closes cleanly

### Capture flags (Phase 1 T2)

Three optional flags drive the fixture spike (T4) without changing default
behavior. Pass them after a `--`:

```bash
# Capture inbound JSONL frames; replace the harmless prompt; sandbox the
# codex subprocess in /tmp/codex-fixture-spike.
CODEX_REAL_SMOKE=1 pnpm smoke:real-turn -- \
  --capture /tmp/codex-fixture-spike/raw-stream.jsonl \
  --prompt-file packages/cli/src/prompts/richer-turn.txt \
  --cwd /tmp/codex-fixture-spike
```

| Flag | Effect |
|---|---|
| `--capture <path>` | Append every inbound message (responses, notifications, server-requests) to `<path>` as JSONL. No-op when absent. The split + redact pipeline lives in `scripts/split-capture.mts` + `scripts/redact-fixture.mjs` (added in T3). |
| `--prompt-file <path>` | Read the turn prompt from `<path>` instead of the default `prompts/harmless-turn.txt`. Path is repo-relative. |
| `--cwd <path>` | Working directory for the spawned **codex subprocess only**. Does NOT change the harness's own cwd, so `pnpm --filter` and other repo-relative paths still resolve. Use this to point codex at a sandboxed scratch dir. |

Argv parsing rejects unknown flags and missing values (e.g. `--capture --cwd /tmp/x`
errors instead of silently treating `--cwd` as the capture path). Tests live in
`test/cli-flags.test.ts` (default unit gate) and
`test/smoke-real-turn-capture.test.ts` (cli-smoke project, run via
`pnpm test:cli-smoke` or `bash scripts/ci-check.sh`).

### Safety rails (Plan v2 D4)

```ts
configOverrides: {
  sandbox: "read-only",          // no shell side effects
  approval_policy: "on-request", // every approval funnels through us
}

client.setServerRequestHandler((req) => {
  // EVERY server-initiated request is default-rejected. The model
  // cannot get any approval through this smoke.
  throw new Error("smoke rejects all server requests by policy");
});
```

The default harmless prompt (`src/prompts/harmless-turn.txt`) explicitly forbids
shell, file, and Computer Use, and asks the model to reply with the literal
text `OK`. We do **not** assert the model output equals `OK` — we only
assert the lifecycle reached terminal state. If the model rejects the
prompt or rambles, that's still a pass for transport purposes. With
`--prompt-file` the operator opts into a richer prompt that MAY trigger
server-initiated approvals — those are still default-rejected; T4 captures
the wire shape for the Phase 1 ApprovalBroker.

## `pnpm runtime:send` — Phase 1 runtime kernel smoke (gated)

```bash
CODEX_REAL_SMOKE=1 pnpm runtime:send -- --prompt 'Reply OK'
```

**Triggers a real model call.** Same `~$0.01` cost and login/quota
preconditions as `smoke:real-turn`.

Verifies the FULL Phase 1 runtime kernel against real codex:
1. spawn `codex app-server`
2. initialize handshake
3. `ApprovalBroker.attach()` (Phase 1 default-deny on every server-initiated
   approval — no auto-approve anywhere)
4. `runtime.threadStart({})`
5. `runtime.turnStart({...})` with the prompt
6. consume `runtime.events.events()` AsyncIterable, print each
   `CodexRichEvent` as JSONL
7. break on first terminal turn event
   (`turn_completed` / `turn_failed` / `turn_interrupted`)
8. `client.stop()` cleanly

### Flags

| Flag | Effect |
|---|---|
| `--prompt <text>` | Inline prompt string. |
| `--prompt-file <path>` | Read prompt from file (mutually exclusive with `--prompt`). |
| `--cwd <path>` | Working directory for the spawned **codex subprocess only**. Same semantics as `smoke:real-turn --cwd`. |

If neither `--prompt` nor `--prompt-file` is given, the default
`packages/cli/src/prompts/harmless-turn.txt` is used.

### Safety rails

Identical to `smoke:real-turn`:
- `sandbox=read-only`, `approval_policy=on-request` config overrides
- `ApprovalBroker.attach()` covers `client.setServerRequestHandler` —
  T9b's per-method default-reject responses fire for every approval
  the model triggers (`item/fileChange/requestApproval`,
  `item/commandExecution/requestApproval`, etc.); never auto-approve.
- `account/chatgptAuthTokens/refresh` throws `JsonRpcResponseError(-32601)`
  by default (cannot fabricate tokens in Phase 1).

The broker's default-deny is more disciplined than `smoke:real-turn`'s
ad-hoc `setServerRequestHandler(req => throw)` because each method gets
the wire-shape codex expects (e.g. `{decision: "decline"}` for fileChange,
not a `-32603 "handler error"` collapse). This is what Phase 2 IM
adapter integration will build on.

## What is NOT in this CLI

- No `codex-im daemon` runtime (Phase 1+).
- No admin commands (`codex-im config validate`, `codex-im db migrate`, etc.).
- No IM adapter wiring.

This package is the smallest surface needed to exercise the Phase 0 stack
end-to-end against real codex. Phase 1 adds `runtime send` to exercise
the runtime kernel. Everything else lives downstream.
