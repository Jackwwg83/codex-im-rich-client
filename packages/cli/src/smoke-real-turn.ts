/**
 * smoke:real-turn — end-to-end lifecycle smoke against real `codex app-server`.
 *
 * Gated by CODEX_REAL_SMOKE=1. Plan v2 Decision Log D4 (Phase 0 origin);
 * refactored 2026-05-01 (Phase 1 tag-gate fix Blocker 1) to route through
 * the Phase 1 stack — `ApprovalBroker` for server-request dispatch and
 * `CodexRuntime` typed wrappers for ClientRequests — instead of raw
 * raw `client.request(method, params)` / `client.setServerRequestHandler` calls.
 *
 * Validates the FULL Phase 0 + Phase 1 stack against real codex:
 *   1. codex app-server can spawn
 *   2. initialize handshake succeeds (JSONL + JSON-RPC lite)
 *   3. ApprovalBroker.attach() — Phase 1 broker is the sole owner of
 *      client.setServerRequestHandler (D7); per-method default-deny
 *      means server-initiated approvals get shape-correct denial
 *      responses (e.g. {decision:"decline"}) instead of -32603 errors
 *   4. CodexRuntime.threadStart succeeds
 *   5. CodexRuntime.turnStart succeeds with a harmless prompt
 *   6. turn/completed (or terminal) notification arrives
 *   7. NO command/file/Computer-Use approvals were ever accepted (broker
 *      default-deny is enforced by construction; the model only sees
 *      denial responses, never grants)
 *   8. Transport closes cleanly, no zombie process
 *
 * Phase 1 T2 added three optional CLI flags (driven by Codex outside-voice
 * blockers B1+B2 — the fixture spike T4 needs all three):
 *   --capture <path>       Write each inbound message to <path> as JSONL.
 *                          No-op when absent. Used by T4 to capture wire
 *                          fixtures; the file is later split + redacted via
 *                          scripts/split-capture.mts + scripts/redact-fixture.mjs.
 *   --prompt-file <path>   Read the turn prompt from <path> instead of the
 *                          default `prompts/harmless-turn.txt`. Used by T4
 *                          to drive a richer prompt that triggers shell exec
 *                          + file edit + ≥1 server-initiated approval.
 *   --cwd <path>           Set the working directory of the spawned codex
 *                          subprocess. Does NOT change the harness's own
 *                          cwd. Used by T4 to point codex at a sandboxed
 *                          scratch dir while the harness keeps running
 *                          from the repo root (so `pnpm --filter` and
 *                          repo-relative paths still resolve).
 *
 * Safety rails (per user rule #5 + plan D4):
 *   - sandbox_mode=read-only      (no shell side effects)
 *   - approval_policy=on-request  (everything funnels through approvals)
 *   - ApprovalBroker default-deny (T9b: per-method default-reject for
 *     all 9 generated ServerRequest methods; auth-refresh throws
 *     JsonRpcResponseError(-32601))
 *   - default harmless prompt forbids tools (overridable via --prompt-file
 *     for T4, where the operator has explicitly accepted that the richer
 *     prompt MAY trigger an approval — still broker-denied)
 *   - no auto-approve anywhere
 *
 * If you've never run this before, ensure:
 *   - `codex login` has been completed
 *   - your account has model quota
 *   - you understand the cost of one minimal-prompt turn (~$0.01 typical)
 */

import { createWriteStream, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppServerClient,
  StdioTransport,
  type Transport,
  performInitializeHandshake,
} from "@codex-im/app-server-client";
import { CodexRuntime } from "@codex-im/codex-runtime";
import { ApprovalBroker } from "@codex-im/core";
import pino, { type Logger } from "pino";

const here = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(here, "prompts", "harmless-turn.txt");

const TURN_TIMEOUT_MS = 60_000;

// ─── Pure argv parsing ────────────────────────────────────────────────────

export interface SmokeRealTurnFlags {
  capturePath?: string;
  promptFile?: string;
  subprocessCwd?: string;
}

/**
 * Pure parser for `smoke:real-turn` flags. No I/O, no env access. Runs in
 * the default `pnpm test` unit gate via test/cli-flags.test.ts.
 *
 * Supported flags:
 *   --capture <path>       capturePath
 *   --prompt-file <path>   promptFile
 *   --cwd <path>           subprocessCwd  (subprocess only, NOT harness)
 *
 * Throws on:
 *   - unknown flag (e.g. `--bogus`)
 *   - missing value after a known flag (including the next-token-is-flag
 *     case, which catches typos like `--capture --cwd /tmp/x` instead of
 *     silently treating `--cwd` as the capture path).
 */
export function parseSmokeRealTurnArgs(argv: readonly string[]): SmokeRealTurnFlags {
  const out: SmokeRealTurnFlags = {};

  const requireValue = (flag: string, raw: string | undefined): string => {
    if (raw === undefined || raw.startsWith("--")) {
      throw new Error(`${flag}: missing value`);
    }
    return raw;
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--capture") {
      out.capturePath = requireValue("--capture", argv[++i]);
      continue;
    }
    if (flag === "--prompt-file") {
      out.promptFile = requireValue("--prompt-file", argv[++i]);
      continue;
    }
    if (flag === "--cwd") {
      out.subprocessCwd = requireValue("--cwd", argv[++i]);
      continue;
    }
    throw new Error(`unknown flag: ${flag}`);
  }

  return out;
}

// ─── Capture wiring (testable in isolation) ──────────────────────────────

/**
 * Tap inbound transport messages and append each as one JSONL line to
 * `path`. Returns an unsubscribe / close function the caller MUST call
 * before the test exits, so the file stream flushes deterministically.
 *
 * Multiple subscribers on a single Transport are supported (StdioTransport
 * uses a Set; InMemoryTransport uses EventEmitter), so this runs in
 * parallel with AppServerClient's own `transport.onMessage` subscription.
 *
 * Codex outside-voice T4.5 review #6: a stream `error` event (e.g.
 * ENOENT/EACCES on `--capture <bad-path>`) without an explicit listener
 * surfaces as an UnhandledError that crashes the harness. We capture
 * the first error and surface it from the close callback so the smoke
 * fails cleanly with a useful message instead of an uncaught throw.
 */
export function attachCapture(transport: Transport, path: string): () => Promise<void> {
  const stream = createWriteStream(path, { flags: "w" });
  let firstStreamError: Error | undefined;
  stream.on("error", (err: Error) => {
    if (!firstStreamError) firstStreamError = err;
  });
  const unsub = transport.onMessage((msg) => {
    stream.write(`${JSON.stringify(msg)}\n`);
  });
  return () =>
    new Promise<void>((resolve, reject) => {
      unsub();
      stream.end((err: Error | null | undefined) => {
        if (firstStreamError) reject(firstStreamError);
        else if (err) reject(err);
        else resolve();
      });
    });
}

// ─── Core flow (transport injectable; testable with FakeAppServer) ───────

export interface RunCoreOptions {
  /**
   * Already-constructed Transport. Tests pass an in-memory side; the CLI
   * passes a real `StdioTransport`. The core never spawns by itself.
   */
  transport: Transport;
  /** Logger; tests pass `pino({ level: "silent" })`. */
  logger: Logger;
  /** Prompt text for `turn/start`. Already-resolved (no file I/O here). */
  prompt: string;
  /** Optional capture sink — see attachCapture(). */
  capturePath?: string;
  /** Override turn timeout for tests. */
  turnTimeoutMs?: number;
  /** ClientInfo override for handshake. Tests stay deterministic this way. */
  clientName?: string;
  clientVersion?: string;
}

/**
 * Drive the smoke lifecycle against an already-constructed Transport.
 * Used by the CLI entrypoint AND by smoke-real-turn-capture.test.ts (with
 * a FakeAppServer-backed InMemoryTransport).
 */
export async function runSmokeRealTurnCore(opts: RunCoreOptions): Promise<void> {
  const log = opts.logger;
  const turnTimeoutMs = opts.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  const clientName = opts.clientName ?? "codex-im-bridge-real-smoke";
  const clientVersion = opts.clientVersion ?? "0.1.0-phase1";

  const closeCapture = opts.capturePath
    ? attachCapture(opts.transport, opts.capturePath)
    : undefined;

  const client = new AppServerClient(opts.transport, { logger: log });

  // Phase 1 tag-gate fix (2026-05-01): smoke now goes through the
  // Phase 1 stack — `ApprovalBroker` for server-request dispatch,
  // `CodexRuntime` typed wrappers for ClientRequests. The pre-T8
  // smoke called `setServerRequestHandler` directly with a throwing
  // handler (-32603 default-reject) and used raw `request(method,
  // params)` calls with hardcoded method literals; both bypassed the
  // Phase 1 boundaries. CLAUDE.md "Method literal policy" formalizes
  // this boundary: ClientRequest literals only in CodexRuntime's
  // REQUEST_METHODS table, ServerRequest literals only in
  // ApprovalBroker's DispatchTable.
  //
  // ApprovalBroker.attach() registers the broker as the sole owner of
  // client.setServerRequestHandler (D7). The broker's per-method
  // default-reject policy (Phase 1, never auto-approve) replaces the
  // prior "throw on every server request" path. Default-rejects are
  // shape-correct responses (e.g. {decision:"decline"} for fileChange)
  // rather than -32603 handler errors, so codex's turn handler can
  // continue cleanly after a denial.
  const broker = new ApprovalBroker(client);
  broker.attach();

  // Codex outside-voice T4.5 review #5: capture-the-error-then-cleanup
  // pattern. We do NOT throw from inside `finally` (biome noUnsafeFinally
  // would also flag that). Instead, run both cleanups unconditionally
  // and, after they finish, re-throw mainErr if the main work failed,
  // else surface the first cleanup error if any. Main-work error always
  // wins so cleanup failures don't mask the actual cause.
  let mainErr: unknown;
  try {
    await client.start();
    log.info("transport started");

    const init = await performInitializeHandshake(client, {
      name: clientName,
      title: null,
      version: clientVersion,
    });
    log.info({ codexHome: init.codexHome }, "initialize OK");

    const runtime = new CodexRuntime(client);

    // codex 0.128 removed experimentalRawEvents + persistExtendedHistory
    // from ThreadStartParams; both were already the default.
    const threadResp = await runtime.threadStart({});
    const threadId = threadResp.thread.id;
    log.info({ threadId }, "thread/start OK");

    const turnTerminal = waitForTurnCompleted(client, threadId, turnTimeoutMs, log);

    log.info("turn/start");
    await runtime.turnStart({
      threadId,
      input: [{ type: "text", text: opts.prompt, text_elements: [] }],
    });

    await turnTerminal;
    log.info("turn reached terminal state");
  } catch (e) {
    mainErr = e;
  }

  // Both cleanups run unconditionally; first cleanup error captured.
  let cleanupErr: unknown;
  try {
    await client.stop();
  } catch (e) {
    cleanupErr = e;
  }
  if (closeCapture) {
    try {
      await closeCapture();
    } catch (e) {
      if (cleanupErr === undefined) cleanupErr = e;
    }
  }

  if (mainErr !== undefined) throw mainErr;
  if (cleanupErr !== undefined) throw cleanupErr;

  // Pre-T8 the smoke tracked unhandledServerRequests via a counter on
  // the throwing setServerRequestHandler. With ApprovalBroker default-
  // deny, server-initiated approvals get shape-correct denial responses
  // (e.g. {decision:"decline"}); they're not "unhandled". The smoke's
  // pass criterion remains "turn reaches terminal state without any
  // approval being granted" — the broker enforces that by construction.
}

// ─── CLI entry point (env-gated, real subprocess) ───────────────────────

/**
 * CLI entry. Reads `process.argv` past `smoke real-turn`, env-gates on
 * `CODEX_REAL_SMOKE`, spawns a real `codex app-server`, and delegates to
 * runSmokeRealTurnCore.
 *
 * `argv` parameter (optional) lets a test exercise the env-gate +
 * arg-routing without spawning codex. Callers MUST pass argv explicitly;
 * the dispatcher in src/index.ts does this. The default-arg fallback
 * uses `process.argv.slice(2)` so direct `tsx packages/cli/src/smoke-real-turn.ts
 * --capture x` invocation works (script-as-program path) — codex
 * outside-voice T4.5 review #7 caught the original slice(3) default
 * which mis-routed `--capture x` to `["x"]` in the direct-run case.
 */
export async function run(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (!process.env.CODEX_REAL_SMOKE) {
    console.error(
      [
        "Real Codex smoke is disabled.",
        "Run with CODEX_REAL_SMOKE=1 after confirming local login, quota,",
        "and safe sandbox config. This smoke triggers a real model call.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const flags = parseSmokeRealTurnArgs(argv);
  const log = pino({ name: "smoke:real-turn", level: "info" });

  const promptPath = flags.promptFile ?? PROMPT_PATH;
  const prompt = readFileSync(promptPath, "utf8");

  const transport = new StdioTransport({
    command: "codex",
    args: ["app-server", "--listen", "stdio://"],
    ...(flags.subprocessCwd !== undefined ? { cwd: flags.subprocessCwd } : {}),
    configOverrides: {
      sandbox_mode: "read-only",
      approval_policy: "on-request",
    },
    logger: log,
  });

  try {
    await runSmokeRealTurnCore({
      transport,
      logger: log,
      prompt,
      ...(flags.capturePath !== undefined ? { capturePath: flags.capturePath } : {}),
    });
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "smoke:real-turn failed");
    process.exit(1);
  }

  log.info("smoke:real-turn PASSED");
}

function waitForTurnCompleted(
  client: AppServerClient,
  threadId: string,
  timeoutMs: number,
  log: Logger,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ceiling = setTimeout(
      () => reject(new Error(`turn did not complete in ${timeoutMs}ms`)),
      timeoutMs,
    );
    const unsub = client.onNotification((n) => {
      if (n.method === "turn/completed") {
        const params = n.params as { threadId?: string } | undefined;
        if (!params || params.threadId === threadId) {
          clearTimeout(ceiling);
          unsub();
          resolve();
        }
      } else if (n.method === "error" || n.method === "warning") {
        log.warn({ method: n.method, params: n.params }, "notification");
      }
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
