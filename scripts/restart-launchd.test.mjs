import { describe, expect, it, vi } from "vitest";
import { planLaunchdRestart, runLaunchdRestart } from "../bin/restart-launchd.mjs";

describe("restart-launchd", () => {
  it("plans a current-user kickstart for the installed IM bridge launch agent", () => {
    const plan = planLaunchdRestart({ uid: "501" });

    expect(plan.serviceTarget).toBe("gui/501/io.codex-im-bridge");
    expect(plan.launchctlArgs).toEqual(["kickstart", "-k", "gui/501/io.codex-im-bridge"]);
  });

  it("supports dry-run without invoking launchctl", async () => {
    const runLaunchctl = vi.fn();
    const lines = [];
    const exitCode = await runLaunchdRestart({
      dryRun: true,
      uid: "501",
      runLaunchctl,
      output: (line) => lines.push(line),
    });

    expect(exitCode).toBe(0);
    expect(runLaunchctl).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain(
      "launchctl: launchctl kickstart -k gui/501/io.codex-im-bridge",
    );
    expect(lines.join("\n")).toContain("mode: dry-run");
  });

  it("runs launchctl kickstart for real restarts", async () => {
    const runLaunchctl = vi.fn(() => Promise.resolve(0));
    const lines = [];
    const exitCode = await runLaunchdRestart({
      uid: "501",
      runLaunchctl,
      output: (line) => lines.push(line),
    });

    expect(exitCode).toBe(0);
    expect(runLaunchctl).toHaveBeenCalledWith(["kickstart", "-k", "gui/501/io.codex-im-bridge"]);
    expect(lines.join("\n")).toContain("mode: restarted");
  });
});
