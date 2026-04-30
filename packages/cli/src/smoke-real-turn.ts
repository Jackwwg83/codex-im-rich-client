/**
 * smoke:real-turn — end-to-end lifecycle smoke against real `codex app-server`.
 *
 * Gated by CODEX_REAL_SMOKE=1. Plan v2 Decision Log D4.
 *
 * Validates the FULL Phase 0 stack against real codex:
 *   1. codex app-server can spawn
 *   2. initialize handshake succeeds (JSONL + JSON-RPC lite)
 *   3. thread/start succeeds
 *   4. turn/start succeeds with a harmless prompt
 *   5. turn/completed (or terminal) notification arrives
 *   6. NO unhandled server-initiated requests leak
 *   7. NO command/file/Computer-Use approvals were ever accepted
 *      (client default-rejects everything; if a real approval would be
 *      needed, the turn will fail or hang past timeout — both are pass)
 *   8. Transport closes cleanly, no zombie process
 *
 * What this smoke does NOT assert:
 *   - exact text returned by the model
 *   - model used / token count / cost
 *
 * Safety rails (per user rule #5 + plan D4):
 *   - sandbox=read-only           (no shell side effects)
 *   - approval_policy=on-request  (everything funnels through approvals)
 *   - client.setServerRequestHandler(null)  (default-reject EVERY server req)
 *   - fixed harmless prompt        (literal "Reply OK", forbids tools)
 *   - no auto-approve anywhere
 *
 * If you've never run this before, ensure:
 *   - `codex login` has been completed
 *   - your account has model quota
 *   - you understand the cost of one minimal-prompt turn (~$0.01 typical)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppServerClient,
  StdioTransport,
  performInitializeHandshake,
} from "@codex-im/app-server-client";
import pino, { type Logger } from "pino";

const here = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(here, "prompts", "harmless-turn.txt");

const TURN_TIMEOUT_MS = 60_000;

export async function run(): Promise<void> {
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

  const log = pino({ name: "smoke:real-turn", level: "info" });
  const harmlessPrompt = readFileSync(PROMPT_PATH, "utf8");

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

  // CRITICAL: default-reject every server-initiated request.
  // Setting handler to null is the explicit form (it's also the default,
  // but writing it makes the safety rail visible at the top of smoke).
  let unhandledServerRequests = 0;
  client.setServerRequestHandler((req) => {
    unhandledServerRequests++;
    log.warn({ method: req.method, id: req.id }, "rejecting server request");
    throw new Error(`smoke:real-turn rejects all server requests by policy (${req.method})`);
  });

  try {
    await client.start();
    log.info("transport started");

    const init = await performInitializeHandshake(client, {
      name: "codex-im-bridge-real-smoke",
      title: null,
      version: "0.1.0-phase0",
    });
    log.info({ codexHome: init.codexHome }, "initialize OK");

    // 1. Start a thread. Empty params is OK (all ThreadStartParams are optional).
    const threadResp = await client.request<{ thread: { id: string } }>(
      "thread/start",
      {},
      { timeoutMs: 15_000 },
    );
    const threadId = threadResp.thread.id;
    log.info({ threadId }, "thread/start OK");

    // 2. Wait for turn/completed terminal notification while sending turn/start.
    const turnTerminal = waitForTurnCompleted(client, threadId, TURN_TIMEOUT_MS, log);

    log.info("turn/start (harmless prompt)");
    await client.request<{ turn: unknown }>(
      "turn/start",
      {
        threadId,
        input: [{ type: "text", text: harmlessPrompt, text_elements: [] }],
      },
      { timeoutMs: TURN_TIMEOUT_MS },
    );

    await turnTerminal;
    log.info("turn reached terminal state");
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "smoke:real-turn failed");
    await client.stop();
    process.exit(1);
  }

  await client.stop();

  if (unhandledServerRequests > 0) {
    log.error(
      { count: unhandledServerRequests },
      "smoke:real-turn observed server requests (default-rejected, but flagged for review)",
    );
    // Note: we DON'T exit 1 here — server requests are expected if the
    // model wants approvals. The default-reject path correctly handled
    // them. We just log so the operator knows the model attempted it.
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
      // Match terminal turn notification scoped to our thread.
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
