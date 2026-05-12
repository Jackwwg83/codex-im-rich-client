import { describe, expect, it, vi } from "vitest";
import {
  formatAppServerLifecycleProbe,
  probeAppServerLifecycle,
} from "./app-server-lifecycle-probe.mts";

describe("app-server lifecycle probe", () => {
  it("parses JSON stdout from codex app-server daemon version", () => {
    const runner = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({
        backend: "pidfile",
        socketPath: "/Users/operator/.codex/app-server.sock",
        cliVersion: "0.130.0",
        appServerVersion: "0.130.0",
      }),
      stderr: "",
    }));

    const result = probeAppServerLifecycle({ runner });

    expect(runner).toHaveBeenCalledWith("codex", ["app-server", "daemon", "version"], {
      timeoutMs: 2000,
    });
    expect(result.kind).toBe("available");
    expect(formatAppServerLifecycleProbe(result)).toContain(
      "Codex App Server lifecycle daemon: available",
    );
    expect(formatAppServerLifecycleProbe(result)).toContain("cli=0.130.0");
    expect(JSON.stringify(result)).not.toContain("/Users/operator");
  });

  it("treats missing daemon command and non-JSON output as unavailable", () => {
    const missing = probeAppServerLifecycle({
      runner: () => ({
        status: 2,
        stdout: "",
        stderr: "error: unrecognized subcommand 'daemon'",
      }),
    });
    const nonJson = probeAppServerLifecycle({
      runner: () => ({ status: 0, stdout: "human text", stderr: "" }),
    });

    expect(missing).toEqual({ kind: "unavailable", reason: "command_unavailable" });
    expect(nonJson).toEqual({ kind: "unavailable", reason: "invalid_json" });
    expect(formatAppServerLifecycleProbe(missing)).toBe(
      "Codex App Server lifecycle daemon: unavailable in current pinned Codex",
    );
  });
});
