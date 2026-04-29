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

**Captured on Codex CLI 0.125.0** via `node /tmp/codex-spike/spike.mjs` (one-shot stdin write, hold up to 5s for first stdout line, capture stderr separately). Five cases run; case 6 (server-initiated request) deferred to Section J Task 9.3 `smoke:real-turn` since it requires a real model turn.

> ⚠️ NOT GUARANTEED STABLE. Mitigations in place: `pnpm check:codex-version` (Task 1.5), `packages/testkit/fixtures/codex-0.125.0/` (raw wire frames committed), `pnpm test:contract` (Section I Task 8.4 replays fixtures).

### Case 1 — numeric id, valid initialize

**Input** (single line):
```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"phase0-spike","version":"0.0.0"}}}
```

**Stdout** (single line, captured to `packages/testkit/fixtures/codex-0.125.0/initialize-response.jsonl`):
```json
{"id":1,"result":{"userAgent":"phase0-spike/0.125.0 (Mac OS 26.1.0; arm64) iTerm.app/3.6.6 (phase0-spike; 0.0.0)","codexHome":"/Users/jackwu/.codex","platformFamily":"unix","platformOs":"macos"}}
```

**Findings**:
- ✅ `id` type echoed: **number** (1)
- ✅ **No `jsonrpc` field** in response — confirms JSON-RPC lite
- ✅ Response shape: `{ userAgent, codexHome, platformFamily, platformOs }` — note **split** of platformFamily / platformOs (NOT a single `platform` field as some older docs may suggest)
- `userAgent` is rich: client name, codex version, OS, terminal info — usable for Phase 1 health/version checks

### Case 2 — string id, valid initialize

**Input**:
```json
{"id":"str-1","method":"initialize","params":{"clientInfo":{"name":"phase0-spike","version":"0.0.0"}}}
```

**Stdout** (`string-id-initialize-response.jsonl`):
```json
{"id":"str-1","result":{"userAgent":"...","codexHome":"...","platformFamily":"unix","platformOs":"macos"}}
```

**Findings**:
- ✅ String id is accepted and echoed verbatim
- Our `JsonRpcId = number | string` type definition (Task 3.4) is correct
- For OUTGOING client requests we'll use monotonic number; for INCOMING server-initiated requests we must accept both

### Case 3 — unknown method

**Input**:
```json
{"id":99,"method":"does/not/exist","params":{}}
```

**Stdout** (`unknown-method-error.jsonl`, 2066 bytes — full method registry leaked into error.message):
```json
{"error":{"code":-32600,"message":"Invalid request: unknown variant `does/not/exist`, expected one of `initialize`, `thread/start`, `thread/resume`, ... [88 methods enumerated]"},"id":99}
```

**Findings**:
- ✅ `error.code` = **-32600** (Invalid Request)
- ✅ **No `error.data` field** — only `code` and `message`
- ✅ `id` echoed back (99)
- 🔥 BONUS: server enumerates **all 88 accepted methods** in the error message — usable as a runtime sanity probe (e.g., on startup, send a deliberate bad method and parse the registry to detect drift). Will design as a Phase 1 health check.

### Case 4 — invalid params (initialize with wrong shape)

**Input**:
```json
{"id":100,"method":"initialize","params":{"wrong":"shape"}}
```

**Stdout** (`invalid-params-error.jsonl`):
```json
{"error":{"code":-32600,"message":"Invalid request: missing field `clientInfo`"},"id":100}
```

**Findings**:
- ⚠️ **Same `-32600` code as unknown-method** (NOT `-32602` "Invalid params" as JSON-RPC 2.0 spec defines)
- This means clients **cannot distinguish error category by code alone** — must parse `error.message` keywords:
  - `unknown variant` → unknown method
  - `missing field` / `invalid type` / `unknown field` → invalid params
  - other → unclassified
- Phase 1 EventNormalizer / error renderer will need a small classifier helper.
- ✅ No `error.data` field

### Case 5 — malformed JSON

**Input** (literally not JSON):
```
not json at all
```

**Stdout**: empty (0 bytes).
**Stderr** (`malformed-json.stderr.txt`, 168 bytes, **with ANSI color codes**):
```
[2m2026-04-29T07:14:23.647290Z[0m [31mERROR[0m [2mcodex_app_server::transport[0m[2m:[0m Failed to deserialize JSONRPCMessage: expected ident at line 1 column 2
```

**Findings**:
- ✅ Confirms Codex outside-voice finding: malformed JSON does **NOT** generate a JSON-RPC error response. Only stderr.
- Stderr lines carry **ANSI color escapes** (`[2m`, `[31m`, `[0m`) for tracing log formatting.
- Implication for `StdioTransport`: stderr handler must treat input as plaintext, never attempt JSON parse, and tolerate ANSI codes (pino logger will record them as-is — fine for debugging).
- 90% of "weird codex behavior" Phase 1+ debug sessions will look at this stderr stream — keep it visible.

### Case 6 — server-initiated request

**Status**: DEFERRED to Section J Task 9.3 (`smoke:real-turn`) per plan, since it requires a real turn to start running for codex to issue a server-side approval / tool / elicitation request. Will capture into `packages/testkit/fixtures/codex-0.125.0/server-request-sample.jsonl` at that time.

### Implications for code design

1. **`JsonRpcId = number | string`** — both types must round-trip. Outgoing: monotonic number. Incoming server requests: trust whatever they send.
2. **No `jsonrpc` field anywhere** — `JsonRpcRequest`/`Response`/`Notification` types should NOT carry it.
3. **`JsonRpcError = { code: number; message: string; data?: unknown }`** — `data` field is optional (absent in 0.125.0 but defensively typed for future).
4. **Error code `-32600` is overloaded** — Phase 1+ may want a `categorizeJsonRpcError(error)` helper that string-matches `error.message` for diagnostics.
5. **Stderr handler in `StdioTransport`** must NOT parse stderr as JSON. Plaintext + ANSI is the contract.
6. **`InitializeResult` shape** uses `platformFamily` + `platformOs` (split). The generated `InitializeResponse.ts` from `codex-protocol` will be the canonical type — `performInitializeHandshake` returns it.
7. **Error.message can be huge** (case 3: ~2 KB enumerating method registry). Client should not assume `error.message` is short; pino logging may want to truncate to e.g. 500 chars in default level.

## Real-turn smoke results

(Populated by Section J Task 9.3, only after first successful `CODEX_REAL_SMOKE=1 pnpm smoke:real-turn`.)
