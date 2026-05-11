#!/usr/bin/env node
// Contract check: every annotated git tag vX.Y.Z must be paired with a
// commit whose package.json:version equals X.Y.Z exactly. See ADR 0005.
//
// On non-tag pushes the check is a no-op (it has nothing to compare
// against). On tag pushes (GITHUB_REF starts with `refs/tags/`, or the
// `--tag <name>` CLI flag is supplied) the version field must match.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  let tag;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--tag") {
      tag = argv[i + 1];
      i += 1;
    }
  }
  return { tag };
}

export function resolveExpectedTag({ argv = [], env = process.env } = {}) {
  const { tag } = parseArgs(argv);
  if (tag !== undefined) return tag;
  const ref = env.GITHUB_REF;
  if (typeof ref === "string" && ref.startsWith("refs/tags/")) {
    return ref.slice("refs/tags/".length);
  }
  return undefined;
}

export function checkVersionTagSync({
  tag,
  packageVersion,
}) {
  const expected = tag.startsWith("v") ? tag.slice(1) : tag;
  if (packageVersion === expected) {
    return { ok: true, expected, actual: packageVersion, tag };
  }
  return { ok: false, expected, actual: packageVersion, tag };
}

export function main({ argv = process.argv.slice(2), env = process.env, repoRoot = REPO_ROOT } = {}) {
  const tag = resolveExpectedTag({ argv, env });
  if (tag === undefined) {
    console.log(
      "check-version-tag-sync: not a tag push (GITHUB_REF=" +
        (env.GITHUB_REF ?? "<unset>") +
        "); skipping",
    );
    return 0;
  }
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const result = checkVersionTagSync({ tag, packageVersion: pkg.version });
  if (result.ok) {
    console.log(
      "check-version-tag-sync: OK (tag " +
        result.tag +
        " matches package.json:version " +
        result.actual +
        ")",
    );
    return 0;
  }
  console.error("check-version-tag-sync: FAIL");
  console.error("  tag:                  " + result.tag);
  console.error("  expected version:     " + result.expected);
  console.error("  package.json version: " + result.actual);
  console.error("  ADR 0005 requires these to match before tagging.");
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
