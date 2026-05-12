#!/usr/bin/env node
// Contract check: pin the App Server semantics this bridge relies on.
//
// This reads only the local generated JSON schemas under
// packages/codex-protocol/schema. Upstream openai/codex is evidence for
// planning, but the generated local protocol is the implementation source of
// truth.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_CLIENT_METHODS = [
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/name/set",
  "thread/archive",
  "thread/unarchive",
];

const REQUIRED_SERVER_NOTIFICATIONS = ["remoteControl/status/changed"];

const FUTURE_METHOD_NOTES = [
  "plugin/share/save",
  "plugin/share/list",
  "plugin/share/updateTargets",
  "plugin/share/delete",
  "plugin/skill/read",
  "windowsSandbox/readiness",
];

function readJson(repoRoot, relPath) {
  return JSON.parse(readFileSync(join(repoRoot, relPath), "utf8"));
}

function schemaMethods(schema) {
  return new Set(
    (schema.oneOf ?? [])
      .map((entry) => entry.properties?.method?.const ?? entry.properties?.method?.enum?.[0])
      .filter((method) => typeof method === "string"),
  );
}

function schemaFields(schema) {
  return new Set(Object.keys(schema.properties ?? {}));
}

function requireMethods({ label, methods, required, failures }) {
  for (const method of required) {
    if (!methods.has(method)) {
      failures.push(`${label} is missing required method: ${method}`);
    }
  }
}

function requireField({ label, fields, field, failures }) {
  if (!fields.has(field)) {
    failures.push(`${label} is missing required field: ${field}`);
  }
}

function forbidPermissions({ label, fields, failures }) {
  if (fields.has("permissions")) {
    failures.push("permissions now present; review writableRoots enforcement plan before release.");
    failures.push(`${label} exposes top-level permissions`);
  }
}

export function checkAppServerSemantics({
  repoRoot = REPO_ROOT,
  log = console.log,
  error = console.error,
} = {}) {
  const failures = [];
  const clientMethods = schemaMethods(
    readJson(repoRoot, "packages/codex-protocol/schema/ClientRequest.json"),
  );
  const serverNotifications = schemaMethods(
    readJson(repoRoot, "packages/codex-protocol/schema/ServerNotification.json"),
  );
  const threadStartFields = schemaFields(
    readJson(repoRoot, "packages/codex-protocol/schema/v2/ThreadStartParams.json"),
  );
  const threadResumeFields = schemaFields(
    readJson(repoRoot, "packages/codex-protocol/schema/v2/ThreadResumeParams.json"),
  );
  const threadForkFields = schemaFields(
    readJson(repoRoot, "packages/codex-protocol/schema/v2/ThreadForkParams.json"),
  );

  requireMethods({
    label: "ClientRequest",
    methods: clientMethods,
    required: REQUIRED_CLIENT_METHODS,
    failures,
  });
  requireMethods({
    label: "ServerNotification",
    methods: serverNotifications,
    required: REQUIRED_SERVER_NOTIFICATIONS,
    failures,
  });

  requireField({
    label: "ThreadResumeParams",
    fields: threadResumeFields,
    field: "excludeTurns",
    failures,
  });
  requireField({
    label: "ThreadForkParams",
    fields: threadForkFields,
    field: "excludeTurns",
    failures,
  });

  forbidPermissions({ label: "ThreadStartParams", fields: threadStartFields, failures });
  forbidPermissions({ label: "ThreadResumeParams", fields: threadResumeFields, failures });
  forbidPermissions({ label: "ThreadForkParams", fields: threadForkFields, failures });

  if (clientMethods.has("thread/turns/list")) {
    log(
      "check-app-server-semantics: warning: thread/turns/list present in current pin; audit before Codex pin bump.",
    );
  }
  for (const method of FUTURE_METHOD_NOTES) {
    if (clientMethods.has(method)) {
      log(`check-app-server-semantics: note: ${method} is now present; review before using it.`);
    }
  }

  if (failures.length > 0) {
    error("check-app-server-semantics: FAIL");
    for (const failure of failures) error(`  ${failure}`);
    return 1;
  }

  log(
    "check-app-server-semantics: OK (local generated App Server semantics match guarded assumptions)",
  );
  return 0;
}

export function main() {
  return checkAppServerSemantics();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
