# Phase 0 Host Environment

- **Date**: 2026-04-29
- **Operator**: jackwu
- **Branch**: phase-0-bootstrap

## V1–V3: Runtime versions

| Tool | Version | Required | Status |
|------|---------|----------|--------|
| node | v25.6.1 | ≥ 20.10.0 | ✅ |
| pnpm | 10.33.2 | ≥ 9.x | ✅ |
| codex | codex-cli 0.125.0 | (pinned) | ✅ — committed to `CODEX_VERSION` and `package.json#codexIm.codexVersion` |

## V4–V8: Codex CLI surface

### `which codex` — real binary check

```
/opt/homebrew/bin/codex
lrwxr-xr-x  1 jackwu  admin  63 27 Apr 20:53 /opt/homebrew/bin/codex -> /opt/homebrew/Caskroom/codex/0.125.0/codex-aarch64-apple-darwin
```

✅ Real binary (symlink resolves to `Caskroom`). spawn does not need shell resolution.

### `codex --help` (relevant subcommands)

```
exec         Run Codex non-interactively [aliases: e]
review       Run a code review non-interactively
mcp-server   Start Codex as an MCP server (stdio)
app-server   [experimental] Run the app server or related tooling
features     Inspect feature flags
```

> `app-server` is marked **`[experimental]`** at the top level. Treat the whole subcommand surface as moving target. Mitigation: `pnpm check:codex-version` (Task 1.5) + wire fixtures (Task 0.4 / Section I Task 8.4).

### `codex app-server --help`

Subcommands:
- `proxy` — proxy stdio bytes to the running app-server control socket
- `generate-ts` — `[experimental]` generate TypeScript bindings
- `generate-json-schema` — `[experimental]` generate JSON Schema

Listen modes (verified):

| URL | Use |
|-----|-----|
| `stdio://` (default) | **Phase 0 chosen** |
| `unix://` / `unix://PATH` | local IPC option (not used in P0) |
| `ws://IP:PORT` | requires `--ws-auth` (capability-token \| signed-bearer-token) |
| `off` | disable transport |

> Confirms `02-TECHNICAL-DECISIONS.md §2`: P0 uses stdio. WS requires capability/signed-bearer tokens — out of P0 scope.

WS-related flags observed (NOT used in Phase 0, recorded for future P2 remote workspaces):
`--ws-auth`, `--ws-token-file`, `--ws-token-sha256`, `--ws-shared-secret-file`, `--ws-issuer`, `--ws-audience`, `--ws-max-clock-skew-seconds`.

Other interesting flags:
- `--analytics-default-enabled` — analytics off by default for `app-server`. We will NOT pass this flag.
- `-c, --config <key=value>` — TOML override path. This is what `StdioTransportOptions.configOverrides` will translate to.
- `--enable <FEATURE>` / `--disable <FEATURE>` — feature flags equivalent to `-c features.<name>=...`.

## V5/V6: generator subcommand surface

### `codex app-server generate-ts --help`

```
Usage: codex app-server generate-ts [OPTIONS] --out <DIR>

Options:
  -o, --out <DIR>            Output directory where .ts files will be written
  -p, --prettier <PRETTIER_BIN>  Optional path to the Prettier executable
  -c, --config <key=value>   TOML override
      --enable <FEATURE>
      --disable <FEATURE>
      --experimental         Include experimental methods and fields in the generated output
```

✅ `--experimental` exists. ✅ `--out` is required. Optional `--prettier` (we'll skip — Biome handles formatting at lint time, and we ignore the generated dir in `biome.json`).

### `codex app-server generate-json-schema --help`

```
Usage: codex app-server generate-json-schema [OPTIONS] --out <DIR>

Options:
  -o, --out <DIR>            Output directory
  -c, --config <key=value>
      --enable <FEATURE>
      --experimental         Include experimental methods and fields in the generated output
      --disable <FEATURE>
```

✅ `--experimental` exists.

## --experimental decision

**Decision: USE STABLE** (do NOT pass `--experimental`) for `generate-ts` and `generate-json-schema` in Phase 0–6.

**This reverses** the preliminary stance in plan v2 (`docs/superpowers/plans/2026-04-29-phase-0-bootstrap.md` Task 0.2 / Task 2.2), which assumed `--experimental` was needed for Computer Use / approval / rich events. Empirical diff (see `docs/phase-0/codex-gen-diff.md`) shows that assumption was wrong.

### Evidence summary

Both modes succeed (exit 0). Diff shows experimental adds **+29 files** (~+6 %), entirely in feature areas **outside Phase 0–6 scope**:

- `thread/realtime/*` — voice conversation (Phase 7+)
- `fuzzyFileSearch/session*` — IDE-style fuzzy session lifecycle (one-shot `fuzzyFileSearch` is in stable)
- `thread/memoryMode/*` + `memory/reset` — memory mode controls
- `thread/{increment,decrement}_elicitation` — niche
- `thread/backgroundTerminals/clean` — niche
- `collaborationMode/list` — niche
- `mock/experimentalMethod` — Codex's own test infrastructure

What Phase 0–6 actually needs is **all in stable**:

- `initialize` / `thread/{start,resume,fork,archive,turns/list,...}` / `turn/{start,steer,interrupt}` / `review/start`
- `command/exec/{,write,terminate,resize}`
- `fs/*`, `mcpServer/*`
- `account/*`, `getAuthStatus`
- `Tool.ts` (generic — **Computer Use is a runtime tool instance, not a type-level union arm**, so `--experimental` does NOT add it)
- `ServerRequest.ts` with the **real** approval method names: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `applyPatchApproval`, `execCommandApproval`. (Note: `05-PROTOCOL.md`'s old approval names are stale; Phase 1 doc update needed.)
- `ServerNotification.ts` (10.7 KB full notification union)
- `LocalShellAction`, `LocalShellExecAction`, `LocalShellStatus`, `FileChange`, `ApplyPatchApprovalParams`, `ExecCommandApprovalParams`, `ResponseItem`

### Trade-off accepted

- Smaller generated surface → less review churn on codex upgrade
- Lower risk of writing code against a renamed experimental method
- If Phase 7+ needs voice / memory mode / fuzzy session, **explicit opt-in**: regenerate with `--experimental`, expand facade. See `docs/phase-0/codex-gen-diff.md` "Switching to --experimental later" for the steps.

### Caveat

`codex app-server` is itself marked `[experimental]` at the top level. Even the stable surface can change. Mitigations: `pnpm check:codex-version` (Task 1.5), wire fixtures in `packages/testkit/fixtures/codex-0.125.0/` (Section A Task 0.4 + Section I Task 8.4), `pnpm protocol:check` (Task 2.2).

## Wire spike results

(Populated by Task 0.3.)

## Real-turn smoke results

(Populated by Section J Task 9.3, only after first successful `CODEX_REAL_SMOKE=1 pnpm smoke:real-turn`.)
