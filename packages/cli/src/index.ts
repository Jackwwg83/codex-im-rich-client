#!/usr/bin/env tsx
/**
 * codex-im CLI dispatcher.
 *
 * Phase 0 surface:
 *   codex-im smoke app-server   — initialize-only smoke (CODEX_SMOKE=1)
 *   codex-im smoke real-turn    — full lifecycle smoke (CODEX_REAL_SMOKE=1)
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
      "  smoke real-turn      — full lifecycle smoke (requires CODEX_REAL_SMOKE=1)",
      "",
      "see packages/cli/README.md for safety boundaries.",
    ].join("\n"),
  );
}

if (cmd === "smoke" && sub === "app-server") {
  const { run } = await import("./smoke-app-server.js");
  await run();
} else if (cmd === "smoke" && sub === "real-turn") {
  const { run } = await import("./smoke-real-turn.js");
  await run();
} else {
  usage();
  process.exit(1);
}

export {};
