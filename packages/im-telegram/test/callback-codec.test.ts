import { describe, expect, it } from "vitest";
import { decodeCallbackData, encodeCallbackData } from "../src/index.js";

describe("Telegram callback codec (T22a)", () => {
  it("round-trips a v1 opaque 16-char base32 token within 19 bytes", () => {
    const rawToken = "ABCDEFGHIJKLMNOP";
    const encoded = encodeCallbackData(rawToken);

    expect(encoded).toBe("v1:ABCDEFGHIJKLMNOP");
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(19);
    expect(decodeCallbackData(encoded)).toBe(rawToken);
  });

  it("rejects callback_data without the v1 prefix", () => {
    expect(decodeCallbackData("ABCDEFGHIJKLMNOP")).toBeUndefined();
  });

  it("rejects non-opaque legacy approval/action/nonce shapes", () => {
    expect(() => encodeCallbackData("approval-id|allow_once|nonce")).toThrow(/opaque token/);
    expect(decodeCallbackData("v1:approval-id|allow_once|nonce")).toBeUndefined();
  });

  it("rejects tokens that would exceed the 19-byte v1 callback_data budget", () => {
    expect(() => encodeCallbackData("ABCDEFGHIJKLMNOPQ")).toThrow(/16-char/);
    expect(decodeCallbackData("v1:ABCDEFGHIJKLMNOPQ")).toBeUndefined();
  });
});
