// Slice 2.1 hardening item #3 — configured_project realpath + existence
// validation tests.

import {
  mkdir,
  mkdtemp,
  realpath as realpathFn,
  rm,
  stat as statFn,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CodexImConfig,
  CodexImConfigPathError,
  type CodexImProjectPathFs,
  validateProjectPaths,
} from "../src/index.js";

const PROD_FS: CodexImProjectPathFs = {
  realpath: realpathFn,
  stat: statFn,
};

function makeConfig(projects: Record<string, { cwd: string; writableRoots: string[] }>) {
  return {
    daemon: { dataDir: "/tmp", logDir: "/tmp", maxInboundAttachmentBytes: 1 },
    storage: { sqlitePath: "/tmp/db.sqlite", autoMigrate: true },
    codex: { binary: "codex", versionPin: "0.130.0" },
    security: {
      allowedUsers: [],
      allowedChats: [],
      adminUsers: [],
      groupPolicy: { mentionRequiredChats: [], mentionAliases: [] },
      commands: { denyPatterns: [], requireAdminPatterns: [] },
    },
    computerUse: {
      enabled: false,
      requireExplicitPrefix: true,
      defaultApp: "",
      allowedApps: [],
      denyApps: [],
      unknownAppPolicy: "deny" as const,
      requireApprovalKeywords: [],
      liveSmokeEnabled: false,
    },
    im: {
      output: {
        mode: "normal",
      },
      nativeThreadVisibility: "project_limited",
    },
    adapters: {
      telegram: { enabled: false, botTokenEnv: "" },
      lark: {
        enabled: false,
        appId: "",
        appSecretEnv: "",
        domain: "feishu" as const,
        allowedChatIds: [],
      },
      dingtalk: { enabled: false, clientId: "", clientSecretEnv: "" },
      slack: { enabled: false, botTokenEnv: "", appTokenEnv: "", allowedChannelIds: [] },
    },
    projects: Object.fromEntries(
      Object.entries(projects).map(([name, { cwd, writableRoots }]) => [
        name,
        { cwd, allowedUsers: [], allowedChats: [], writableRoots },
      ]),
    ),
  } satisfies CodexImConfig;
}

describe("validateProjectPaths", () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "codex-im-validate-paths-"));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("accepts a project whose cwd is a real directory and returns the canonical path", async () => {
    const cwd = join(scratch, "project-a");
    await mkdir(cwd, { recursive: true });
    const config = makeConfig({ "project-a": { cwd, writableRoots: [] } });

    const result = await validateProjectPaths(config, PROD_FS);

    // macOS exposes /var as a symlink to /private/var; compare against
    // realpath(cwd) rather than the un-canonicalized scratch path.
    expect(result.canonicalProjectCwds.get("project-a")).toBe(await realpathFn(cwd));
  });

  it("canonicalizes a symlinked cwd to its target via realpath", async () => {
    const target = join(scratch, "real");
    const link = join(scratch, "link");
    await mkdir(target, { recursive: true });
    await symlink(target, link, "dir");
    const config = makeConfig({ "project-symlink": { cwd: link, writableRoots: [] } });

    const result = await validateProjectPaths(config, PROD_FS);

    expect(result.canonicalProjectCwds.get("project-symlink")).toBe(await realpathFn(target));
  });

  it("throws CodexImConfigPathError when project cwd does not exist", async () => {
    const cwd = join(scratch, "missing");
    const config = makeConfig({ "project-missing": { cwd, writableRoots: [] } });

    await expect(validateProjectPaths(config, PROD_FS)).rejects.toThrowError(
      CodexImConfigPathError,
    );
    await expect(validateProjectPaths(config, PROD_FS)).rejects.toMatchObject({
      projectName: "project-missing",
      field: "cwd",
      reason: "realpath_failed",
    });
  });

  it("throws when project cwd points to a regular file rather than a directory", async () => {
    const file = join(scratch, "file.txt");
    await writeFile(file, "not a dir");
    const config = makeConfig({ "project-file": { cwd: file, writableRoots: [] } });

    await expect(validateProjectPaths(config, PROD_FS)).rejects.toMatchObject({
      projectName: "project-file",
      field: "cwd",
      reason: "not_a_directory",
    });
  });

  it("throws for a missing writableRoots entry", async () => {
    const cwd = join(scratch, "p");
    await mkdir(cwd, { recursive: true });
    const config = makeConfig({
      "project-with-bad-root": { cwd, writableRoots: [join(scratch, "nope")] },
    });

    await expect(validateProjectPaths(config, PROD_FS)).rejects.toMatchObject({
      projectName: "project-with-bad-root",
      field: "writableRoots",
      reason: "realpath_failed",
    });
  });

  it("accepts multiple valid writableRoots entries on a project", async () => {
    const cwd = join(scratch, "p");
    const root1 = join(scratch, "root1");
    const root2 = join(scratch, "root2");
    await mkdir(cwd, { recursive: true });
    await mkdir(root1, { recursive: true });
    await mkdir(root2, { recursive: true });
    const config = makeConfig({
      "project-many-roots": { cwd, writableRoots: [root1, root2] },
    });

    await expect(validateProjectPaths(config, PROD_FS)).resolves.toMatchObject({
      canonicalProjectCwds: expect.any(Map),
    });
  });

  it("validates every project independently (later projects don't mask earlier failures)", async () => {
    const goodCwd = join(scratch, "good");
    await mkdir(goodCwd, { recursive: true });
    const config = makeConfig({
      "project-good": { cwd: goodCwd, writableRoots: [] },
      "project-bad": { cwd: join(scratch, "missing"), writableRoots: [] },
    });

    await expect(validateProjectPaths(config, PROD_FS)).rejects.toMatchObject({
      projectName: "project-bad",
    });
  });
});
