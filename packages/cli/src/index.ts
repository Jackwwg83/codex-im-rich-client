#!/usr/bin/env tsx
/**
 * codex-im CLI dispatcher.
 *
 * Phase 0 surface:
 *   codex-im smoke app-server   — initialize-only smoke (CODEX_SMOKE=1)
 *   codex-im smoke real-turn    — full lifecycle smoke (CODEX_REAL_SMOKE=1)
 *
 * Phase 1 surface:
 *   codex-im runtime send       — runtime stack smoke (CodexRuntime +
 *                                 EventNormalizer + ApprovalBroker)
 *                                 (CODEX_REAL_SMOKE=1)
 *
 * Phase 1+ will add admin commands (config validate, db migrate, etc.).
 */

const argv = process.argv.slice(2);
const cmd = argv[0];
const sub = argv[1];

function usage(): void {
  console.error(
    [
      "usage: codex-im <command> [...]",
      "",
      "commands:",
      "  smoke app-server     — initialize-only smoke (requires CODEX_SMOKE=1)",
      "  smoke telegram-fake  — CI-safe fake Telegram daemon smoke",
      "  smoke telegram-live  — live Telegram adapter smoke (requires TELEGRAM_LIVE=1)",
      "  smoke telegram-real  — live Telegram + real Codex smoke (requires both gates)",
      "  smoke real-turn      — full lifecycle smoke (requires CODEX_REAL_SMOKE=1)",
      "  runtime send         — runtime kernel smoke (requires CODEX_REAL_SMOKE=1)",
      "  daemon run           — foreground production daemon (Telegram adapter)",
      "  daemon status        — local daemon status snapshot",
      "  db backup            — local SQLite state backup",
      "",
      "see packages/cli/README.md for safety boundaries.",
    ].join("\n"),
  );
}

if (cmd === "smoke" && sub === "app-server") {
  const { run } = await import("./smoke-app-server.js");
  await run();
} else if (cmd === "smoke" && sub === "telegram-fake") {
  const { run } = await import("./smoke-telegram-fake.js");
  await run();
} else if (cmd === "smoke" && sub === "telegram-live") {
  const { run } = await import("./smoke-telegram-live.js");
  await run();
} else if (cmd === "smoke" && sub === "telegram-real") {
  const { run } = await import("./smoke-telegram-real.js");
  await run();
} else if (cmd === "smoke" && sub === "real-turn") {
  const { run } = await import("./smoke-real-turn.js");
  // argv = process.argv.slice(2) so argv[0]="smoke", argv[1]="real-turn",
  // argv[2..] = flag passthrough. Drop a stray "--" that pnpm/npm sometimes
  // forwards when invoked as `pnpm smoke:real-turn -- --capture ...`.
  const passthrough = argv.slice(2).filter((a) => a !== "--");
  await run(passthrough);
} else if (cmd === "runtime" && sub === "send") {
  const { run } = await import("./runtime-send.js");
  // Same passthrough convention: argv[0]="runtime", argv[1]="send",
  // argv[2..] = flag passthrough; strip a stray "--" forwarded by
  // pnpm/npm.
  const passthrough = argv.slice(2).filter((a) => a !== "--");
  await run(passthrough);
} else if (cmd === "daemon" && sub === "run") {
  const { run } = await import("./daemon-run.js");
  const passthrough = argv.slice(2).filter((a) => a !== "--");
  await run(passthrough);
} else if (cmd === "daemon" && sub === "status") {
  const { run } = await import("./daemon-status.js");
  const passthrough = argv.slice(2).filter((a) => a !== "--");
  await run(passthrough);
} else if (cmd === "db" && sub === "backup") {
  const { run } = await import("./db-backup.js");
  const passthrough = argv.slice(2).filter((a) => a !== "--");
  await run(passthrough);
} else {
  usage();
  process.exit(1);
}

export {};
