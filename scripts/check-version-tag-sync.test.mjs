import { describe, expect, it } from "vitest";
import {
  checkVersionTagSync,
  main,
  resolveExpectedTag,
} from "./check-version-tag-sync.mjs";

describe("check-version-tag-sync", () => {
  it("returns the tag verbatim when --tag is supplied", () => {
    expect(resolveExpectedTag({ argv: ["--tag", "v0.1.0-alpha.4"], env: {} })).toBe(
      "v0.1.0-alpha.4",
    );
  });

  it("derives the tag from GITHUB_REF when --tag is absent", () => {
    expect(
      resolveExpectedTag({
        argv: [],
        env: { GITHUB_REF: "refs/tags/v0.1.0-alpha.4" },
      }),
    ).toBe("v0.1.0-alpha.4");
  });

  it("returns undefined when neither --tag nor a tag GITHUB_REF is present", () => {
    expect(resolveExpectedTag({ argv: [], env: { GITHUB_REF: "refs/heads/main" } })).toBeUndefined();
    expect(resolveExpectedTag({ argv: [], env: {} })).toBeUndefined();
  });

  it("accepts a matching tag and version", () => {
    expect(
      checkVersionTagSync({ tag: "v0.1.0-alpha.4", packageVersion: "0.1.0-alpha.4" }),
    ).toEqual({
      ok: true,
      expected: "0.1.0-alpha.4",
      actual: "0.1.0-alpha.4",
      tag: "v0.1.0-alpha.4",
    });
  });

  it("rejects a mismatched tag and version", () => {
    expect(
      checkVersionTagSync({ tag: "v0.1.0-alpha.4", packageVersion: "0.1.0-alpha.1" }),
    ).toMatchObject({ ok: false });
  });

  it("strips an explicit leading 'v' from the tag before comparing", () => {
    expect(checkVersionTagSync({ tag: "0.1.0-alpha.4", packageVersion: "0.1.0-alpha.4" })).toEqual({
      ok: true,
      expected: "0.1.0-alpha.4",
      actual: "0.1.0-alpha.4",
      tag: "0.1.0-alpha.4",
    });
  });

  it("is a no-op on non-tag pushes (main script returns 0 with no GITHUB_REF)", () => {
    const exitCode = main({ argv: [], env: {} });
    expect(exitCode).toBe(0);
  });
});
