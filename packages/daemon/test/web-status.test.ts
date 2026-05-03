import { describe, expect, it } from "vitest";
import { planDaemonWebStatusConsole, renderDaemonWebStatusView } from "../src/index.js";
import type { DaemonStatusSnapshot } from "../src/index.js";

const SNAPSHOT: DaemonStatusSnapshot = {
  pid: 123,
  startedAt: "2026-05-03T00:00:00.000Z",
  currentCodexThreadCount: 2,
  pendingApprovalCount: 1,
  lastCodexSpawnAt: "2026-05-03T00:01:00.000Z",
  supervisorFailureCount: 0,
  lastFatal: {
    at: "2026-05-03T00:02:00.000Z",
    message:
      "boom IM_TELEGRAM_BOT_TOKEN=1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi LARK_APP_SECRET=sk-testsecret1234567890 standalone sk-standalonesecret1234567890 ghp_1234567890abcdefghij xoxb-1234567890-abcdefghij Authorization: Bearer bearer-token-1234567890abcdef /Users/jackwu/private <script>alert(1)</script>",
  },
};

describe("daemon web status read-only surface (JAC-106)", () => {
  it("renders read-only status without secrets or mutation controls", () => {
    const view = renderDaemonWebStatusView(SNAPSHOT, {
      bind: planDaemonWebStatusConsole(),
    });

    expect(view.contentType).toBe("text/html; charset=utf-8");
    expect(view.body).toContain("Codex IM Daemon Status");
    expect(view.body).toContain("Read-only");
    expect(view.body).toContain("127.0.0.1");
    expect(view.body).toContain("currentCodexThreadCount");
    expect(view.body).not.toContain("1234567890:");
    expect(view.body).not.toContain("sk-testsecret1234567890");
    expect(view.body).not.toContain("sk-standalonesecret1234567890");
    expect(view.body).not.toContain("ghp_1234567890abcdefghij");
    expect(view.body).not.toContain("xoxb-1234567890-abcdefghij");
    expect(view.body).not.toContain("bearer-token-1234567890abcdef");
    expect(view.body).not.toContain("/Users/jackwu/");
    expect(view.body).not.toContain("<script>");
    expect(view.body).not.toMatch(/<form\b|<button\b|method=|data-action=|\/approve|\/deny/i);
  });

  it("defaults to a loopback-only bind plan", () => {
    expect(planDaemonWebStatusConsole()).toEqual({
      host: "127.0.0.1",
      port: 0,
      readOnly: true,
    });
  });

  it.each(["0.0.0.0", "::", "192.168.1.8", "10.0.0.3", "172.16.0.4", "example.com"])(
    "rejects public or non-loopback host %s",
    (host) => {
      expect(() => planDaemonWebStatusConsole({ host })).toThrow(/loopback-only/);
    },
  );

  it.each(["127.0.0.1", "localhost", "::1"])("allows loopback host %s", (host) => {
    expect(planDaemonWebStatusConsole({ host })).toMatchObject({
      host,
      readOnly: true,
    });
  });
});
