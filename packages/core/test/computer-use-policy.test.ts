import { describe, expect, it } from "vitest";
import { ComputerUsePolicy } from "../src/computer-use-policy.js";

describe("ComputerUsePolicy (Phase 6 JAC-93)", () => {
  it("defaults to disabled and fails closed", () => {
    const policy = new ComputerUsePolicy();

    expect(policy.check({ app: "Google Chrome", task: "open docs" })).toEqual({
      kind: "deny",
      reason: "policy_disabled",
    });
  });

  it("denies Keychain Access even if allowlisted", () => {
    const policy = new ComputerUsePolicy({
      enabled: true,
      allowedApps: ["Google Chrome", "Keychain Access"],
      denyApps: ["Keychain Access"],
    });

    expect(policy.check({ app: "Keychain Access", task: "open Keychain Access" })).toEqual({
      kind: "deny",
      reason: "app_denied",
    });
  });

  it("denies empty allowlists and unlisted apps", () => {
    const emptyAllowlist = new ComputerUsePolicy({
      enabled: true,
      allowedApps: [],
    });
    expect(emptyAllowlist.check({ app: "Google Chrome", task: "open docs" })).toEqual({
      kind: "deny",
      reason: "allowed_apps_empty",
    });

    const allowChromeOnly = new ComputerUsePolicy({
      enabled: true,
      allowedApps: ["Google Chrome"],
    });
    expect(allowChromeOnly.check({ app: "Safari", task: "open docs" })).toEqual({
      kind: "deny",
      reason: "app_not_allowed",
    });
  });

  it("allows listed apps and marks sensitive keywords for later approval handling", () => {
    const policy = new ComputerUsePolicy({
      enabled: true,
      allowedApps: ["Google Chrome"],
      requireApprovalKeywords: ["login", "token"],
    });

    expect(policy.check({ app: "google chrome", task: "login with token" })).toEqual({
      kind: "allow",
      app: "Google Chrome",
      requiresApproval: true,
      approvalReasons: ["keyword:login", "keyword:token"],
    });
  });

  it("treats invalid policy shapes as deny decisions instead of allowing by accident", () => {
    const policy = new ComputerUsePolicy({
      enabled: true,
      allowedApps: "Google Chrome",
    } as unknown as ConstructorParameters<typeof ComputerUsePolicy>[0]);

    expect(policy.snapshot.valid).toBe(false);
    expect(policy.check({ app: "Google Chrome", task: "open docs" })).toEqual({
      kind: "deny",
      reason: "invalid_policy",
    });
  });
});
