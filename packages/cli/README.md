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

The harmless prompt (`src/prompts/harmless-turn.txt`) explicitly forbids
shell, file, and Computer Use, and asks the model to reply with the literal
text `OK`. We do **not** assert the model output equals `OK` — we only
assert the lifecycle reached terminal state. If the model rejects the
prompt or rambles, that's still a pass for transport purposes.

## What is NOT in this CLI

- No `codex-im daemon` runtime (Phase 1+).
- No admin commands (`codex-im config validate`, `codex-im db migrate`, etc.).
- No IM adapter wiring.

This package is the smallest surface needed to exercise the Phase 0 stack
end-to-end against real codex. Everything else lives downstream.
