/**
 * `codex-im runtime send` — end-to-end smoke for the Phase 1 runtime stack.
 *
 * Plan section: docs/superpowers/plans/2026-04-30-phase-1-runtime.md §1934.
 *
 * Exercises the full runtime kernel (CodexRuntime + EventNormalizer +
 * ApprovalBroker) against real codex via JSONL stdio, mirroring the
 * `smoke:real-turn` safety rails (sandbox=read-only, approval_policy=
 * on-request, default-reject every server request through the broker).
 * Phase 1 dev tooling: lets an operator drive one turn end-to-end and
 * see the normalized event stream as JSONL, useful for ad-hoc validation
 * of EventNormalizer against real codex 0.125 wire shapes.
 *
 * Two layers:
 *
 *   runRuntimeSendCore(opts)
 *     The testable inner. Takes a Transport so unit tests can inject a
 *     FakeAppServer-backed InMemoryTransport instead of spawning real
 *     codex. Tests live in `packages/cli/test/runtime-send.test.ts`.
 *
 *   run(argv)
 *     The CLI outer. Parses --prompt / --prompt-file / --cwd, env-gates
 *     on CODEX_REAL_SMOKE (same as smoke:real-turn — this is real-codex
 *     dev tooling and triggers a model call), spawns codex via
 *     StdioTransport with the safety-rail config, delegates to
 *     runRuntimeSendCore.
 *
 * Safety rails (matching plan §1964):
 *   - sandbox=read-only             (no shell side effects)
 *   - approval_policy=on-request    (every approval funnels through us)
 *   - ApprovalBroker default-deny   (T9b: handler=null per method →
 *                                    per-method default-reject response;
 *                                    auth-refresh defaults to throw -32601
 *                                    because Phase 1 cannot fabricate
 *                                    tokens)
 *
 * The broker handles the approval default-deny; we never call
 * `setServerRequestHandler` directly here. Method-name string literals
 * are confined to packages/core/src/approval-broker.ts (D7 boundary);
 * even mentioning them in comments inside packages/cli/src/ trips T9b's
 * grep guard, so this header sticks to category names.
 *
 * Logging:
 *   - The `output` callback is the EVENT JSONL sink (defaults to
 *     process.stdout — one CodexRichEvent per line, machine-parseable).
 *   - The `logger` is a pino Logger that goes to STDERR by default
 *     when constructed via the CLI entry — keeps stdout event-only.
 *     Tests pass a silent logger so test output stays clean.
 */

import { readFileSync } from "node:fs";
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
const DEFAULT_PROMPT_PATH = join(here, "prompts", "harmless-turn.txt");

const TURN_TIMEOUT_MS = 60_000;

// ─── Pure argv parsing ────────────────────────────────────────────────────

export interface RuntimeSendFlags {
  prompt?: string;
  promptFile?: string;
  subprocessCwd?: string;
}

/**
 * Pure parser for `runtime send` flags. No I/O, no env access.
 *
 * Supported flags:
 *   --prompt <text>        Inline prompt string. If omitted (and
 *                          --prompt-file is also omitted), the default
 *                          harmless-turn.txt is used.
 *   --prompt-file <path>   Read prompt from file (path is repo-relative
 *                          when run via pnpm).
 *   --cwd <path>           Working directory of the spawned codex
 *                          subprocess. Does NOT change the harness's
 *                          own cwd. Mirrors smoke:real-turn's --cwd.
 *
 * Throws on:
 *   - unknown flag
 *   - missing value after a known flag
 *   - both --prompt and --prompt-file passed (operator-must-pick)
 */
export function parseRuntimeSendArgs(argv: readonly string[]): RuntimeSendFlags {
  const flags: RuntimeSendFlags = {};
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    const next = argv[i + 1];
    const isFlag = (s: string | undefined): boolean => s?.startsWith("--") ?? false;
    const need = (label: string): string => {
      if (next === undefined || isFlag(next)) {
        throw new Error(`runtime-send: ${label} requires a value`);
      }
      return next;
    };
    if (a === "--prompt") {
      flags.prompt = need("--prompt");
      i += 2;
      continue;
    }
    if (a === "--prompt-file") {
      flags.promptFile = need("--prompt-file");
      i += 2;
      continue;
    }
    if (a === "--cwd") {
      flags.subprocessCwd = need("--cwd");
      i += 2;
      continue;
    }
    throw new Error(`runtime-send: unknown flag '${a}'`);
  }
  if (flags.prompt !== undefined && flags.promptFile !== undefined) {
    throw new Error("runtime-send: --prompt and --prompt-file are mutually exclusive");
  }
  return flags;
}

// ─── Core (testable, no subprocess spawn) ────────────────────────────

export interface RunRuntimeSendCoreOptions {
  /** A transport to drive the AppServerClient. Production = StdioTransport;
   *  tests = FakeAppServer.clientSide. */
  transport: Transport;
  /** Prompt text. The CLI outer loads it from --prompt or --prompt-file. */
  prompt: string;
  /** Optional pino logger; defaults to a silent one. */
  logger?: Logger;
  /** Optional turn timeout (default 60s). Tests override to a short value. */
  turnTimeoutMs?: number;
  /** ClientInfo.name forwarded to performInitializeHandshake. */
  clientName?: string;
  /** ClientInfo.version forwarded to performInitializeHandshake. */
  clientVersion?: string;
  /** Override the line-output sink. Defaults to stdout JSONL. Tests use this
   *  to capture event lines without touching process.stdout. */
  output?: (line: string) => void;
}

/**
 * Core runtime-send flow. Constructs AppServerClient + ApprovalBroker +
 * CodexRuntime, completes the initialize handshake, opens one thread,
 * starts one turn, streams the EventNormalizer's events as JSONL, and
 * exits when the turn reaches a terminal lifecycle state
 * (turn_completed / turn_failed / turn_interrupted) or when the
 * turnTimeoutMs ceiling fires.
 *
 * Cleanup uses the capture-error-then-cleanup pattern (codex outside-voice
 * T4.5 review #5): we run client.stop() unconditionally and re-throw the
 * main error if it exists, else the cleanup error. Main error wins so
 * cleanup failures don't mask the actual cause.
 */
export async function runRuntimeSendCore(opts: RunRuntimeSendCoreOptions): Promise<void> {
  const log = opts.logger ?? pino({ level: "silent" });
  const turnTimeoutMs = opts.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  const clientName = opts.clientName ?? "codex-im-runtime-send";
  const clientVersion = opts.clientVersion ?? "0.1.0-phase1";
  const output = opts.output ?? ((line: string) => process.stdout.write(`${line}\n`));

  const client = new AppServerClient(opts.transport, { logger: log });

  // ApprovalBroker: single owner of client.setServerRequestHandler.
  // T9b's default-deny policy applies — every server-initiated request
  // gets the per-method default-reject response shape. No handlers
  // installed here in Phase 1 dev tooling; this is the operator-facing
  // smoke, not the IM-driven approval flow (Phase 2).
  const broker = new ApprovalBroker(client);
  broker.attach();

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

    const threadResp = await runtime.threadStart({
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });
    const threadId = threadResp.thread.id;
    log.info({ threadId }, "thread/start OK");

    await runtime.turnStart({
      threadId,
      input: [{ type: "text", text: opts.prompt, text_elements: [] }],
    });
    log.info("turn/start OK");

    // Stream events with a hard ceiling. The EventNormalizer's
    // AsyncIterable yields normalized CodexRichEvents until the
    // underlying client closes (endOfStream) — we additionally race
    // it against a turn-timeout so a hung turn doesn't block the CLI
    // forever. The for-await loop breaks on the first terminal turn
    // event (T7b-1 contract: turn_completed / turn_failed /
    // turn_interrupted carry terminal: true).
    const timeoutMs = turnTimeoutMs;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Closing the iterator triggers #cancelConsumer → drains the
      // queue → consumers see done=true.
      void iter.return?.();
    }, timeoutMs);
    const iter = runtime.events.events();
    try {
      for await (const ev of iter) {
        output(JSON.stringify(ev));
        if (
          ev.type === "turn_completed" ||
          ev.type === "turn_failed" ||
          ev.type === "turn_interrupted"
        ) {
          break;
        }
      }
      if (timedOut) {
        throw new Error(`runtime-send: turn did not complete within ${timeoutMs}ms`);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    mainErr = e;
  }

  // Cleanup: client.stop() unconditionally. Main error wins.
  let cleanupErr: unknown;
  try {
    await client.stop();
  } catch (e) {
    cleanupErr = e;
  }

  if (mainErr !== undefined) throw mainErr;
  if (cleanupErr !== undefined) throw cleanupErr;
}

// ─── CLI entry (env-gated, real subprocess spawn) ────────────────────

/**
 * CLI entry point. Reads `process.argv` past `runtime send`, env-gates on
 * `CODEX_REAL_SMOKE` (this is dev tooling that triggers a real model call,
 * same gate as smoke:real-turn), spawns real codex via StdioTransport,
 * and delegates to runRuntimeSendCore.
 *
 * Tests do NOT invoke this — they call runRuntimeSendCore directly with
 * a FakeAppServer-injected transport.
 */
export async function run(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (!process.env.CODEX_REAL_SMOKE) {
    console.error(
      [
        "runtime-send is gated on CODEX_REAL_SMOKE=1 (same as smoke:real-turn).",
        "This command spawns real codex and triggers a model call (~$0.01).",
        "Run with CODEX_REAL_SMOKE=1 after confirming local login + quota.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const flags = parseRuntimeSendArgs(argv);
  // Route logs to STDERR (codex T10 review P1-2): the runtime-send
  // contract is "stdout = event JSONL only". Default pino destination
  // is stdout, which would mix log records with CodexRichEvent JSONL
  // and break downstream parsers. pino.destination(2) routes to stderr.
  const log = pino(
    { name: "runtime:send", level: "info" },
    pino.destination({ fd: 2, sync: true }),
  );

  let prompt: string;
  if (flags.prompt !== undefined) {
    prompt = flags.prompt;
  } else if (flags.promptFile !== undefined) {
    prompt = readFileSync(flags.promptFile, "utf8");
  } else {
    prompt = readFileSync(DEFAULT_PROMPT_PATH, "utf8");
  }

  const transport = new StdioTransport({
    command: "codex",
    args: ["app-server", "--listen", "stdio://"],
    ...(flags.subprocessCwd !== undefined ? { cwd: flags.subprocessCwd } : {}),
    configOverrides: {
      sandbox: "read-only",
      approval_policy: "on-request",
    },
    logger: log,
  });

  try {
    await runRuntimeSendCore({
      transport,
      logger: log,
      prompt,
    });
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "runtime-send failed");
    process.exit(1);
  }

  log.info("runtime-send PASSED");
}

// Direct-run support: `tsx packages/cli/src/runtime-send.ts ...` works.
if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
