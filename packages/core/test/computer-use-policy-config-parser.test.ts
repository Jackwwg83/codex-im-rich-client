import { describe, expect, it } from "vitest";
import { parseComputerUsePolicyConfig } from "../src/computer-use-policy-config-parser.js";

describe("parseComputerUsePolicyConfig", () => {
  it("returns undefined when the outer config is not an object", () => {
    expect(parseComputerUsePolicyConfig(undefined)).toBeUndefined();
    expect(parseComputerUsePolicyConfig(null)).toBeUndefined();
    expect(parseComputerUsePolicyConfig("not-an-object")).toBeUndefined();
    expect(parseComputerUsePolicyConfig(42)).toBeUndefined();
  });

  it("returns undefined when the computerUse field is missing or not an object", () => {
    expect(parseComputerUsePolicyConfig({})).toBeUndefined();
    expect(parseComputerUsePolicyConfig({ computerUse: null })).toBeUndefined();
    expect(parseComputerUsePolicyConfig({ computerUse: "yes" })).toBeUndefined();
  });

  it("disables by default and requires enabled === true to flip it on", () => {
    expect(parseComputerUsePolicyConfig({ computerUse: {} })).toMatchObject({
      enabled: false,
    });
    expect(parseComputerUsePolicyConfig({ computerUse: { enabled: "true" } })).toMatchObject({
      enabled: false,
    });
    expect(parseComputerUsePolicyConfig({ computerUse: { enabled: 1 } })).toMatchObject({
      enabled: false,
    });
    expect(parseComputerUsePolicyConfig({ computerUse: { enabled: true } })).toMatchObject({
      enabled: true,
    });
  });

  it("defaults requireExplicitPrefix to true and accepts only boolean overrides", () => {
    expect(parseComputerUsePolicyConfig({ computerUse: {} })).toMatchObject({
      requireExplicitPrefix: true,
    });
    expect(
      parseComputerUsePolicyConfig({ computerUse: { requireExplicitPrefix: false } }),
    ).toMatchObject({
      requireExplicitPrefix: false,
    });
    expect(
      parseComputerUsePolicyConfig({ computerUse: { requireExplicitPrefix: "no" } }),
    ).toMatchObject({
      requireExplicitPrefix: true,
    });
  });

  it("forces unknownAppPolicy to 'deny' regardless of input", () => {
    expect(parseComputerUsePolicyConfig({ computerUse: {} })).toMatchObject({
      unknownAppPolicy: "deny",
    });
    expect(
      parseComputerUsePolicyConfig({ computerUse: { unknownAppPolicy: "allow" } }),
    ).toMatchObject({
      unknownAppPolicy: "deny",
    });
  });

  it("includes optional fields only when present and well-typed", () => {
    const minimal = parseComputerUsePolicyConfig({ computerUse: {} });
    expect(minimal).toBeDefined();
    expect(Object.hasOwn(minimal as object, "defaultApp")).toBe(false);
    expect(Object.hasOwn(minimal as object, "denyApps")).toBe(false);
    expect(Object.hasOwn(minimal as object, "requireApprovalKeywords")).toBe(false);

    const withDefaultApp = parseComputerUsePolicyConfig({
      computerUse: { defaultApp: "Chrome" },
    });
    expect(withDefaultApp?.defaultApp).toBe("Chrome");

    const nonStringDefaultApp = parseComputerUsePolicyConfig({
      computerUse: { defaultApp: 7 },
    });
    expect(Object.hasOwn(nonStringDefaultApp as object, "defaultApp")).toBe(false);
  });

  it("filters non-string entries out of allowedApps / denyApps / requireApprovalKeywords", () => {
    const parsed = parseComputerUsePolicyConfig({
      computerUse: {
        allowedApps: ["Chrome", 1, "Slack", null, "Mail"],
        denyApps: ["Banking", true, undefined, "Wallet"],
        requireApprovalKeywords: ["wire", 42, "transfer", {}],
      },
    });
    expect(parsed?.allowedApps).toEqual(["Chrome", "Slack", "Mail"]);
    expect(parsed?.denyApps).toEqual(["Banking", "Wallet"]);
    expect(parsed?.requireApprovalKeywords).toEqual(["wire", "transfer"]);
  });

  it("returns an empty allowedApps array when the field is missing or not an array", () => {
    expect(parseComputerUsePolicyConfig({ computerUse: {} })?.allowedApps).toEqual([]);
    expect(
      parseComputerUsePolicyConfig({ computerUse: { allowedApps: "Chrome" } })?.allowedApps,
    ).toEqual([]);
  });

  it("defaults liveSmokeEnabled to false and accepts only boolean overrides", () => {
    expect(parseComputerUsePolicyConfig({ computerUse: {} })?.liveSmokeEnabled).toBe(false);
    expect(
      parseComputerUsePolicyConfig({ computerUse: { liveSmokeEnabled: true } })?.liveSmokeEnabled,
    ).toBe(true);
    expect(
      parseComputerUsePolicyConfig({ computerUse: { liveSmokeEnabled: 1 } })?.liveSmokeEnabled,
    ).toBe(false);
  });

  it("preserves the legacy daemon shape on a fully-populated input", () => {
    const parsed = parseComputerUsePolicyConfig({
      computerUse: {
        enabled: true,
        requireExplicitPrefix: false,
        defaultApp: "Chrome",
        allowedApps: ["Chrome", "Slack"],
        denyApps: ["Banking"],
        unknownAppPolicy: "deny",
        requireApprovalKeywords: ["transfer", "wire"],
        liveSmokeEnabled: true,
      },
    });
    expect(parsed).toEqual({
      enabled: true,
      requireExplicitPrefix: false,
      defaultApp: "Chrome",
      allowedApps: ["Chrome", "Slack"],
      denyApps: ["Banking"],
      unknownAppPolicy: "deny",
      requireApprovalKeywords: ["transfer", "wire"],
      liveSmokeEnabled: true,
    });
  });
});
