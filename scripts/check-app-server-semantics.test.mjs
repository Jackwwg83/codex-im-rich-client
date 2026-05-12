import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkAppServerSemantics } from "./check-app-server-semantics.mjs";

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2));
}

function request(method) {
  return { properties: { method: { const: method } } };
}

function notification(method) {
  return { properties: { method: { const: method } } };
}

function threadParams(fields) {
  return {
    title: "ThreadParams",
    type: "object",
    properties: Object.fromEntries(fields.map((field) => [field, { type: "string" }])),
  };
}

function fixtureRepo({ includePermissions = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "codex-im-semantics-"));
  const schemaRoot = join(root, "packages/codex-protocol/schema");
  const v2Root = join(schemaRoot, "v2");
  mkdirSync(v2Root, { recursive: true });

  writeJson(join(schemaRoot, "ClientRequest.json"), {
    oneOf: [
      request("thread/start"),
      request("thread/resume"),
      request("thread/fork"),
      request("thread/name/set"),
      request("thread/archive"),
      request("thread/unarchive"),
      request("thread/turns/list"),
    ],
  });
  writeJson(join(schemaRoot, "ServerNotification.json"), {
    oneOf: [notification("remoteControl/status/changed")],
  });

  const commonFields = includePermissions ? ["permissions"] : [];
  writeJson(join(v2Root, "ThreadStartParams.json"), threadParams(commonFields));
  writeJson(
    join(v2Root, "ThreadResumeParams.json"),
    threadParams([...commonFields, "excludeTurns"]),
  );
  writeJson(join(v2Root, "ThreadForkParams.json"), threadParams([...commonFields, "excludeTurns"]));
  return root;
}

describe("check-app-server-semantics", () => {
  test("accepts the pinned schema shape and warns about thread/turns/list", () => {
    const messages = [];
    const result = checkAppServerSemantics({
      repoRoot: fixtureRepo(),
      log: (message) => messages.push(message),
    });

    expect(result).toBe(0);
    expect(messages.join("\n")).toContain(
      "thread/turns/list present in current pin; audit before Codex pin bump.",
    );
  });

  test("fails when thread params expose top-level permissions", () => {
    const messages = [];
    const result = checkAppServerSemantics({
      repoRoot: fixtureRepo({ includePermissions: true }),
      error: (message) => messages.push(message),
      log: () => {},
    });

    expect(result).toBe(1);
    expect(messages.join("\n")).toContain(
      "permissions now present; review writableRoots enforcement plan before release.",
    );
  });
});
