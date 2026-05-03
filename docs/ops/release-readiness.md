# Release Readiness Preflight

Status: JAC-169 production ops preflight.

## Default Command

Run the full non-live release-readiness gate:

```bash
pnpm release:check
```

The default command runs CI-equivalent gates first, then local operational
dry-runs. It must not write Keychain entries, call `launchctl load/unload`, make
live external IM calls, trigger real Codex turns, or execute real Computer Use.
Default live-smoke probes are environment-hermetic: the preflight clears live
gate, credential selector, token, and dry-run variables before checking that
Telegram fails at its operator gate and Lark/DingTalk/Computer Use report
`status=skip` with `gate=disabled`.

For a faster operational dry-run after the full gates have already passed:

```bash
pnpm release:check -- --skip-full-gates
```

## What It Checks

- Codex version pin.
- TypeScript source and test typechecks.
- Unit, contract, and CLI smoke tests.
- Lint and protocol generation determinism.
- Phase 1 captured fixture verification.
- launchd plist dry-run rendering.
- Keychain wrapper dry-run through a temporary fake `security` shim.
- SQLite backup proof against a temporary database.
- Fake Telegram/Lark/DingTalk smokes.
- Live Telegram/real Telegram commands fail at their explicit operator gate by
  default without making a network call.
- Lark/DingTalk/Computer Use live harnesses default-skip without credentials.
- Ambient live-smoke environment variables cannot turn default checks into live
  behavior.
- Command output does not contain token-shaped material.

## Forbidden By Default

- Keychain writes.
- launchd install/uninstall.
- live Telegram, Lark, DingTalk, or real Codex calls.
- real Computer Use provider execution.
- public listeners.
- secrets in output.

## If It Fails

Treat failures as release blockers unless the failure is known to be local
environment setup. Do not proceed to the production-readiness tag until the
failing gate has a committed fix or a documented, reviewed exception.
