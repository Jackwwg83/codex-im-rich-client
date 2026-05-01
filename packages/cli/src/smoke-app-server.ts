/**
 * smoke:app-server — initialize-only smoke against real `codex app-server`.
 *
 * Gated by CODEX_SMOKE=1 to prevent accidental subprocess spawning during
 * default `pnpm test`. Plan v2 Section J Task 9.2.
 *
 * Verifies:
 *   - codex on PATH and spawns successfully
 *   - JSONL transport round-trips
 *   - initialize handshake completes (returns InitializeResponse)
 *   - clean shutdown (no zombie process)
 *
 * Does NOT trigger any model call, thread, or turn — that's smoke:real-turn.
 *
 * Hard rails:
 *   - sandbox=read-only via configOverrides
 *   - approval_policy=on-request via configOverrides
 *   - client default-rejects all server-initiated requests (no handler set)
 */

import {
  AppServerClient,
  StdioTransport,
  performInitializeHandshake,
} from "@codex-im/app-server-client";
import pino from "pino";

export async function run(): Promise<void> {
  if (!process.env.CODEX_SMOKE) {
    console.error(
      [
        "Codex smoke (initialize-only) is disabled.",
        "Run with: CODEX_SMOKE=1 pnpm smoke:app-server",
      ].join("\n"),
    );
    process.exit(1);
  }

  const log = pino({ name: "smoke:app-server", level: "info" });

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
  // Explicit default-reject for server-initiated requests. initialize
  // shouldn't trigger any, but rule #5 says be conservative.
  client.setServerRequestHandler(null);

  try {
    await client.start();
    log.info("transport started");

    const result = await performInitializeHandshake(client, {
      name: "codex-im-bridge-smoke",
      title: null,
      version: "0.1.0-phase1",
    });

    log.info(
      {
        userAgent: result.userAgent,
        codexHome: result.codexHome,
        platformFamily: result.platformFamily,
        platformOs: result.platformOs,
      },
      "initialize OK",
    );
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "smoke failed");
    await client.stop();
    process.exit(1);
  }

  await client.stop();
  log.info("smoke:app-server PASSED");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
