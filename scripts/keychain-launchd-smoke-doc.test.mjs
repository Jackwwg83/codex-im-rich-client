import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DOC = "docs/ops/keychain-launchd-smoke.md";
const TOKEN_SHAPED_LITERAL = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/;

describe("Keychain launchd smoke documentation (T29b)", () => {
  it("requires explicit live smoke gates, rollback, and redaction checks", () => {
    const text = readFileSync(DOC, "utf8");

    expect(text).toContain("TELEGRAM_LIVE=1");
    expect(text).toContain("KEYCHAIN_SMOKE=1");
    expect(text).toContain("pnpm launchd:install -- --dry-run");
    expect(text).toContain("bash bin/load-and-run.sh --dry-run");
    expect(text).toContain("security add-generic-password");
    expect(text).toContain("launchctl print");
    expect(text).toContain('! grep -F "$IM_TELEGRAM_BOT_TOKEN"');
    expect(text).toContain("launchctl unload");
    expect(text).toContain("security delete-generic-password");
    expect(text).toContain("Never record token bytes.");
    expect(text).not.toMatch(TOKEN_SHAPED_LITERAL);
  });
});
