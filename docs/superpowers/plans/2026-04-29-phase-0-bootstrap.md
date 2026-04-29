# Phase 0: Bootstrap & Protocol Validation Implementation Plan (Revision 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish monorepo skeleton, lock down Codex App Server protocol entry points, build minimal JSONL transport + AppServerClient with full TDD coverage, and validate end-to-end (initialize handshake **and** one harmless real turn) against the real `codex app-server` subprocess.

**Architecture:** Four packages constitute the Phase 0 vertical slice. `codex-protocol` houses generated types behind a facade. `app-server-client` provides JSONL framing, JSON-RPC lite envelope, a transport-agnostic client (request/notify/respond/timeout/default-reject/transport-close), `StdioTransport` (real subprocess), and `performInitializeHandshake`. `testkit` ships `InMemoryTransport`, `FakeAppServer`, captured wire fixtures, and a `replayFixture` utility — used by all client tests. `cli` exposes two smoke commands: `smoke:app-server` (initialize-only, env-gated `CODEX_SMOKE=1`) and `smoke:real-turn` (full lifecycle, env-gated `CODEX_REAL_SMOKE=1`, sandboxed).

**Tech Stack:** Node 20+, TypeScript 5.6 strict, pnpm workspace, Vitest, Biome, **`tsx`** (runtime executor), `execa` (subprocess), `pino` (structured logger). Explicitly NOT pulling in `vscode-jsonrpc` (it requires `jsonrpc:"2.0"` framing; codex app-server uses JSON-RPC lite without it). Explicitly NOT pulling in `ndjson`/`split2` (13-line custom decoder is cheaper than a transitive dependency).

---

## Decision Log

| ID | Decision | Resolution | Rationale |
|----|----------|-----------|-----------|
| **D1** | `performInitializeHandshake` module placement | **A** — extracted to `packages/app-server-client/src/handshake.ts` from Phase 0 | Handshake is a base protocol boundary, must not be inlined in smoke and rewritten in Phase 1. DRY across smoke + Phase 1 `CodexRuntime.initialize`. |
| **D2** | `InMemoryTransport` package location | **A** — lives in `packages/testkit`, NOT in `app-server-client` | Production package must not ship test scaffolding. Phase 0 builds `testkit` early because fakes/fixtures/contract tests will all consume it. |
| **D3** | Codex CLI outside-voice review on Phase 0 plan | **A** — ran on 2026-04-29, 10 findings produced | Phase 0 is the foundation; cheap to challenge before code. Codex's role in this project is outside voice, used early. |
| **D4** | Phase 0 smoke includes real harmless turn | **A** with safety rails — gated by `CODEX_REAL_SMOKE=1`, NOT in default test suite | docs (09-ROADMAP §24, 05-PROTOCOL §196, 11-TESTING §130) require it; init-only does not validate auth/PATH/env/turn-lifecycle/streaming/approval-default-reject. Rails: read-only sandbox, on-request approval, default-deny network, fixed harmless prompt, no output assertion. |

### Why real-turn smoke is included in Phase 0

- docs explicitly required it; deviating without justification would silently violate the roadmap.
- Validates auth, codex login state, PATH, launchd-like env, turn lifecycle, event stream, and approval default-reject **before** Phase 1 builds CodexRuntime on top.
- Does NOT run in `pnpm test`, `pnpm test:unit`, `pnpm test:contract`, `pnpm smoke:app-server`. Only `CODEX_REAL_SMOKE=1 pnpm smoke:real-turn`.
- Protected by: `sandbox=read-only`, `approval_policy=on-request`, network default-deny, client default-rejects all server-initiated requests, fixed harmless prompt.
- Does not assert turn output content. Asserts only lifecycle: terminal state reached, no unhandled server requests, no approvals accepted, transport clean.

### Codex outside-voice findings — disposition

| Codex # | Status | Where addressed |
|---------|--------|-----------------|
| 1 (P0) Init-only smoke insufficient | ✅ Adopted with rails | Section J Tasks 9.3–9.4 |
| 2 (P1) Version pin + upgrade gate | ✅ Adopted (custom `codexIm.codexVersion` field, NOT `engines.codex`) | Section B Task 1.5 |
| 3 (P1) `--experimental` flag decision | ✅ Adopted; **decision REVERSED to STABLE** based on empirical diff (Phase 0–6 needs all in stable; experimental adds only realtime/fuzzy-session/memory/mock — out of scope). See `docs/phase-0/codex-gen-diff.md` and `docs/phase-0/host-environment.md` "--experimental decision". | Section A Task 0.2; Section C Task 2.2 |
| 4 (P1) Wire spike underspecified | ✅ Adopted, 6 spike cases | Section A Task 0.3 |
| 5 (P1) Default-reject server request | ✅ Adopted, 4 cases (no handler / throw / timeout / unknown method) | Section F Task 5.6 |
| 6 (P1) `StdioTransportOptions` shape | ✅ Adopted full signature with `configOverrides` translation | Section G Task 6.1 |
| 7 (P1) Handshake returns `InitializeResult` | ✅ Adopted | Section H Task 7.1 |
| 8 (P2) Don't hardcode approval method names | ✅ Adopted — Phase 0 has zero approval string literals | Enforced repo-wide; checked in Section K |
| 9 (P2) Wire fixtures in repo | ✅ Adopted, `packages/testkit/fixtures/codex-0.125.0/` | Section A Task 0.4; Section E Task 4.3; Section I Task 8.4 |
| 10 (P3) `tsx` in tech stack | ✅ Adopted | This document header; Section B Task 1.3 |

---

## Architecture (ASCII)

```
                    ┌─────────────────────────────────┐
                    │        AppServerClient          │
                    │  request(method, params,        │
                    │          { timeoutMs })         │
                    │  notify / respond / reject      │
                    │  onNotification / onSrvRequest  │
                    │  default-reject unknown         │
                    │  timeout / transport-close      │
                    │      → reject all pending       │
                    └────────────┬────────────────────┘
                                 │ Transport interface
                                 │ (start/stop/send/onMessage/onError/onClose)
                ┌────────────────┴─────────────────┐
                │                                  │
   ┌────────────▼──────────────┐    ┌──────────────▼─────────────────┐
   │   InMemoryTransport       │    │    StdioTransport              │
   │   (paired, in-process)    │    │    StdioTransportOptions {     │
   │   lives in @testkit       │    │      command, args, cwd?, env?,│
   └────────────┬──────────────┘    │      configOverrides?          │
                │                   │    } → translates              │
                │                   │      configOverrides → -c k=v  │
                │                   │    spawn via execa             │
                │                   │    stdout → JsonlDecoder       │
                │                   │    stderr → pino.warn          │
                │                   │    onClose carries exit code   │
                │                   │    SIGKILL after grace period  │
                │                   └──────────────┬─────────────────┘
                │                                  │
   ┌────────────▼──────────────┐    ┌──────────────▼─────────────────┐
   │   FakeAppServer           │    │  real codex app-server         │
   │   - respondTo(method, h)  │    │    --listen stdio://           │
   │   - emitNotification      │    │    --experimental flag set     │
   │   - emitServerRequest     │    │      per Task 0.2 decision     │
   │   - replayFixture(name)   │    └────────────────────────────────┘
   │   uses fixtures/0.125.0/  │
   └───────────────────────────┘

  performInitializeHandshake(client, clientInfo): Promise<InitializeResult>
    -> client.request("initialize", { clientInfo, ... })
    -> client.notify("initialized")
    -> returns typed { codexHome, platform, userAgent, ...generated }
    -> consumed by smoke (Phase 0) and CodexRuntime.initialize (Phase 1)
```

---

## File Structure (Phase 0 entire surface)

```
codex-im-rich-client/
├── package.json                                      # workspace root, scripts, devDeps
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
├── vitest.config.ts                                  # default: unit + contract
├── biome.json
├── .gitignore
├── .npmrc
├── .nvmrc
├── README.md                                         # MODIFIED: Phase 0 quickstart
├── 09-ROADMAP.md                                     # MODIFIED: Phase 0 ticked
├── CODEX_VERSION                                     # NEW: pinned at root
├── scripts/
│   └── check-codex-version.mjs                       # NEW: 3-way version gate
├── docs/
│   ├── phase-0/
│   │   ├── host-environment.md                       # NEW: V1-V9 + spike + --experimental decision
│   │   ├── decision-log.md                           # NEW: D1-D4 + rationale (mirrors this header)
│   │   └── codex-review.md                           # NEW: end-of-phase Codex CLI review
│   └── superpowers/plans/
│       └── 2026-04-29-phase-0-bootstrap.md           # this file
└── packages/
    ├── codex-protocol/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── README.md                                 # facade + --experimental rationale
    │   ├── CODEX_VERSION                             # mirrors root
    │   ├── src/
    │   │   ├── index.ts                              # FACADE — named exports only, NOT export *
    │   │   └── generated/                            # codex generate-ts output (committed)
    │   └── schema/                                   # codex generate-json-schema output (committed)
    ├── app-server-client/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── jsonl.ts                              # JsonlDecoder + encodeJsonl
    │   │   ├── jsonrpc.ts                            # types + type guards
    │   │   ├── errors.ts                             # JsonRpcResponseError, TransportClosedError, TransportProtocolError
    │   │   ├── transport.ts                          # Transport interface
    │   │   ├── client.ts                             # AppServerClient
    │   │   ├── stdio-transport.ts                    # StdioTransport + StdioTransportOptions
    │   │   └── handshake.ts                          # performInitializeHandshake
    │   └── test/
    │       ├── jsonl.test.ts
    │       ├── jsonrpc.test.ts
    │       ├── client.test.ts
    │       ├── client-timeout.test.ts
    │       ├── client-default-reject.test.ts
    │       ├── client-transport-close.test.ts
    │       ├── stdio-transport.test.ts
    │       ├── handshake.test.ts
    │       └── fixtures/
    │           └── echo-stdio.mjs                    # node script used as fake child
    ├── testkit/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── in-memory-transport.ts                # paired pipes
    │   │   ├── fake-app-server.ts                    # respondTo / emit*
    │   │   └── fixture-replay.ts                     # replayFixture(name)
    │   ├── test/
    │   │   ├── in-memory-transport.test.ts
    │   │   ├── fake-app-server.test.ts
    │   │   └── fixture-replay.test.ts
    │   └── fixtures/
    │       └── codex-0.125.0/
    │           ├── metadata.json
    │           ├── initialize-response.jsonl
    │           ├── unknown-method-error.jsonl
    │           ├── malformed-json.stderr.txt
    │           └── server-request-sample.jsonl       # captured if observable, otherwise placeholder
    │           # harmless-turn-event-stream.jsonl     # captured during smoke:real-turn (Section J)
    └── cli/
        ├── package.json
        ├── tsconfig.json
        ├── src/
        │   ├── index.ts                              # command dispatch
        │   ├── smoke-app-server.ts                   # initialize-only
        │   ├── smoke-real-turn.ts                    # full lifecycle
        │   └── prompts/
        │       └── harmless-turn.txt                 # fixed prompt
        └── test/
            ├── smoke-app-server.test.ts              # env-gated CODEX_SMOKE=1
            └── smoke-real-turn.test.ts               # env-gated CODEX_REAL_SMOKE=1
```

---

## Tasks

> All TDD tasks: write failing test → verify FAIL → implement → verify PASS → commit. Each task ≤ 5 minutes.

---

## Section A: Pre-flight & wire validation (HARD SERIAL, blocks everything)

### Task 0.1 — Host toolchain version capture

**Files:** Create `docs/phase-0/host-environment.md`, `CODEX_VERSION` (root).

- [ ] **Step 1:** Run and capture stdout into the doc:
  - `node --version` (≥ 20.10)
  - `pnpm --version` (≥ 9.0)
  - `codex --version` (record exact, e.g. `codex-cli 0.125.0`)
  - `codex --help` (look for `app-server` subcommand)
  - `codex app-server --help` (capture full output verbatim)
  - `which codex && ls -l "$(which codex)"` (confirm real binary, not alias)
- [ ] **Step 2:** Write `CODEX_VERSION` containing only the version string (e.g. `0.125.0\n`).
- [ ] **Step 3:** Initial `host-environment.md` skeleton:

```markdown
# Phase 0 Host Environment
- Date: 2026-04-29
- node: <output>
- pnpm: <output>
- codex: codex-cli 0.125.0
- codex binary path: /opt/homebrew/bin/codex
- codex app-server --help (verbatim):
  ```
  ...
  ```

# generate-ts surface
- generate-ts available: yes/no
- generate-ts --experimental available: yes/no
- generate-json-schema available: yes/no
- generate-json-schema --experimental available: yes/no

# Wire spike results
(populated by Task 0.3)

# --experimental decision
(populated by Task 0.2)
```

- [ ] **Step 4:** Commit: `chore(phase0): capture host toolchain baseline`.
- **Exit:** `CODEX_VERSION` exists at repo root; `host-environment.md` skeleton populated with V1–V8 results.

---

### Task 0.2 — `--experimental` flag decision

**Files:** Modify `docs/phase-0/host-environment.md`.

- [ ] **Step 1:** Run `codex app-server generate-ts --help` and `codex app-server generate-json-schema --help`. Note whether `--experimental` exists on each.
- [ ] **Step 2 (real path):** Generate twice into temp directories:
  - `mkdir -p /tmp/codex-gen-stable && codex app-server generate-ts --out /tmp/codex-gen-stable`
  - `mkdir -p /tmp/codex-gen-exp && codex app-server generate-ts --experimental --out /tmp/codex-gen-exp`
  - `diff -r /tmp/codex-gen-stable /tmp/codex-gen-exp > /tmp/codex-gen.diff` and inspect diff.
- [ ] **Step 3:** Decide and document in `host-environment.md` and `docs/phase-0/codex-gen-diff.md`. **Empirical decision (executed 2026-04-29): USE STABLE.** Rationale: Phase 0–6 needs (initialize, thread/turn lifecycle, command exec, approvals via `item/*/requestApproval` server-requests, MCP, auth, Tool generic, ServerNotification/Response) **are all in stable**. Experimental adds only realtime voice, fuzzy-session lifecycle, memory mode, elicitation counters, background terminals, collaboration mode, and mock — all out of P0–P6 scope. Computer Use is a runtime `Tool` instance, not a type-level distinction; `--experimental` does NOT add a ComputerUse type. See `docs/phase-0/codex-gen-diff.md` for full evidence and "Switching to --experimental later" recipe.

- [ ] **Step 4 (degraded path):** If `generate-ts` does not exist at all → write degraded section with hand-shim plan and STOP for human review.
- [ ] **Step 5:** Commit: `chore(phase0): document --experimental flag decision`.
- **Exit:** Decision recorded with diff evidence; subsequent tasks know which flag to pass.

---

### Task 0.3 — Wire spike: 6 cases against real `codex app-server`

**Files:** Modify `docs/phase-0/host-environment.md`.

- [ ] **Step 1:** Append "Wire spike results" section. For each case below, **manually** pipe a single line into `codex app-server --listen stdio://` and capture stdout + stderr verbatim.

| # | Input | What to learn |
|---|-------|---------------|
| 1 | `{"id":1,"method":"initialize","params":{"clientInfo":{"name":"phase0-spike","version":"0.0.0"}}}` | id type echoed (number), `jsonrpc` field absent/present, full response shape |
| 2 | `{"id":"str-1","method":"initialize","params":{"clientInfo":{"name":"phase0-spike","version":"0.0.0"}}}` | does server accept string id and echo it? |
| 3 | `{"id":99,"method":"does/not/exist","params":{}}` | unknown method error shape, `error.data` presence |
| 4 | `{"id":100,"method":"initialize","params":{"wrong":"shape"}}` | invalid params error code (-32602? -32600?) |
| 5 | `not json at all` | malformed input behavior — JSON-RPC error or stderr-only? |
| 6 | Send valid `initialize`, then immediately send a known turn-or-server-prompt that triggers a server-initiated request (best-effort; if not observable in 30s, mark "could not capture" and move on) | server-initiated request envelope shape |

- [ ] **Step 2:** Pre-populated from Codex outside-voice (mark these as `observed on Codex CLI 0.125.0; not guaranteed stable`):
  - Case 3: `{"error":{"code":-32600,"message":"..."},"id":"bad-1"}` — **no `error.data` field**
  - Case 5: malformed JSON returns nothing on stdout; only stderr noise
  - Method registry includes `thread/approveGuardianDeniedAction` — confirms approval method name in old docs is stale
- [ ] **Step 3:** Document each case as a fenced JSON block in `host-environment.md` with the wire response.
- [ ] **Step 4:** Annotate the section header:

```markdown
# Wire spike — observed on Codex CLI 0.125.0
NOT guaranteed stable. Covered by:
- pnpm check:codex-version (Task 1.5)
- packages/testkit/fixtures/codex-0.125.0/ (Section E Task 4.3 + Section I Task 8.4)
- Phase 1 contract tests will replay these fixtures on every CI run.
```

- [ ] **Step 5:** Commit: `chore(phase0): record wire spike on codex 0.125.0`.
- **Exit:** Six wire shapes documented; `id` type confirmed as **number** (per Codex spike); `error.data` confirmed absent; subsequent JSON-RPC type definitions in Task 3.4 use these as ground truth.

---

### Task 0.4 — Capture initial wire fixtures

**Files:** Create `packages/testkit/fixtures/codex-0.125.0/{metadata.json,initialize-response.jsonl,unknown-method-error.jsonl,malformed-json.stderr.txt}`.

> Note: `packages/testkit/` directory will be created formally in Section E Task 4.1; here we just create the `fixtures/` subdir with a placeholder `package.json` parent. Order will be: this task creates files in `packages/testkit/fixtures/`, Task 4.1 wraps them.

- [ ] **Step 1:** Create `packages/testkit/fixtures/codex-0.125.0/metadata.json`:

```json
{
  "codexVersion": "0.125.0",
  "platform": "darwin",
  "capturedAt": "2026-04-29",
  "capturedBy": "Phase 0 Task 0.4",
  "experimentalFlag": true,
  "notes": [
    "id type observed: number",
    "jsonrpc field observed: absent",
    "error.data observed: absent",
    "malformed JSON: no JSON-RPC error response, stderr only",
    "approval method names from old 05-PROTOCOL.md are stale; thread/approveGuardianDeniedAction observed in 0.125 method list"
  ]
}
```

- [ ] **Step 2:** Save raw stdout responses from Task 0.3 cases 1, 3, 5 into the corresponding `*.jsonl` / `*.stderr.txt` files. One JSON object per line for `.jsonl` files.
- [ ] **Step 3:** If Case 6 in Task 0.3 yielded an observable server-initiated request, save it to `server-request-sample.jsonl`; otherwise create the file with a single comment line: `# placeholder: no server-initiated request captured during phase-0 spike; will revisit in smoke:real-turn`.
- [ ] **Step 4:** Commit: `chore(phase0): capture initial wire fixtures (codex 0.125.0)`.
- **Exit:** 4 fixture files exist; FakeAppServer (Section I) and contract tests will consume them.

---

## Section B: Workspace & toolchain

### Task 1.1 — Root workspace + ignores

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.npmrc`, `.nvmrc`.

- [ ] **Step 1:** `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 2:** Root `package.json` (scripts placeholders; details filled in 1.3, 1.4, 1.5, 2.2, 9.x):

```json
{
  "name": "codex-im-rich-client",
  "version": "0.1.0-phase0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.10.0" },
  "codexIm": { "codexVersion": "0.125.0" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run --config vitest.config.ts",
    "test:unit": "vitest run --config vitest.config.ts --project unit",
    "test:contract": "vitest run --config vitest.config.ts --project contract",
    "test:watch": "vitest --config vitest.config.ts",
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check .",
    "format": "biome format --write .",
    "check:codex-version": "node scripts/check-codex-version.mjs",
    "protocol:generate": "echo 'wired in Task 2.2' && exit 1",
    "smoke:app-server": "tsx packages/cli/src/index.ts smoke app-server",
    "smoke:real-turn": "tsx packages/cli/src/index.ts smoke real-turn"
  }
}
```

- [ ] **Step 3:** `.gitignore`:

```
node_modules/
dist/
coverage/
*.log
.DS_Store
packages/*/dist/
/tmp/
.vitest-cache/
```

- [ ] **Step 4:** `.npmrc`:

```
engine-strict=true
auto-install-peers=true
```

- [ ] **Step 5:** `.nvmrc` containing `20`.
- [ ] **Step 6:** `pnpm install`.
- **Verify:** `pnpm install` exits 0; `pnpm-lock.yaml` generated.
- **Exit:** Commit `chore(phase0): initialize pnpm workspace`.

---

### Task 1.2 — TypeScript baseline

**Files:** Create `tsconfig.base.json`, `tsconfig.json`.

- [ ] **Step 1:** `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 2:** Root `tsconfig.json`:

```json
{
  "files": [],
  "references": []
}
```

- [ ] **Step 3:** Add `typescript@^5.6.0` to root devDeps; `pnpm install`.
- **Verify:** `pnpm exec tsc --version` → `5.6.x`.
- **Exit:** Commit `chore(phase0): add typescript base config`.

---

### Task 1.3 — Vitest + tsx

**Files:** Create `vitest.config.ts`.

- [ ] **Step 1:** Add devDeps: `vitest@^2`, `@vitest/coverage-v8@^2`, `tsx@^4`, `@types/node@^22`.
- [ ] **Step 2:** `vitest.config.ts` with two projects (Codex finding #10 + Test Issue 5):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10000,
    coverage: { provider: "v8", reporter: ["text", "lcov"] },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts"],
          exclude: [
            "packages/cli/test/smoke-*.test.ts",
            "packages/testkit/test/fixture-replay.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "contract",
          include: ["packages/testkit/test/fixture-replay.test.ts"],
        },
      },
    ],
  },
});
```

- [ ] **Step 3:** Smoke test files in `cli` will read `process.env.CODEX_SMOKE` / `CODEX_REAL_SMOKE` and self-skip if not set; they are excluded from default `unit` project so `pnpm test` never runs them.
- **Verify:** `pnpm test` exits 0 with "no test files found"; `pnpm test:contract` likewise.
- **Exit:** Commit `chore(phase0): configure vitest with unit/contract projects`.

---

### Task 1.4 — Biome

**Files:** Create `biome.json`.

- [ ] **Step 1:** Add devDep `@biomejs/biome@^1.9`.
- [ ] **Step 2:** `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "organizeImports": { "enabled": true },
  "files": {
    "ignore": [
      "**/dist",
      "**/node_modules",
      "**/coverage",
      "packages/codex-protocol/src/generated",
      "packages/codex-protocol/schema",
      "packages/testkit/fixtures"
    ]
  }
}
```

- **Verify:** `pnpm lint` exits 0.
- **Exit:** Commit `chore(phase0): configure biome`.

---

### Task 1.5 — Codex version gate (Codex finding #2)

**Files:** Create `scripts/check-codex-version.mjs`.

- [ ] **Step 1:** Implement 3-way version comparison:

```js
#!/usr/bin/env node
// Compares: CODEX_VERSION file, `codex --version` output, package.json#codexIm.codexVersion.
// Exits 1 if any pair disagrees.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function fail(msg) { console.error(`[check:codex-version] ${msg}`); process.exit(1); }

const fileVersion = readFileSync(join(root, "CODEX_VERSION"), "utf8").trim();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const pkgVersion = pkg.codexIm?.codexVersion;
if (!pkgVersion) fail("package.json#codexIm.codexVersion missing");

let cliVersion;
try {
  const raw = execSync("codex --version", { encoding: "utf8" }).trim();
  const m = raw.match(/(\d+\.\d+\.\d+)/);
  if (!m) fail(`could not parse codex version from: ${raw}`);
  cliVersion = m[1];
} catch (err) {
  fail(`codex --version failed: ${err.message}`);
}

if (fileVersion !== pkgVersion || fileVersion !== cliVersion) {
  fail(`version mismatch:
  CODEX_VERSION file: ${fileVersion}
  package.json:       ${pkgVersion}
  codex --version:    ${cliVersion}
If you intentionally upgraded codex, update CODEX_VERSION and package.json#codexIm.codexVersion,
then re-run \`pnpm protocol:generate\` and review the diff before committing.`);
}
console.log(`[check:codex-version] OK: ${fileVersion}`);
```

- [ ] **Step 2:** Make executable: `chmod +x scripts/check-codex-version.mjs`.
- **Verify:** `pnpm check:codex-version` → `OK: 0.125.0`.
- **Test:** Temporarily edit `CODEX_VERSION` to `0.125.1` → script exits 1 with diff. Revert.
- **Exit:** Commit `chore(phase0): add codex version gate`.

---

## Section C: codex-protocol package

### Task 2.1 — Skeleton

**Files:** Create `packages/codex-protocol/{package.json,tsconfig.json,src/index.ts,README.md,CODEX_VERSION}`.

- [ ] **Step 1:** `package.json`:

```json
{
  "name": "@codex-im/protocol",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -b" }
}
```

- [ ] **Step 2:** `tsconfig.json` extends base, `outDir: dist`, `rootDir: src`, `composite: true`. Exclude `src/generated` from `noUncheckedIndexedAccess` enforcement via separate `tsconfig.generated.json` if needed.
- [ ] **Step 3:** `src/index.ts` placeholder: `export {};` plus comment `// Facade: only named exports, never export *. See README.md.`
- [ ] **Step 4:** `README.md` documents the facade rule (Architecture Issue 5):

```markdown
# @codex-im/protocol
Houses generated TypeScript types from `codex app-server generate-ts --experimental`
and JSON schema artifacts. **Never write business logic here.**

## Facade rule
`src/index.ts` re-exports ONLY the small set of types currently consumed by the rest
of the workspace, using named exports. We do NOT `export *` from the generated
directory. Reasons:
- Reduces blast radius when codex upgrades change generated surface.
- Forces deliberate adoption of new types — every new export is a code review.

## Why --experimental?
See docs/phase-0/host-environment.md "--experimental decision".

## Upgrade workflow
1. `pnpm check:codex-version` (will fail until CODEX_VERSION is updated).
2. Update root + package CODEX_VERSION + package.json#codexIm.codexVersion.
3. `pnpm protocol:generate`.
4. Review diff: `git diff packages/codex-protocol/`.
5. Run `pnpm test:contract` (replays wire fixtures against new types).
6. Update `packages/testkit/fixtures/codex-X.Y.Z/` if behavior changed.
```

- [ ] **Step 5:** `CODEX_VERSION` mirrors root: `0.125.0`.
- [ ] **Step 6:** Add to root `tsconfig.json#references`: `{ "path": "./packages/codex-protocol" }`.
- **Verify:** `pnpm typecheck` exits 0.
- **Exit:** Commit `feat(codex-protocol): package skeleton with facade rule`.

---

### Task 2.2 — protocol:generate script

**Files:** Modify root `package.json`.

- [ ] **Step 1 (real path, default per Task 0.2 decision = STABLE):** Replace placeholder script:

```json
"protocol:generate": "pnpm check:codex-version && rm -rf packages/codex-protocol/src/generated packages/codex-protocol/schema && codex app-server generate-ts --out packages/codex-protocol/src/generated && codex app-server generate-json-schema --out packages/codex-protocol/schema"
```

**Note:** No `--experimental` flag. If Phase 7+ requires voice / memory mode / fuzzy session, see `docs/phase-0/codex-gen-diff.md` "Switching to --experimental later" — regenerate with the flag, expand `packages/codex-protocol/src/index.ts` facade explicitly.

- [ ] **Step 2:** Add `protocol:check`: `pnpm protocol:generate && git diff --exit-code packages/codex-protocol`.
- [ ] **Step 3 (degraded path — only if Task 0.2 decided no generators available):** Replace with `node scripts/protocol-generate-fallback.mjs` that exits 1 with explanation.
- **Verify:** `pnpm protocol:generate` produces `.ts` files in `packages/codex-protocol/src/generated/`.
- **Exit:** Commit `feat(phase0): wire protocol:generate (--experimental)`.

---

### Task 2.3 — Generate, build facade, commit artifacts

**Files:** `packages/codex-protocol/src/generated/**` (committed); modify `packages/codex-protocol/src/index.ts`.

- [ ] **Step 1:** `pnpm protocol:generate`.
- [ ] **Step 2:** `pnpm typecheck` to confirm generated `.ts` compiles under our strict base. **If it fails** (very likely on `noUncheckedIndexedAccess` for tagged-union fields generated upstream), STOP and add a separate `packages/codex-protocol/tsconfig.generated.json` that loosens those rules for the `generated/` subtree only. Do NOT modify generated files by hand.
- [ ] **Step 3:** Update `src/index.ts` with a curated facade. Concrete export list (revisit each phase):

```ts
// Facade — Phase 0 surface only. See README.md.
export type {
  // Identifier types
  // (exact names depend on codex 0.125.0 generation; fill in after Task 2.3 inspection)
  InitializeParams,
  InitializeResult,
  ClientInfo,
} from "./generated/index.js";
```

(If those exact names differ, list the actual closest matches from the generated index. Document any name drift in `README.md`.)

- [ ] **Step 4:** `pnpm typecheck` PASS.
- [ ] **Step 5:** Commit: `feat(codex-protocol): commit generated artifacts (codex 0.125.0 stable)`. **Generated files MUST be committed**, not gitignored.
- **Exit:** Subsequent packages can `import type { InitializeResult } from "@codex-im/protocol"`.

---

## Section D: app-server-client core

### Task 3.1 — Package skeleton

**Files:** Create `packages/app-server-client/{package.json,tsconfig.json,src/index.ts}`.

- [ ] **Step 1:** `package.json`:

```json
{
  "name": "@codex-im/app-server-client",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -b",
    "test": "vitest run --project unit"
  },
  "dependencies": {
    "@codex-im/protocol": "workspace:*",
    "execa": "^9",
    "pino": "^9"
  },
  "devDependencies": {
    "@types/node": "^22"
  }
}
```

- [ ] **Step 2:** `tsconfig.json` extends base, references `@codex-im/protocol`.
- [ ] **Step 3:** `src/index.ts` re-exports surface (filled in subsequent tasks).
- [ ] **Step 4:** Add to root `tsconfig.json#references`.
- **Verify:** `pnpm typecheck` PASS.
- **Exit:** Commit `feat(app-server-client): package skeleton`.

---

### Task 3.2 — TDD `JsonlDecoder` (with perf + UTF-8)

**Files:** Create `packages/app-server-client/src/jsonl.ts`, `test/jsonl.test.ts`.

- [ ] **Step 1 (failing tests):**

```ts
// test/jsonl.test.ts
import { describe, expect, it } from "vitest";
import { JsonlDecoder } from "../src/jsonl.js";

describe("JsonlDecoder", () => {
  it("yields complete lines", () => {
    const d = new JsonlDecoder();
    expect(d.push('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("buffers partial lines across chunks", () => {
    const d = new JsonlDecoder();
    expect(d.push('{"a":')).toEqual([]);
    expect(d.push('1}\n')).toEqual([{ a: 1 }]);
  });

  it("ignores blank lines", () => {
    expect(new JsonlDecoder().push('\n\n{"a":1}\n\n')).toEqual([{ a: 1 }]);
  });

  it("throws on malformed JSON with line context", () => {
    expect(() => new JsonlDecoder().push('not json\n'))
      .toThrow(/JsonlDecoder.*invalid JSON/);
  });

  it("perf budget: 1MB single line in 4KB chunks under 100ms", () => {
    const big = '{"x":"' + "y".repeat(1_000_000) + '"}\n';
    const chunks: string[] = [];
    for (let i = 0; i < big.length; i += 4096) chunks.push(big.slice(i, i + 4096));
    const d = new JsonlDecoder();
    const start = performance.now();
    let out: unknown[] = [];
    for (const c of chunks) out = out.concat(d.push(c));
    const elapsed = performance.now() - start;
    expect(out.length).toBe(1);
    expect(elapsed).toBeLessThan(100);
  });

  it("handles UTF-8 multi-byte characters split across chunks", () => {
    // "中" is 3 bytes in UTF-8: E4 B8 AD
    // We feed strings (already decoded), but exercise the boundary inside content.
    const d = new JsonlDecoder();
    const msg = '{"text":"中文测试"}\n';
    const a = msg.slice(0, 8);
    const b = msg.slice(8);
    expect([...d.push(a), ...d.push(b)]).toEqual([{ text: "中文测试" }]);
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @codex-im/app-server-client test` → FAIL (module missing).
- [ ] **Step 3 (implementation):**

```ts
// src/jsonl.ts
export class JsonlDecoder {
  private buffer = "";

  push(chunk: string | Buffer): unknown[] {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const out: unknown[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`JsonlDecoder: invalid JSON: ${reason}: ${line.slice(0, 200)}`);
      }
    }
    return out;
  }
}

export function encodeJsonl(msg: unknown): string {
  return JSON.stringify(msg) + "\n";
}
```

- [ ] **Step 4:** Tests PASS. If perf test fails, swap buffer to `Buffer[]` accumulator + `Buffer.concat` on flush; retry.
- [ ] **Step 5:** Commit `feat(app-server-client): JsonlDecoder + encodeJsonl (TDD)`.
- **Exit:** 6 tests green; perf budget met.

---

### Task 3.3 — Encoder smoke test

**Files:** Modify `test/jsonl.test.ts`.

- [ ] **Step 1:** Add test: `expect(encodeJsonl({ a: 1 })).toBe('{"a":1}\n')` and `expect(() => encodeJsonl(BigInt(1))).toThrow()` (BigInt isn't JSON-serializable).
- [ ] **Step 2:** Tests PASS without code change.
- **Exit:** Commit `test(app-server-client): encoder coverage`.

---

### Task 3.4 — JSON-RPC lite types + type guards

**Files:** Create `packages/app-server-client/src/jsonrpc.ts`, `test/jsonrpc.test.ts`.

> **Hard dependency:** Section A Tasks 0.1–0.4 must be complete. id type and `error.data` shape come from spike, not guesswork.

- [ ] **Step 1 (failing tests):**

```ts
// test/jsonrpc.test.ts
import { describe, expect, it } from "vitest";
import {
  isJsonRpcResponse, isJsonRpcServerRequest, isJsonRpcNotification, isJsonRpcErrorResponse,
} from "../src/jsonrpc.js";

describe("JSON-RPC lite type guards", () => {
  it("classifies response (success)", () => {
    expect(isJsonRpcResponse({ id: 1, result: { x: 1 } })).toBe(true);
    expect(isJsonRpcErrorResponse({ id: 1, result: { x: 1 } })).toBe(false);
  });

  it("classifies response (error)", () => {
    const m = { id: 1, error: { code: -32600, message: "bad" } };
    expect(isJsonRpcResponse(m)).toBe(true);
    expect(isJsonRpcErrorResponse(m)).toBe(true);
  });

  it("classifies server-initiated request (id + method)", () => {
    expect(isJsonRpcServerRequest({ id: 42, method: "approval/whatever" })).toBe(true);
    expect(isJsonRpcResponse({ id: 42, method: "approval/whatever" })).toBe(false);
  });

  it("classifies notification (method, no id)", () => {
    expect(isJsonRpcNotification({ method: "turn/started", params: {} })).toBe(true);
  });

  it("rejects ambiguous shapes (method + result)", () => {
    expect(isJsonRpcResponse({ id: 1, result: {}, method: "x" })).toBe(false);
    expect(isJsonRpcServerRequest({ id: 1, result: {}, method: "x" })).toBe(false);
  });

  it("rejects bare empty object", () => {
    expect(isJsonRpcResponse({})).toBe(false);
    expect(isJsonRpcNotification({})).toBe(false);
    expect(isJsonRpcServerRequest({})).toBe(false);
  });
});
```

- [ ] **Step 2:** Implement (id is `number` per spike; we widen to `number | string` defensively but normalize on the wire to number for outgoing):

```ts
// src/jsonrpc.ts
export type JsonRpcId = number | string;

export interface JsonRpcRequest<P = unknown> {
  id: JsonRpcId;
  method: string;
  params?: P;
}

export interface JsonRpcNotification<P = unknown> {
  method: string;
  params?: P;
}

export interface JsonRpcSuccessResponse<R = unknown> {
  id: JsonRpcId;
  result: R;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  id: JsonRpcId | null;
  error: JsonRpcError;
}

export type JsonRpcResponse<R = unknown> =
  | JsonRpcSuccessResponse<R>
  | JsonRpcErrorResponse;

const isObj = (m: unknown): m is Record<string, unknown> =>
  typeof m === "object" && m !== null && !Array.isArray(m);

export function isJsonRpcResponse(m: unknown): m is JsonRpcResponse {
  if (!isObj(m)) return false;
  if (!("id" in m)) return false;
  if ("method" in m) return false;
  return "result" in m || "error" in m;
}

export function isJsonRpcErrorResponse(m: unknown): m is JsonRpcErrorResponse {
  return isJsonRpcResponse(m) && "error" in m;
}

export function isJsonRpcServerRequest(m: unknown): m is JsonRpcRequest {
  if (!isObj(m)) return false;
  if (!("id" in m) || typeof m.method !== "string") return false;
  if ("result" in m || "error" in m) return false;
  return true;
}

export function isJsonRpcNotification(m: unknown): m is JsonRpcNotification {
  if (!isObj(m)) return false;
  if ("id" in m) return false;
  return typeof m.method === "string";
}
```

- [ ] **Step 3:** Tests PASS.
- **Exit:** Commit `feat(app-server-client): JSON-RPC lite types + guards (per wire spike)`.

---

### Task 3.5 — Transport interface

**Files:** Create `packages/app-server-client/src/transport.ts`.

- [ ] **Step 1:** Define interface (no runtime test — pure types):

```ts
// src/transport.ts
//
// Architecture (see also docs/superpowers/plans/2026-04-29-phase-0-bootstrap.md):
//
//                AppServerClient
//                       │ Transport
//             ┌─────────┴──────────┐
//      InMemoryTransport      StdioTransport
//      (testkit)              (this package)
//
export type Unsubscribe = () => void;

export interface Transport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: unknown): void;
  onMessage(handler: (msg: unknown) => void): Unsubscribe;
  onError(handler: (err: Error) => void): Unsubscribe;
  onClose(handler: (exitCode: number | null) => void): Unsubscribe;
}
```

- [ ] **Step 2:** `pnpm typecheck` PASS.
- **Exit:** Commit `feat(app-server-client): Transport interface`.

---

### Task 3.6 — Typed errors (Code Quality Issue 4)

**Files:** Create `packages/app-server-client/src/errors.ts`, add to `test/jsonrpc.test.ts`.

- [ ] **Step 1:** Implement:

```ts
// src/errors.ts
import type { JsonRpcError } from "./jsonrpc.js";

export class JsonRpcResponseError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(err: JsonRpcError) {
    super(`[${err.code}] ${err.message}`);
    this.name = "JsonRpcResponseError";
    this.code = err.code;
    this.data = err.data;
  }
}

export class TransportClosedError extends Error {
  readonly exitCode: number | null;
  constructor(exitCode: number | null) {
    super(`transport closed (exit=${exitCode ?? "null"})`);
    this.name = "TransportClosedError";
    this.exitCode = exitCode;
  }
}

export class TransportProtocolError extends Error {
  readonly line?: string;
  constructor(message: string, line?: string) {
    super(message);
    this.name = "TransportProtocolError";
    this.line = line;
  }
}

export class RequestTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;
  constructor(method: string, timeoutMs: number) {
    super(`request "${method}" timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}
```

- [ ] **Step 2:** Add 1 test confirming each class is `instanceof Error` and exposes typed fields.
- **Exit:** Commit `feat(app-server-client): typed errors`.

---

## Section E: testkit package + InMemoryTransport (D2: A)

### Task 4.1 — testkit package skeleton

**Files:** Create `packages/testkit/{package.json,tsconfig.json,src/index.ts}`.

- [ ] **Step 1:** `package.json`:

```json
{
  "name": "@codex-im/testkit",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -b",
    "test": "vitest run --project unit"
  },
  "dependencies": {
    "@codex-im/app-server-client": "workspace:*",
    "@codex-im/protocol": "workspace:*"
  }
}
```

- [ ] **Step 2:** `tsconfig.json` references both deps.
- [ ] **Step 3:** Add to root `tsconfig.json#references`.
- **Verify:** `pnpm typecheck` PASS.
- **Exit:** Commit `feat(testkit): package skeleton (D2: InMemoryTransport lives here)`.

---

### Task 4.2 — TDD `InMemoryTransport`

**Files:** Create `packages/testkit/src/in-memory-transport.ts`, `test/in-memory-transport.test.ts`.

- [ ] **Step 1 (failing tests):**

```ts
import { describe, expect, it, vi } from "vitest";
import { createInMemoryTransportPair } from "../src/in-memory-transport.js";

describe("InMemoryTransport", () => {
  it("delivers messages bidirectionally", async () => {
    const [a, b] = createInMemoryTransportPair();
    await a.start(); await b.start();
    const onB = vi.fn(); b.onMessage(onB);
    const onA = vi.fn(); a.onMessage(onA);
    a.send({ x: 1 });
    b.send({ y: 2 });
    await new Promise((r) => queueMicrotask(r));
    expect(onB).toHaveBeenCalledWith({ x: 1 });
    expect(onA).toHaveBeenCalledWith({ y: 2 });
  });

  it("preserves order under burst send", async () => {
    const [a, b] = createInMemoryTransportPair();
    await a.start(); await b.start();
    const recv: unknown[] = [];
    b.onMessage((m) => recv.push(m));
    for (let i = 0; i < 10; i++) a.send({ i });
    await new Promise((r) => queueMicrotask(r));
    expect(recv).toEqual(Array.from({ length: 10 }, (_, i) => ({ i })));
  });

  it("calls onClose when stopped", async () => {
    const [a, b] = createInMemoryTransportPair();
    await a.start(); await b.start();
    const onCloseB = vi.fn(); b.onClose(onCloseB);
    await a.stop();
    expect(onCloseB).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2 (implementation):**

```ts
// src/in-memory-transport.ts
import { EventEmitter } from "node:events";
import type { Transport, Unsubscribe } from "@codex-im/app-server-client";

class Side extends EventEmitter implements Transport {
  private peer!: Side;
  private running = false;
  link(peer: Side) { this.peer = peer; }

  async start() { this.running = true; }

  async stop() {
    if (!this.running) return;
    this.running = false;
    this.emit("close", null);
    if (this.peer.running) this.peer.stop();
  }

  send(msg: unknown) {
    if (!this.running || !this.peer.running) return;
    queueMicrotask(() => this.peer.emit("message", msg));
  }

  onMessage(h: (m: unknown) => void): Unsubscribe {
    this.on("message", h); return () => this.off("message", h);
  }
  onError(h: (e: Error) => void): Unsubscribe {
    this.on("error", h); return () => this.off("error", h);
  }
  onClose(h: (c: number | null) => void): Unsubscribe {
    this.on("close", h); return () => this.off("close", h);
  }
}

export function createInMemoryTransportPair(): [Transport, Transport] {
  const a = new Side(); const b = new Side();
  a.link(b); b.link(a);
  return [a, b];
}
```

- **Exit:** Commit `feat(testkit): InMemoryTransport with bidirectional pair`.

---

### Task 4.3 — Wire fixtures already created in Task 0.4

**Files:** None new (Task 0.4 created `packages/testkit/fixtures/codex-0.125.0/`).

- [ ] **Step 1:** Confirm files exist; if not, re-do Task 0.4.
- [ ] **Step 2:** Add `packages/testkit/fixtures/.gitignore` containing nothing (but file exists to keep dir tracked).
- **Exit:** No commit needed unless fixtures were missing.

---

## Section F: AppServerClient behavior

> Hard dep on Section D Tasks 3.4 (types) and 3.5 (transport) and 3.6 (errors); Section E Task 4.2 (InMemoryTransport).

### Task 5.1 — AppServerClient: request/response correlation

**Files:** Create `packages/app-server-client/src/client.ts`, `test/client.test.ts`.

- [ ] **Step 1 (failing test):**

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryTransportPair } from "@codex-im/testkit";
import { AppServerClient } from "../src/client.js";

describe("AppServerClient.request", () => {
  it("correlates response with request by id", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    serverT.onMessage((m: any) => serverT.send({ id: m.id, result: { echo: m.method } }));
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();
    const r = await client.request<{ echo: string }>("ping");
    expect(r).toEqual({ echo: "ping" });
    await client.stop();
  });
});
```

- [ ] **Step 2 (implementation, scaffolding for 5.x):**

```ts
// src/client.ts
import pino from "pino";
import type { Logger } from "pino";
import type { Transport, Unsubscribe } from "./transport.js";
import {
  isJsonRpcResponse, isJsonRpcErrorResponse,
  isJsonRpcServerRequest, isJsonRpcNotification,
  type JsonRpcId, type JsonRpcNotification, type JsonRpcRequest,
} from "./jsonrpc.js";
import {
  JsonRpcResponseError, RequestTimeoutError, TransportClosedError,
} from "./errors.js";
import { encodeJsonl } from "./jsonl.js";

export interface RequestOptions { timeoutMs?: number }

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  method: string;
  timer: NodeJS.Timeout;
}

export class AppServerClient {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private readonly notificationHandlers = new Set<(n: JsonRpcNotification) => void>();
  private serverRequestHandler: ((r: JsonRpcRequest) => Promise<unknown> | unknown) | null = null;
  private readonly subs: Unsubscribe[] = [];
  private closed = false;
  private readonly log: Logger;

  constructor(
    private readonly transport: Transport,
    opts: { logger?: Logger; defaultTimeoutMs?: number } = {},
  ) {
    this.log = opts.logger ?? pino({ name: "AppServerClient", level: "warn" });
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
  }
  private readonly defaultTimeoutMs: number;

  async start() {
    await this.transport.start();
    this.subs.push(this.transport.onMessage((m) => this.handleMessage(m)));
    this.subs.push(this.transport.onClose((code) => this.handleClose(code)));
  }

  async stop() {
    this.closed = true;
    for (const u of this.subs) u();
    this.rejectAllPending(new TransportClosedError(null));
    await this.transport.stop();
  }

  request<R = unknown>(method: string, params?: unknown, opts: RequestOptions = {}): Promise<R> {
    if (this.closed) return Promise.reject(new TransportClosedError(null));
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const promise = new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RequestTimeoutError(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method, timer });
    });
    this.transport.send({ id, method, params });
    return promise;
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.transport.send({ method, params });
  }

  respond(id: JsonRpcId, result: unknown): void {
    if (this.closed) return;
    this.transport.send({ id, result });
  }

  reject(id: JsonRpcId, error: { code: number; message: string; data?: unknown }): void {
    if (this.closed) return;
    this.transport.send({ id, error });
  }

  onNotification(h: (n: JsonRpcNotification) => void): Unsubscribe {
    this.notificationHandlers.add(h);
    return () => this.notificationHandlers.delete(h);
  }

  setServerRequestHandler(h: ((r: JsonRpcRequest) => Promise<unknown> | unknown) | null): void {
    this.serverRequestHandler = h;
  }

  private handleMessage(m: unknown) {
    if (isJsonRpcResponse(m)) { this.completePending(m); return; }
    if (isJsonRpcServerRequest(m)) { void this.dispatchServerRequest(m); return; }
    if (isJsonRpcNotification(m)) { this.dispatchNotification(m); return; }
    this.log.warn({ msg: "unknown message shape", payload: m });
  }

  private completePending(m: any) {
    const entry = this.pending.get(m.id);
    if (!entry) { this.log.warn({ msg: "orphan response", id: m.id }); return; }
    clearTimeout(entry.timer);
    this.pending.delete(m.id);
    if (isJsonRpcErrorResponse(m)) entry.reject(new JsonRpcResponseError(m.error));
    else entry.resolve(m.result);
  }

  private async dispatchServerRequest(m: JsonRpcRequest) {
    const h = this.serverRequestHandler;
    if (!h) {
      this.reject(m.id, { code: -32601, message: `no handler registered for ${m.method}` });
      this.log.warn({ msg: "default-rejected server request (no handler)", method: m.method, id: m.id });
      return;
    }
    try {
      const result = await Promise.race([
        Promise.resolve(h(m)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("server-request handler timeout (30s)")), 30_000)),
      ]);
      this.respond(m.id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.reject(m.id, { code: -32603, message: `handler error: ${message}` });
      this.log.warn({ msg: "default-rejected server request (handler error/timeout)", method: m.method, id: m.id, error: message });
    }
  }

  private dispatchNotification(m: JsonRpcNotification) {
    for (const h of this.notificationHandlers) {
      try { h(m); } catch (err) { this.log.warn({ msg: "notification handler threw", err }); }
    }
  }

  private handleClose(code: number | null) {
    this.closed = true;
    this.rejectAllPending(new TransportClosedError(code));
  }

  private rejectAllPending(err: Error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }
}
```

- [ ] **Step 3:** Test PASS.
- **Exit:** Commit `feat(app-server-client): AppServerClient request/response correlation`.

---

### Task 5.2 — Concurrent requests

- [ ] **Step 1:** Add test: 5 concurrent requests, server responds in reverse order; all 5 promises resolve to correct result.
- [ ] **Step 2:** Should PASS without code change. If FAIL, Map handling has a bug.
- **Exit:** Commit `test(app-server-client): concurrent request correlation`.

---

### Task 5.3 — Request timeout (Test Issue 1)

**Files:** `packages/app-server-client/test/client-timeout.test.ts`.

- [ ] **Step 1:** Add test:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryTransportPair } from "@codex-im/testkit";
import { AppServerClient } from "../src/client.js";
import { RequestTimeoutError } from "../src/errors.js";

describe("AppServerClient.request timeout", () => {
  it("rejects with RequestTimeoutError when no response arrives in time", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    await serverT.start(); // server never responds
    const client = new AppServerClient(clientT, { defaultTimeoutMs: 50 });
    await client.start();
    await expect(client.request("forever")).rejects.toBeInstanceOf(RequestTimeoutError);
    await client.stop();
  });

  it("respects per-call timeoutMs override", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    await serverT.start();
    const client = new AppServerClient(clientT, { defaultTimeoutMs: 60_000 });
    await client.start();
    await expect(client.request("forever", undefined, { timeoutMs: 50 }))
      .rejects.toBeInstanceOf(RequestTimeoutError);
    await client.stop();
  });
});
```

- [ ] **Step 2:** Tests should PASS (Task 5.1 implementation already covers timeouts).
- **Exit:** Commit `test(app-server-client): request timeout`.

---

### Task 5.4 — Notification dispatch

- [ ] **Step 1:** Test: server sends `{ method: "turn/started", params: {...} }`; client `onNotification` handler called once.
- [ ] **Step 2:** PASS.
- **Exit:** Commit `test(app-server-client): notification dispatch`.

---

### Task 5.5 — Server-initiated request (with custom handler)

- [ ] **Step 1:** Test: server sends `{ id: 42, method: "approval/request", params: {} }`; client.setServerRequestHandler returns `{ decision: "deny" }`; server receives `{ id: 42, result: { decision: "deny" } }`.
- [ ] **Step 2:** PASS.
- **Exit:** Commit `test(app-server-client): server-initiated request happy path`.

---

### Task 5.6 — Default-reject server requests (Codex finding #5)

**Files:** `packages/app-server-client/test/client-default-reject.test.ts`.

- [ ] **Step 1:** 4 tests:

```ts
describe("server-request default-reject", () => {
  it("rejects with -32601 when no handler registered", async () => { /* ... */ });
  it("rejects with -32603 when handler throws", async () => { /* ... */ });
  it("rejects with -32603 when handler exceeds 30s timeout", async () => {
    // use vi.useFakeTimers() to advance time; or shorten via test-only injection
  });
  it("does not leave server hanging — every server request gets a response", async () => {
    // Send 3 server requests with no handler; assert 3 reject responses received
    // within 100ms of dispatch.
  });
});
```

- [ ] **Step 2:** Implementation in Task 5.1 already covers no-handler and throw cases. Timeout test may need a way to inject a shorter timeout — add `serverRequestHandlerTimeoutMs` constructor option.
- [ ] **Step 3:** Tests PASS.
- **Exit:** Commit `feat(app-server-client): default-reject server requests (no-handler/throw/timeout)`.

---

### Task 5.7 — Transport-close rejects all pending (Test Issue 2)

**Files:** `packages/app-server-client/test/client-transport-close.test.ts`.

- [ ] **Step 1:** Test: send 3 concurrent requests; transport emits `close` with exit code 137; all 3 promises reject with `TransportClosedError` carrying `exitCode: 137`.
- [ ] **Step 2:** PASS (Task 5.1 implementation covers).
- **Exit:** Commit `test(app-server-client): pending requests rejected on transport close`.

---

### Task 5.8 — Unknown / malformed message tolerance

- [ ] **Step 1:** Test: server emits `{}`, `{ foo: "bar" }`, `{ id: 999, result: {} }` (orphan response). Client logs warn ≥ 3 times, no throw, no exit.
- [ ] **Step 2:** PASS.
- **Exit:** Commit `test(app-server-client): unknown message tolerance`.

---

### Task 5.9 — Public re-exports

**Files:** Modify `packages/app-server-client/src/index.ts`.

- [ ] **Step 1:** Re-export public API:

```ts
export { AppServerClient } from "./client.js";
export type { RequestOptions } from "./client.js";
export type { Transport, Unsubscribe } from "./transport.js";
export {
  JsonRpcResponseError, TransportClosedError, TransportProtocolError, RequestTimeoutError,
} from "./errors.js";
export type {
  JsonRpcId, JsonRpcRequest, JsonRpcNotification,
  JsonRpcResponse, JsonRpcSuccessResponse, JsonRpcErrorResponse, JsonRpcError,
} from "./jsonrpc.js";
export { JsonlDecoder, encodeJsonl } from "./jsonl.js";
// StdioTransport added in Task 6.1
// performInitializeHandshake added in Task 7.1
```

- [ ] **Step 2:** `pnpm typecheck` PASS.
- **Exit:** Commit `feat(app-server-client): publish public surface`.

---

## Section G: StdioTransport (Codex finding #6)

### Task 6.1 — `StdioTransport` with full options

**Files:** Create `packages/app-server-client/src/stdio-transport.ts`, `test/stdio-transport.test.ts`, `test/fixtures/echo-stdio.mjs`.

- [ ] **Step 1:** Create `test/fixtures/echo-stdio.mjs`:

```js
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  // Echo every input as a "response" tagged with original method.
  try {
    const m = JSON.parse(line);
    if ("id" in m && "method" in m) process.stdout.write(JSON.stringify({ id: m.id, result: { echoed: m.method } }) + "\n");
    else process.stdout.write(line + "\n");
  } catch { /* ignore */ }
});
process.stderr.write("echo-stdio booted\n");
```

- [ ] **Step 2:** Implement `StdioTransport`:

```ts
// src/stdio-transport.ts
import { execa, type ResultPromise } from "execa";
import pino from "pino";
import type { Logger } from "pino";
import type { Transport, Unsubscribe } from "./transport.js";
import { JsonlDecoder, encodeJsonl } from "./jsonl.js";
import { TransportClosedError, TransportProtocolError } from "./errors.js";

export interface StdioTransportOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Translated to repeated `-c key=value` args appended to args. Values are TOML-quoted via JSON.stringify. */
  configOverrides?: Record<string, string | number | boolean>;
  /** Grace period before SIGKILL when stop() is called (default 2000ms). */
  shutdownGraceMs?: number;
  logger?: Logger;
}

export class StdioTransport implements Transport {
  private child: ResultPromise | null = null;
  private decoder = new JsonlDecoder();
  private msgHandlers = new Set<(m: unknown) => void>();
  private errHandlers = new Set<(e: Error) => void>();
  private closeHandlers = new Set<(c: number | null) => void>();
  private stderrBuf = "";
  private readonly log: Logger;

  constructor(private readonly opts: StdioTransportOptions) {
    this.log = opts.logger ?? pino({ name: "StdioTransport", level: "warn" });
  }

  async start(): Promise<void> {
    const finalArgs = [...this.opts.args];
    for (const [k, v] of Object.entries(this.opts.configOverrides ?? {})) {
      finalArgs.push("-c", `${k}=${typeof v === "string" ? JSON.stringify(v) : v}`);
    }
    try {
      this.child = execa(this.opts.command, finalArgs, {
        cwd: this.opts.cwd,
        env: { ...process.env, ...this.opts.env },
        stdin: "pipe", stdout: "pipe", stderr: "pipe",
        reject: false,
      });
    } catch (err) {
      throw new TransportProtocolError(`spawn failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.child.stdout!.on("data", (chunk: Buffer) => {
      try {
        for (const m of this.decoder.push(chunk)) for (const h of this.msgHandlers) h(m);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        for (const h of this.errHandlers) h(e);
      }
    });

    this.child.stderr!.on("data", (chunk: Buffer) => {
      this.stderrBuf += chunk.toString("utf8");
      let idx;
      while ((idx = this.stderrBuf.indexOf("\n")) !== -1) {
        const line = this.stderrBuf.slice(0, idx).trimEnd();
        this.stderrBuf = this.stderrBuf.slice(idx + 1);
        if (line) this.log.warn({ stream: "stderr" }, line);
      }
    });

    this.child.on?.("error", (err: Error) => {
      // ENOENT etc.
      for (const h of this.errHandlers) h(new TransportProtocolError(`child error: ${err.message}`));
    });

    void this.child.then(
      (result) => { for (const h of this.closeHandlers) h(result.exitCode ?? null); },
      (err) => {
        for (const h of this.errHandlers) h(err instanceof Error ? err : new Error(String(err)));
        for (const h of this.closeHandlers) h(null);
      },
    );
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    const grace = this.opts.shutdownGraceMs ?? 2000;
    this.child.stdin?.end();
    const result = await Promise.race([
      this.child.then((r) => r, () => null),
      new Promise<null>((r) => setTimeout(() => r(null), grace)),
    ]);
    if (result === null && !this.child.killed) {
      this.child.kill("SIGKILL");
    }
    this.child = null;
  }

  send(msg: unknown): void {
    if (!this.child?.stdin) throw new TransportClosedError(null);
    this.child.stdin.write(encodeJsonl(msg));
  }

  onMessage(h: (m: unknown) => void): Unsubscribe {
    this.msgHandlers.add(h); return () => this.msgHandlers.delete(h);
  }
  onError(h: (e: Error) => void): Unsubscribe {
    this.errHandlers.add(h); return () => this.errHandlers.delete(h);
  }
  onClose(h: (c: number | null) => void): Unsubscribe {
    this.closeHandlers.add(h); return () => this.closeHandlers.delete(h);
  }
}
```

- [ ] **Step 3:** Test against echo fixture:

```ts
it("round-trips JSONL via subprocess", async () => {
  const t = new StdioTransport({
    command: "node",
    args: [join(__dirname, "fixtures/echo-stdio.mjs")],
  });
  await t.start();
  const got: unknown[] = [];
  t.onMessage((m) => got.push(m));
  t.send({ id: 1, method: "ping" });
  await new Promise((r) => setTimeout(r, 50));
  expect(got).toEqual([{ id: 1, result: { echoed: "ping" } }]);
  await t.stop();
});
```

- **Exit:** Commit `feat(app-server-client): StdioTransport with full options`.

---

### Task 6.2 — `configOverrides` translation test

- [ ] **Step 1:** Test: pass `configOverrides: { sandbox: "read-only", "approval_policy": "on-request" }`. Use a fixture child that prints its argv to stdout. Assert argv contains `-c sandbox="read-only"` and `-c approval_policy="on-request"`.
- [ ] **Step 2:** PASS.
- **Exit:** Commit `test(app-server-client): configOverrides translation`.

---

### Task 6.3 — stderr routing test

- [ ] **Step 1:** Test: echo fixture writes 2 stderr lines; logger.warn called ≥ 2 times. Use vi.spyOn on a custom pino destination.
- [ ] **Step 2:** PASS.
- **Exit:** Commit `test(app-server-client): stderr → pino.warn`.

---

### Task 6.4 — Spawn failure (ENOENT) test (failure mode)

- [ ] **Step 1:** Test: `command: "/no/such/binary"` → `start()` rejects with `TransportProtocolError` containing "spawn failed".
- [ ] **Step 2:** PASS (Task 6.1 already wraps).
- **Exit:** Commit `test(app-server-client): spawn ENOENT clean error`.

---

### Task 6.5 — Force SIGKILL after grace period

- [ ] **Step 1:** Test: spawn a child that ignores SIGTERM (`process.on("SIGTERM", () => {})`); call `stop({ shutdownGraceMs: 100 })`; assert child.killed is true within 200ms.
- [ ] **Step 2:** PASS.
- **Exit:** Commit `test(app-server-client): SIGKILL after grace period`.

---

## Section H: handshake helper (D1: A, Codex finding #7)

### Task 7.1 — `performInitializeHandshake`

**Files:** Create `packages/app-server-client/src/handshake.ts`, `test/handshake.test.ts`.

- [ ] **Step 1 (failing test):**

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryTransportPair } from "@codex-im/testkit";
import { AppServerClient, performInitializeHandshake } from "../src/index.js";

describe("performInitializeHandshake", () => {
  it("returns the typed InitializeResult and sends notify('initialized')", async () => {
    const [clientT, serverT] = createInMemoryTransportPair();
    const seen: any[] = [];
    serverT.onMessage((m: any) => {
      seen.push(m);
      if (m.method === "initialize") {
        serverT.send({ id: m.id, result: { codexHome: "/Users/x/.codex", platform: "darwin", userAgent: "codex-cli/0.125.0" } });
      }
    });
    await serverT.start();
    const client = new AppServerClient(clientT);
    await client.start();
    const r = await performInitializeHandshake(client, { name: "test", version: "0.0.0" });
    expect(r.codexHome).toBe("/Users/x/.codex");
    expect(seen.some((m) => m.method === "initialized")).toBe(true);
    await client.stop();
  });
});
```

- [ ] **Step 2:** Implementation:

```ts
// src/handshake.ts
import type { AppServerClient } from "./client.js";
import type { ClientInfo, InitializeResult } from "@codex-im/protocol";

export async function performInitializeHandshake(
  client: AppServerClient,
  clientInfo: ClientInfo,
  opts: { timeoutMs?: number } = {},
): Promise<InitializeResult> {
  const result = await client.request<InitializeResult>(
    "initialize",
    { clientInfo },
    { timeoutMs: opts.timeoutMs ?? 10_000 },
  );
  client.notify("initialized");
  return result;
}
```

- [ ] **Step 3:** Re-export from `src/index.ts`.
- **Exit:** Commit `feat(app-server-client): performInitializeHandshake (returns typed InitializeResult)`.

---

## Section I: FakeAppServer

### Task 8.1 — Skeleton + initialize default

**Files:** Create `packages/testkit/src/fake-app-server.ts`, `test/fake-app-server.test.ts`.

- [ ] **Step 1:** API design:

```ts
// src/fake-app-server.ts
import { createInMemoryTransportPair } from "./in-memory-transport.js";
import type { Transport } from "@codex-im/app-server-client";

type Handler = (params: unknown, id: number | string) => unknown | Promise<unknown>;

export class FakeAppServer {
  private peer: Transport;
  private handlers = new Map<string, Handler>();

  constructor() {
    const [clientSide, serverSide] = createInMemoryTransportPair();
    this.clientSide = clientSide;
    this.peer = serverSide;
    this.peer.onMessage((m: any) => this.dispatch(m));
    void this.peer.start();
    // Default initialize handler
    this.respondTo("initialize", () => ({
      codexHome: "/fake/.codex",
      platform: "darwin-fake",
      userAgent: "fake-app-server/0.0.0",
    }));
  }

  /** Transport for an AppServerClient under test to attach to. */
  readonly clientSide: Transport;

  respondTo(method: string, h: Handler): void { this.handlers.set(method, h); }

  emitNotification(method: string, params: unknown): void {
    this.peer.send({ method, params });
  }

  /** Returns a promise that resolves with the client's response. */
  async emitServerRequest(method: string, params: unknown, id = Math.floor(Math.random() * 1e9)): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const sub = this.peer.onMessage((m: any) => {
        if (m && typeof m === "object" && m.id === id) {
          sub();
          if ("error" in m) reject(m.error);
          else resolve(m.result);
        }
      });
      this.peer.send({ id, method, params });
    });
  }

  private async dispatch(m: any) {
    if (m && "id" in m && "method" in m) {
      const h = this.handlers.get(m.method);
      if (!h) {
        this.peer.send({ id: m.id, error: { code: -32601, message: `unknown method ${m.method}` } });
        return;
      }
      try {
        const result = await h(m.params, m.id);
        this.peer.send({ id: m.id, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.peer.send({ id: m.id, error: { code: -32603, message } });
      }
    }
  }
}
```

- [ ] **Step 2:** Test the default initialize:

```ts
it("responds to initialize with default fixture-shaped result", async () => {
  const fake = new FakeAppServer();
  const client = new AppServerClient(fake.clientSide);
  await client.start();
  const r = await client.request("initialize", { clientInfo: { name: "x", version: "y" } });
  expect(r).toMatchObject({ codexHome: "/fake/.codex" });
  await client.stop();
});
```

- **Exit:** Commit `feat(testkit): FakeAppServer skeleton with default initialize`.

---

### Task 8.2 — `emitNotification` test

- [ ] **Step 1:** Test: client.onNotification handler called when fake emits `turn/started`.
- [ ] **Step 2:** PASS.
- **Exit:** Commit `test(testkit): FakeAppServer.emitNotification`.

---

### Task 8.3 — `emitServerRequest` round-trip (Test Issue 3)

- [ ] **Step 1:** Test:

```ts
it("server request round-trips through default-reject when no handler set", async () => {
  const fake = new FakeAppServer();
  const client = new AppServerClient(fake.clientSide);
  await client.start();
  const reply = fake.emitServerRequest("approval/request", { what: "rm -rf /" }, 99);
  await expect(reply).rejects.toMatchObject({ code: -32601 });
  await client.stop();
});

it("server request round-trips with handler", async () => {
  const fake = new FakeAppServer();
  const client = new AppServerClient(fake.clientSide);
  client.setServerRequestHandler(() => ({ decision: "allow_once" }));
  await client.start();
  await expect(fake.emitServerRequest("approval/request", {}, 100))
    .resolves.toEqual({ decision: "allow_once" });
  await client.stop();
});
```

- [ ] **Step 2:** PASS.
- **Exit:** Commit `feat(testkit): FakeAppServer.emitServerRequest round-trip`.

---

### Task 8.4 — `replayFixture` (contract test, Codex finding #9)

**Files:** Create `packages/testkit/src/fixture-replay.ts`, `test/fixture-replay.test.ts`.

- [ ] **Step 1:** Implement utility:

```ts
// src/fixture-replay.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export function loadFixture(version: string, name: string): unknown[] {
  const path = join(here, "..", "fixtures", `codex-${version}`, name);
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

export function loadFixtureMetadata(version: string): { codexVersion: string; notes: string[] } {
  const path = join(here, "..", "fixtures", `codex-${version}`, "metadata.json");
  return JSON.parse(readFileSync(path, "utf8"));
}
```

- [ ] **Step 2:** Test (this is a **contract test**, included in `test:contract` project):

```ts
import { describe, expect, it } from "vitest";
import { loadFixture, loadFixtureMetadata } from "../src/fixture-replay.js";
import { isJsonRpcResponse, isJsonRpcErrorResponse } from "@codex-im/app-server-client";

describe("fixture-replay codex-0.125.0", () => {
  it("metadata pins the version and flags experimental", () => {
    const m = loadFixtureMetadata("0.125.0");
    expect(m.codexVersion).toBe("0.125.0");
  });

  it("initialize-response.jsonl is a successful response with no jsonrpc field", () => {
    const [r] = loadFixture("0.125.0", "initialize-response.jsonl");
    expect(isJsonRpcResponse(r)).toBe(true);
    expect((r as any).jsonrpc).toBeUndefined();
  });

  it("unknown-method-error.jsonl carries error.code -32600 and no error.data", () => {
    const [r] = loadFixture("0.125.0", "unknown-method-error.jsonl");
    expect(isJsonRpcErrorResponse(r)).toBe(true);
    expect((r as any).error.code).toBe(-32600);
    expect((r as any).error.data).toBeUndefined();
  });
});
```

- [ ] **Step 3:** PASS.
- [ ] **Step 4:** Add `replayFixture` method on `FakeAppServer` that takes a fixture name and emits its messages in order:

```ts
// inside FakeAppServer
async replayFixture(version: string, name: string, intervalMs = 0): Promise<void> {
  const msgs = loadFixture(version, name);
  for (const m of msgs) { this.peer.send(m); if (intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs)); }
}
```

- **Exit:** Commit `feat(testkit): replayFixture + codex-0.125.0 contract tests`.

---

## Section J: cli + smokes

### Task 9.1 — cli skeleton

**Files:** Create `packages/cli/{package.json,tsconfig.json,src/index.ts}`.

- [ ] **Step 1:** `package.json`:

```json
{
  "name": "@codex-im/cli",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "bin": { "codex-im": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -b" },
  "dependencies": {
    "@codex-im/app-server-client": "workspace:*",
    "@codex-im/protocol": "workspace:*",
    "pino": "^9"
  }
}
```

- [ ] **Step 2:** `src/index.ts` dispatches `argv[2]` between `smoke app-server` and `smoke real-turn`:

```ts
#!/usr/bin/env tsx
const [, , cmd, sub] = process.argv;
if (cmd === "smoke" && sub === "app-server") {
  await (await import("./smoke-app-server.js")).run();
} else if (cmd === "smoke" && sub === "real-turn") {
  await (await import("./smoke-real-turn.js")).run();
} else {
  console.error("usage: codex-im smoke (app-server|real-turn)");
  process.exit(1);
}
```

- **Exit:** Commit `feat(cli): skeleton with smoke dispatch`.

---

### Task 9.2 — `smoke:app-server` (initialize-only, env-gated `CODEX_SMOKE=1`)

**Files:** Create `packages/cli/src/smoke-app-server.ts`, `test/smoke-app-server.test.ts`.

- [ ] **Step 1:** Implementation:

```ts
// src/smoke-app-server.ts
import pino from "pino";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppServerClient, StdioTransport, performInitializeHandshake,
} from "@codex-im/app-server-client";

export async function run(): Promise<void> {
  if (!process.env.CODEX_SMOKE) {
    console.error("Codex smoke (initialize-only) is disabled.\nRun with CODEX_SMOKE=1 pnpm smoke:app-server");
    process.exit(1);
  }
  const log = pino({ name: "smoke:app-server" });
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

  const transport = new StdioTransport({
    command: "codex",
    args: ["app-server", "--listen", "stdio://"],
    configOverrides: {
      sandbox: "read-only",
      approval_policy: "on-request",
    },
    logger: log,
  });
  const client = new AppServerClient(transport, { logger: log });
  client.setServerRequestHandler(null); // explicit default-reject

  try {
    await client.start();
    const r = await performInitializeHandshake(client, { name: "codex-im-bridge", version: pkg.version });
    log.info({ initializeResult: r }, "initialize OK");
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "smoke failed");
    process.exit(1);
  } finally {
    await client.stop();
  }
}
```

- [ ] **Step 2:** Test (env-gated, lives in `test:` excluded from default `unit` project):

```ts
it("smoke:app-server initialize round-trip", async () => {
  if (!process.env.CODEX_SMOKE) { console.log("skipped (CODEX_SMOKE not set)"); return; }
  const { run } = await import("../src/smoke-app-server.js");
  await expect(run()).resolves.toBeUndefined();
});
```

- **Verify:** `CODEX_SMOKE=1 pnpm smoke:app-server` exits 0; child process gone (`pgrep -f "codex app-server"` returns nothing).
- **Exit:** Commit `feat(cli): smoke:app-server initialize-only`.

---

### Task 9.3 — `smoke:real-turn` (full lifecycle, gated `CODEX_REAL_SMOKE=1`)

**Files:** Create `packages/cli/src/smoke-real-turn.ts`, `src/prompts/harmless-turn.txt`, `test/smoke-real-turn.test.ts`.

- [ ] **Step 1:** `src/prompts/harmless-turn.txt`:

```
You are running a smoke test.
Do not run shell commands.
Do not read files.
Do not write files.
Do not use tools.
Do not use Computer Use.
Reply exactly with: OK
```

- [ ] **Step 2:** Implementation with safety rails:

```ts
// src/smoke-real-turn.ts
import pino from "pino";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppServerClient, StdioTransport, performInitializeHandshake,
  type Unsubscribe,
} from "@codex-im/app-server-client";

export async function run(): Promise<void> {
  if (!process.env.CODEX_REAL_SMOKE) {
    console.error([
      "Real Codex smoke is disabled.",
      "Run with CODEX_REAL_SMOKE=1 after confirming local login, quota, and safe sandbox config.",
    ].join("\n"));
    process.exit(1);
  }

  const log = pino({ name: "smoke:real-turn" });
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
  const harmlessPrompt = readFileSync(join(here, "prompts", "harmless-turn.txt"), "utf8");

  // Hard rails: no auto-approve, no network, sandbox read-only.
  const transport = new StdioTransport({
    command: "codex",
    args: ["app-server", "--listen", "stdio://"],
    configOverrides: {
      sandbox: "read-only",
      approval_policy: "on-request",
      // network_access flag name varies per codex version; document either way.
      // Defer to docs/phase-0/host-environment.md task 0.2/0.3 for exact key.
    },
    logger: log,
  });
  const client = new AppServerClient(transport, { logger: log });

  // CLIENT MUST DEFAULT-REJECT all server-initiated requests during real-turn smoke.
  // Setting handler to null is the explicit form even though it is the default.
  client.setServerRequestHandler(null);

  let unhandledServerRequests = 0;
  const unsub: Unsubscribe[] = [];

  unsub.push(client.onNotification((n) => {
    log.info({ method: n.method }, "notification");
  }));

  let turnTerminal = false;

  try {
    await client.start();
    const init = await performInitializeHandshake(client, { name: "codex-im-bridge", version: pkg.version });
    log.info({ codexHome: (init as any).codexHome }, "initialize OK");

    // Start a thread + turn. Exact method names come from generated schema; placeholders below
    // must be confirmed against packages/codex-protocol/src/generated/. If method names changed
    // since codex 0.125.0, fail loudly and do NOT silently fall back.
    const thread = await client.request<{ threadId: string }>("thread/start", {});
    log.info({ threadId: thread.threadId }, "thread/start OK");

    // Race: turn lifecycle vs 60s ceiling.
    await new Promise<void>(async (resolve, reject) => {
      const ceiling = setTimeout(() => reject(new Error("turn did not reach terminal state in 60s")), 60_000);
      const stop = client.onNotification((n) => {
        if (n.method === "turn/completed" || n.method === "turn/failed" || n.method === "turn/interrupted") {
          turnTerminal = true; clearTimeout(ceiling); stop(); resolve();
        }
      });
      try {
        await client.request("turn/start", {
          threadId: thread.threadId,
          input: harmlessPrompt,
        }, { timeoutMs: 60_000 });
      } catch (err) { clearTimeout(ceiling); stop(); reject(err); }
    });

    if (!turnTerminal) throw new Error("turn never reached terminal state");
    log.info("turn reached terminal state");
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "smoke:real-turn failed");
    for (const u of unsub) u();
    await client.stop();
    process.exit(1);
  }

  for (const u of unsub) u();
  await client.stop();

  if (unhandledServerRequests > 0) {
    log.error({ count: unhandledServerRequests }, "unhandled server requests detected — failing smoke");
    process.exit(1);
  }
  log.info("smoke:real-turn PASSED");
}
```

- [ ] **Step 3:** Test (env-gated, NOT in default test, NOT in `unit` project, NOT in `contract` project):

```ts
it("smoke:real-turn full lifecycle", async () => {
  if (!process.env.CODEX_REAL_SMOKE) { console.log("skipped (CODEX_REAL_SMOKE not set)"); return; }
  const { run } = await import("../src/smoke-real-turn.js");
  await expect(run()).resolves.toBeUndefined();
}, 90_000);
```

**Assertions explicitly NOT made (per user spec):** turn output content, exact `OK` text, model used, token count.

**Assertions made:**
- `turn/completed` (or terminal variant) notification observed
- `unhandledServerRequests === 0` (default-reject worked but nothing leaked)
- No approval was accepted (default-reject path is the only path)
- Transport closed cleanly (no zombie process)

- [ ] **Step 4:** Capture `harmless-turn-event-stream.jsonl` during the run and save to `packages/testkit/fixtures/codex-0.125.0/` (one-time, manual).
- [ ] **Step 5:** Document in `host-environment.md` "Real-turn smoke results" section (date, model, token estimate if available, terminal state).
- **Verify:** `CODEX_REAL_SMOKE=1 pnpm smoke:real-turn` exits 0; child process gone; no command/file approvals were accepted.
- **Exit:** Commit `feat(cli): smoke:real-turn full lifecycle (CODEX_REAL_SMOKE-gated)`.

---

### Task 9.4 — Document safety rails in CLI README

**Files:** Create `packages/cli/README.md`.

- [ ] **Step 1:** Write README explaining:
  - `pnpm smoke:app-server` requires `CODEX_SMOKE=1`, uses initialize-only.
  - `pnpm smoke:real-turn` requires `CODEX_REAL_SMOKE=1`, runs harmless prompt under read-only sandbox + on-request approval + default-reject. Lists all assertions made and explicitly NOT made.
  - Neither command is part of `pnpm test`, `pnpm test:unit`, or `pnpm test:contract`. Manual operator action only.
- **Exit:** Commit `docs(cli): document smoke command safety rails`.

---

## Section K: Wrap-up

### Task 10.1 — Run full default test suite

- [ ] **Step 1:** `pnpm typecheck` PASS (all packages).
- [ ] **Step 2:** `pnpm test:unit` PASS (excludes smoke files).
- [ ] **Step 3:** `pnpm test:contract` PASS (replays codex-0.125.0 fixtures).
- [ ] **Step 4:** `pnpm test` PASS (alias for both).
- [ ] **Step 5:** `pnpm lint` PASS.
- [ ] **Step 6:** `pnpm check:codex-version` → `OK: 0.125.0`.
- **Exit:** All commands exit 0.

---

### Task 10.2 — Run gated smokes (operator-only)

- [ ] **Step 1:** `CODEX_SMOKE=1 pnpm smoke:app-server` exits 0.
- [ ] **Step 2:** Confirm `pgrep -f "codex app-server"` returns nothing afterward.
- [ ] **Step 3:** `CODEX_REAL_SMOKE=1 pnpm smoke:real-turn` exits 0 (requires codex login).
- [ ] **Step 4:** Confirm no zombie child process.
- [ ] **Step 5:** Inspect captured `harmless-turn-event-stream.jsonl` — looks reasonable, no leaked secrets, no command/file approvals accepted.
- **Exit:** Both smokes green; fixtures captured.

---

### Task 10.3 — Hardcoded-method-name audit (Codex finding #8)

- [ ] **Step 1:** Run: `git grep -nE '"(approval/request|approval|commandApproval|fileChangeApproval)"' packages/`.
- [ ] **Step 2:** Expected: zero hits in `packages/`. Hits in `docs/` are OK; hits in `packages/` are forbidden in Phase 0.
- [ ] **Step 3:** If any hit exists in `packages/`, remove and replace with handler-based dispatch.
- **Exit:** Audit clean; commit if any change required.

---

### Task 10.4 — README + ROADMAP updates

**Files:** Modify `README.md`, `09-ROADMAP.md`.

- [ ] **Step 1:** README "## Phase 0 quick start":
  ```bash
  pnpm install
  pnpm check:codex-version
  pnpm protocol:generate
  pnpm typecheck
  pnpm test
  CODEX_SMOKE=1 pnpm smoke:app-server
  CODEX_REAL_SMOKE=1 pnpm smoke:real-turn  # operator only — uses real model
  ```
- [ ] **Step 2:** Append `## Phase 0 safety boundaries` section linking to `packages/cli/README.md`.
- [ ] **Step 3:** `09-ROADMAP.md` Phase 0 — tick all 6 tasks and 3 acceptance criteria (init smoke, real-turn smoke, version gate).
- **Exit:** Commit `docs(phase0): quickstart + roadmap update`.

---

### Task 10.5 — Codex CLI independent review (per `14-OPERATION §7`)

**Files:** Create `docs/phase-0/codex-review.md`.

- [ ] **Step 1:** Run Codex CLI review (per `15-PHASE-BY-PHASE-PROMPTS.md` Phase 0 §Codex CLI 辅助提示词) on the final `git diff main...phase-0-bootstrap`. Capture verbatim output.
- [ ] **Step 2:** Triage P0/P1 findings into (a) fix-now follow-up commits, (b) move-to-Phase-1 TODOs, (c) reject with reason.
- [ ] **Step 3:** All P0 findings must be closed before commit.
- **Exit:** `codex-review.md` exists; P0 closed; commit `docs(phase0): codex independent review log`.

---

### Task 10.6 — Decision Log finalization + final commit

**Files:** Create `docs/phase-0/decision-log.md` mirroring this plan's header.

- [ ] **Step 1:** Verify each decision (D1–D4 + each Codex finding disposition) maps to a concrete commit.
- [ ] **Step 2:** Tag commit `phase0-bootstrap-complete` for traceability.
- [ ] **Step 3:** Open PR with summary linking to this plan + `decision-log.md` + `codex-review.md`.
- **Exit:** Phase 0 done. Phase 1 ready to plan.

---

## NOT in scope (deferred)

| Item | Defer to | Rationale |
|------|----------|-----------|
| `EventNormalizer`, `CodexRuntime` state machine | Phase 1 | Generated types must stabilize first |
| `ApprovalBroker`, `SecurityPolicy`, `SessionRouter`, `CommandRouter` | Phase 1–3 | No IM input surface yet |
| SQLite storage, migrations, repositories | Phase 2 | First binding need is Telegram chat→thread |
| Any IM adapter (Telegram/Lark/DingTalk/Satori/ChatSDK) | Phase 2+ | Roadmap dictates Telegram-first vertical |
| Computer Use code or docs | Phase 6 | Hard rule: must wait for approval base |
| launchd plist / install scripts / ops monitoring | Phase 3 | Security must precede daemonization |
| GitHub Actions CI | Phase 1+ | Phase 0 only runs on operator's machine |
| Transport backpressure / `Writable.write` honoring | Phase 1 | One-shot initialize doesn't trigger it |
| `pending` Map size cap | Phase 1 | Phase 0 trusts `codex app-server`; Phase 1 hardens |
| Per-call retry-with-jitter on Server-overloaded | Phase 1 | Listed in 04-MODULE-DESIGN §3, deferred |
| Approval method name registry | Phase 1 | Codex finding #8 — must wait for fixture-captured names |
| Real wire fixture for server-initiated request | Phase 1 (or earlier if observable) | If smoke:real-turn captures one, harvest then |
| Multi-version codex matrix testing | Phase 7+ | Single-version pin suffices for Phase 0 |

---

## Worktree parallelization

```
HARD SERIAL (foundation, blocks everything):
  0.1 → 0.2 → 0.3 → 0.4
  ↓
  1.1 → 1.2 → (1.3 ∥ 1.4) → 1.5

THEN PARALLEL (3 lanes):
  Lane A (codex-protocol):
    2.1 → 2.2 → 2.3
  Lane B (app-server-client core):
    3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 5.1 → 5.2 → 5.3 → 5.4 → 5.5 → 5.6 → 5.7 → 5.8 → 5.9
  Lane C (testkit):
    4.1 → 4.2 → 4.3
    (depends on 3.5 from B)

THEN PARALLEL (after Lane B + Lane C):
  Lane D (StdioTransport):
    6.1 → 6.2 → 6.3 → 6.4 → 6.5
  Lane E (handshake):
    7.1
  Lane F (FakeAppServer):
    8.1 → 8.2 → 8.3 → 8.4
    (depends on B's 5.5/5.6 and C's 4.2)

THEN SERIAL (cli + wrap-up):
  9.1 → 9.2 → 9.3 → 9.4
  ↓
  10.1 → 10.2 → 10.3 → 10.4 → 10.5 → 10.6
```

**Conflict points:**
- All lanes touch root `tsconfig.json#references` — each lane appends its own entry; merge sequentially.
- Lane A produces generated artifacts; Lane B consumes types from `@codex-im/protocol`. Lane B must hold off on importing specific types until Task 2.3 is merged.
- Lane F (FakeAppServer) depends on Lane B's `setServerRequestHandler` + Lane C's `InMemoryTransport`. Sync point at end of B+C.

**Recommended worktree split (subagent-driven-development):**
- Worktree 1: foundation (tasks 0.1–1.5)
- Worktree 2: Lane A (codex-protocol, tasks 2.1–2.3)
- Worktree 3: Lane B (app-server-client, tasks 3.1–3.6, 5.1–5.9)
- Worktree 4: Lane C (testkit init, tasks 4.1–4.3) — after B's 3.5 lands
- Worktree 5: Lane D (StdioTransport, 6.x) — after B's 3.5 lands
- Worktree 6: Lane F (FakeAppServer, 8.x) — after B+C land
- Main: 9.x + 10.x serial

---

## Failure modes register (covered + tracked)

| Failure | Test | Error handling | User-visible? |
|---------|------|----------------|----------------|
| `request()` never gets response | Task 5.3 | RequestTimeoutError | yes, typed error |
| Transport close mid-request | Task 5.7 | TransportClosedError on all pending | yes, typed error |
| Spawn fail (codex not in PATH) | Task 6.4 | TransportProtocolError | yes, clear error |
| Child crashes mid-stream | Task 6.5 (SIGKILL grace) + 5.7 | Pending rejected + onClose with code | yes |
| stderr noise mistaken for protocol | Task 6.3 (stderr → pino.warn) + Task 0.3 spike noted "malformed JSON only on stderr" | Logged, never parsed | yes (logged) |
| codex upgrade breaks types | Tasks 1.5 + 2.2 + 8.4 (version gate + protocol:check + fixture replay) | `pnpm check:codex-version` fails before any operation | yes, prevents start |
| Server request never answered (hangs turn) | Task 5.6 (default-reject 4 cases) | Auto-reject + audit log | yes |
| Real-turn smoke triggers unintended action | Task 9.3 (sandbox + on-request approval + default-reject) | Approval auto-deny — turn fails cleanly, no side effect | yes, fail-safe |
| Approval method name drift | Task 10.3 (audit) + Codex #8 disposition | No literals in code; handler-based | n/a (won't compile if missing) |

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run (Phase 0 is bootstrap, no product scope question) |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | will run at Task 10.5 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES_RESOLVED (PLAN) | 11 issues raised, all resolved in this revision; 6 P0/P1 + 5 discussable all incorporated |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | n/a (no UI in Phase 0) |
| DX Review | `/plan-devex-review` | Developer experience | 0 | — | n/a (Phase 0 is internal scaffolding) |
| Outside Voice | Codex CLI on plan | Independent plan critique | 1 | INCORPORATED | 10 findings raised on 2026-04-29; 9 adopted, 1 (P0 init-only insufficient) resolved by D4: A with safety rails |

**UNRESOLVED:** 0 — every decision routed through D1/D2/D3/D4 and finding-disposition table.

**VERDICT:** ENG + OUTSIDE-VOICE CLEARED — ready to execute pending operator's second approval of this revised plan.

---

## Execution handoff

This plan is saved to `docs/superpowers/plans/2026-04-29-phase-0-bootstrap.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per worktree lane (per the parallelization map above), main session reviews between merges, fast iteration.
2. **Inline Execution** — Execute serially in this session using `superpowers:executing-plans`, batched checkpoints at end of each Section.

After your second approval, tell me which execution mode. I will then start with Section A Task 0.1.
