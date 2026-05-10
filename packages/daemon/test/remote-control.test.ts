import { describe, expect, it } from "vitest";
import {
  formatRemoteControlStatusLine,
  parseRemoteControlStatusParams,
} from "../src/remote-control.js";

describe("parseRemoteControlStatusParams", () => {
  it("accepts each known connection status", () => {
    for (const status of ["disabled", "connecting", "connected", "errored"] as const) {
      expect(parseRemoteControlStatusParams({ status, environmentId: null })).toEqual({
        status,
        environmentId: null,
      });
    }
  });

  it("preserves the environmentId when present and a string", () => {
    expect(
      parseRemoteControlStatusParams({ status: "connected", environmentId: "env-42" }),
    ).toEqual({ status: "connected", environmentId: "env-42" });
  });

  it("normalizes a missing or non-string environmentId to null", () => {
    expect(parseRemoteControlStatusParams({ status: "disabled" })).toEqual({
      status: "disabled",
      environmentId: null,
    });
    expect(parseRemoteControlStatusParams({ status: "connected", environmentId: 7 })).toEqual({
      status: "connected",
      environmentId: null,
    });
  });

  it("returns undefined when the status is missing or not one of the known values", () => {
    expect(parseRemoteControlStatusParams({})).toBeUndefined();
    expect(parseRemoteControlStatusParams({ status: "online" })).toBeUndefined();
    expect(parseRemoteControlStatusParams({ status: 1 })).toBeUndefined();
  });

  it("returns undefined for non-object input", () => {
    expect(parseRemoteControlStatusParams(undefined)).toBeUndefined();
    expect(parseRemoteControlStatusParams(null)).toBeUndefined();
    expect(parseRemoteControlStatusParams("connected")).toBeUndefined();
    expect(parseRemoteControlStatusParams(42)).toBeUndefined();
  });
});

describe("formatRemoteControlStatusLine", () => {
  it("renders 'unknown' when no update has been observed", () => {
    expect(formatRemoteControlStatusLine(undefined)).toBe("Codex remote control: unknown");
  });

  it("renders the connection status verbatim", () => {
    for (const status of ["disabled", "connecting", "connected", "errored"] as const) {
      expect(formatRemoteControlStatusLine({ status, environmentId: null })).toBe(
        `Codex remote control: ${status}`,
      );
    }
  });

  it("does not leak the environmentId into the status line", () => {
    // Per ADR 0004 this output is informational only; the environment id
    // is bridge-internal state, not surfaced to the IM operator.
    expect(
      formatRemoteControlStatusLine({ status: "connected", environmentId: "secret-env" }),
    ).toBe("Codex remote control: connected");
  });
});
