// T18 (Phase 2) — ChannelCapabilities + requireCapability tests.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T18

import { describe, expect, it } from "vitest";
import type { ChannelCapabilities } from "../src/index.js";
import { requireCapability } from "../src/index.js";

const TELEGRAM_LIKE: ChannelCapabilities = {
  supportsButtons: true,
  canEditMessage: true,
  supportsAttachments: true,
  maxCallbackDataBytes: 64,
};

const PLAIN_TEXT_LIKE: ChannelCapabilities = {
  supportsButtons: false,
  canEditMessage: false,
  supportsAttachments: false,
  maxCallbackDataBytes: 0,
};

describe("ChannelCapabilities (T18)", () => {
  it("Telegram-like capabilities all flags true and positive max", () => {
    expect(TELEGRAM_LIKE.supportsButtons).toBe(true);
    expect(TELEGRAM_LIKE.canEditMessage).toBe(true);
    expect(TELEGRAM_LIKE.supportsAttachments).toBe(true);
    expect(TELEGRAM_LIKE.maxCallbackDataBytes).toBeGreaterThan(0);
  });
});

describe("requireCapability (T18)", () => {
  it("passes when capability is true", () => {
    expect(() => requireCapability(TELEGRAM_LIKE, "supportsButtons")).not.toThrow();
    expect(() => requireCapability(TELEGRAM_LIKE, "canEditMessage")).not.toThrow();
    expect(() => requireCapability(TELEGRAM_LIKE, "supportsAttachments")).not.toThrow();
  });

  it("throws when boolean capability is false", () => {
    expect(() => requireCapability(PLAIN_TEXT_LIKE, "supportsButtons")).toThrow(/supportsButtons/);
    expect(() => requireCapability(PLAIN_TEXT_LIKE, "canEditMessage")).toThrow(/canEditMessage/);
    expect(() => requireCapability(PLAIN_TEXT_LIKE, "supportsAttachments")).toThrow(
      /supportsAttachments/,
    );
  });

  it("passes when numeric capability is positive", () => {
    expect(() => requireCapability(TELEGRAM_LIKE, "maxCallbackDataBytes")).not.toThrow();
  });

  it("throws when numeric capability is zero or negative", () => {
    expect(() => requireCapability(PLAIN_TEXT_LIKE, "maxCallbackDataBytes")).toThrow(
      /maxCallbackDataBytes/,
    );
  });

  it("throws on non-finite numeric capability", () => {
    const broken: ChannelCapabilities = {
      ...TELEGRAM_LIKE,
      maxCallbackDataBytes: Number.NaN,
    };
    expect(() => requireCapability(broken, "maxCallbackDataBytes")).toThrow(/non-positive/);
  });
});
