#!/usr/bin/env node
// Contract check: every command in packages/core/src/command-router.ts's
// COMMAND_ROUTER_COMMANDS list must appear in both the daemon /help
// reply and docs/user/commands.md (with a small allowlist for aliases).
//
// This guards against alpha.3's regression where /rename, /archive, and
// /unarchive shipped in the router and daemon but were missing from
// both /help and the user docs, leaving users with no way to discover
// them.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Commands that legitimately appear in only one surface.
//   start    — /help advertises it; commands.md skips it (it's just the
//              IM-bot init alias for /help).
//   help     — the router recognises /help but the rendered output of
//              /help itself does not literally list "/help".
//   cwds     — documented in commands.md as a technical alias for
//              /projects; intentionally NOT listed in /help to keep the
//              user-facing list short.
const ALLOWED_HELP_ONLY = new Set(["start"]);
const ALLOWED_DOCS_ONLY = new Set(["cwds"]);
const ROUTER_SELF = new Set(["help"]);
// Commands handled outside command-router (separate dispatchers) that
// still legitimately appear in /help and commands.md.
const NOT_IN_ROUTER = new Set(["cu"]);

export function extractHelpCommands(daemonSrc) {
  const startMarker = '"Commands:",';
  const endMarker = '].join("\\n")';
  const startIdx = daemonSrc.indexOf(startMarker);
  if (startIdx < 0) {
    throw new Error(
      "check-help-docs-alignment: could not locate '\"Commands:\"' marker in daemon.ts",
    );
  }
  const endIdx = daemonSrc.indexOf(endMarker, startIdx);
  if (endIdx < 0) {
    throw new Error(
      "check-help-docs-alignment: could not locate '].join(\"\\n\")' end marker in daemon.ts after /help body",
    );
  }
  const body = daemonSrc.slice(startIdx, endIdx);
  const cmds = new Set();
  for (const m of body.matchAll(/"\/([a-z]+)\b/g)) cmds.add(m[1]);
  return cmds;
}

export function extractDocsCommands(commandsMd) {
  const cmds = new Set();
  for (const line of commandsMd.split("\n")) {
    const m = line.match(/^\|\s*`\/([a-z]+)\b/);
    if (m) cmds.add(m[1]);
  }
  return cmds;
}

export function extractRouterCommands(routerSrc) {
  const m = routerSrc.match(/COMMAND_ROUTER_COMMANDS\s*=\s*Object\.freeze\(\[([^\]]+)\]/);
  if (!m) {
    throw new Error(
      "check-help-docs-alignment: could not locate COMMAND_ROUTER_COMMANDS in command-router.ts",
    );
  }
  return new Set([...m[1].matchAll(/"([a-z]+)"/g)].map((mm) => mm[1]));
}

export function diff({ router, help, docs }) {
  const errors = [];
  for (const cmd of router) {
    if (ROUTER_SELF.has(cmd)) continue;
    if (!help.has(cmd) && !ALLOWED_DOCS_ONLY.has(cmd)) {
      errors.push(`router command "/${cmd}" not in /help output`);
    }
    if (!docs.has(cmd) && !ALLOWED_HELP_ONLY.has(cmd)) {
      errors.push(`router command "/${cmd}" not in docs/user/commands.md`);
    }
  }
  for (const cmd of help) {
    if (!router.has(cmd) && !NOT_IN_ROUTER.has(cmd) && !ROUTER_SELF.has(cmd)) {
      errors.push(`/help advertises "/${cmd}" but command-router does not recognise it`);
    }
  }
  for (const cmd of docs) {
    if (!router.has(cmd) && !NOT_IN_ROUTER.has(cmd) && !ROUTER_SELF.has(cmd)) {
      errors.push(`commands.md advertises "/${cmd}" but command-router does not recognise it`);
    }
  }
  return errors;
}

export function main({ repoRoot = REPO_ROOT } = {}) {
  const daemonSrc = readFileSync(join(repoRoot, "packages/daemon/src/daemon.ts"), "utf8");
  const commandsMd = readFileSync(join(repoRoot, "docs/user/commands.md"), "utf8");
  const routerSrc = readFileSync(join(repoRoot, "packages/core/src/command-router.ts"), "utf8");

  const help = extractHelpCommands(daemonSrc);
  const docs = extractDocsCommands(commandsMd);
  const router = extractRouterCommands(routerSrc);
  const errors = diff({ router, help, docs });

  if (errors.length === 0) {
    console.log(
      `check-help-docs-alignment: OK (${router.size} router commands, ${help.size} in /help, ${docs.size} in commands.md)`,
    );
    return 0;
  }
  console.error("check-help-docs-alignment: FAIL");
  for (const e of errors) console.error(`  ${e}`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
