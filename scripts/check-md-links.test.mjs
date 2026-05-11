import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findBrokenLinks, main } from "./check-md-links.mjs";

describe("check-md-links", () => {
  it("ignores http, https, mailto, and bare anchor links", () => {
    const src = `
See [the spec](https://example.com/spec) and [contact](mailto:foo@bar) and
jump to [overview](#overview).
`;
    expect(findBrokenLinks("/tmp/fake.md", src)).toEqual([]);
  });

  it("reports a broken relative link", () => {
    const tmp = mkdtempSync(join(tmpdir(), "check-md-links-"));
    try {
      const f = join(tmp, "file.md");
      writeFileSync(f, "[gone](./does-not-exist.md)");
      const broken = findBrokenLinks(f, "[gone](./does-not-exist.md)");
      expect(broken).toHaveLength(1);
      expect(broken[0].target).toBe("./does-not-exist.md");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("accepts a relative link that resolves to an existing sibling file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "check-md-links-"));
    try {
      writeFileSync(join(tmp, "sibling.md"), "# Sibling");
      const f = join(tmp, "file.md");
      const src = "[ok](./sibling.md)";
      writeFileSync(f, src);
      expect(findBrokenLinks(f, src)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("strips anchors before resolving a path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "check-md-links-"));
    try {
      writeFileSync(join(tmp, "target.md"), "# Target");
      const f = join(tmp, "file.md");
      const src = "[deep link](./target.md#section)";
      writeFileSync(f, src);
      expect(findBrokenLinks(f, src)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("agrees with the real repo customer-facing docs (regression guard)", () => {
    expect(main()).toBe(0);
  });
});
