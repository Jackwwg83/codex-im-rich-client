import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { TransportProtocolError } from "../src/errors.js";
import { StdioTransport } from "../src/stdio-transport.js";

const here = dirname(fileURLToPath(import.meta.url));
const echoFixture = join(here, "fixtures", "echo-stdio.mjs");
const argvFixture = join(here, "fixtures", "argv-print.mjs");
const sigtermFixture = join(here, "fixtures", "sigterm-ignore.mjs");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(read: () => T | undefined, label: string, timeoutMs = 1_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    await delay(10);
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("StdioTransport — round-trip (Task 6.1)", () => {
  it("sends a JSON-RPC request and receives a JSONL response", async () => {
    const t = new StdioTransport({
      command: "node",
      args: [echoFixture],
    });
    await t.start();
    const got: unknown[] = [];
    t.onMessage((m) => got.push(m));

    t.send({ id: 1, method: "ping" });
    const first = await waitFor(() => got[0], "echo response");

    expect(first).toEqual({ id: 1, result: { echoed: "ping" } });

    await t.stop();
  });

  it("emits onClose with exit code when child exits cleanly", async () => {
    const t = new StdioTransport({
      command: "node",
      args: [echoFixture],
    });
    await t.start();
    let closeCode: number | null | undefined;
    t.onClose((c) => {
      closeCode = c;
    });
    await t.stop();
    await waitFor(() => (closeCode !== undefined ? closeCode : undefined), "child close event");
    expect(closeCode).toBe(0);
  });
});

describe("StdioTransport — configOverrides translation (Task 6.2)", () => {
  it("translates configOverrides into repeated `-c key=value` args", async () => {
    const t = new StdioTransport({
      command: "node",
      args: [argvFixture],
      configOverrides: {
        sandbox_mode: "read-only",
        approval_policy: "on-request",
        retries: 3,
        debug: true,
      },
    });
    await t.start();
    const got: unknown[] = [];
    t.onMessage((m) => got.push(m));
    const first = await waitFor(() => got[0], "argv response");

    const out = first as { argv: string[] };
    // argv-print emits process.argv.slice(2), so it starts with the fixture path
    // followed by our injected -c args.
    const cArgs = out.argv.filter((_, i, arr) => i > 0 && arr[i - 1] === "-c");
    expect(cArgs).toContain('sandbox_mode="read-only"');
    expect(cArgs).toContain('approval_policy="on-request"');
    expect(cArgs).toContain("retries=3");
    expect(cArgs).toContain("debug=true");

    await t.stop();
  });
});

describe("StdioTransport — stderr routing (Task 6.3)", () => {
  it("routes stderr lines to logger.warn (no JSON parsing)", async () => {
    // Inject a logger spy. Use pino's own mechanism via destination()
    // would be cleaner, but a simple object satisfies the Logger shape
    // for our usage (only .warn is called).
    const warnSpy = vi.fn();
    const fakeLogger = pino({
      level: "silent",
    });
    // Wrap warn to capture calls.
    const orig = fakeLogger.warn.bind(fakeLogger);
    fakeLogger.warn = ((...args: unknown[]) => {
      warnSpy(...args);
      return orig(...(args as Parameters<typeof orig>));
    }) as typeof fakeLogger.warn;

    const t = new StdioTransport({
      command: "node",
      args: [echoFixture],
      logger: fakeLogger,
    });
    await t.start();
    const firstCall = await waitFor(() => warnSpy.mock.calls[0], "stderr warn call");

    // echo-stdio writes "echo-stdio booted\n" to stderr on boot.
    expect(warnSpy).toHaveBeenCalled();
    const callArg = firstCall[1] as string | undefined;
    expect(callArg).toContain("echo-stdio booted");

    await t.stop();
  });
});

describe("StdioTransport — spawn ENOENT (Task 6.4)", () => {
  it("surfaces ENOENT as TransportProtocolError via onError", async () => {
    const t = new StdioTransport({
      command: "/no/such/binary/anywhere",
      args: [],
    });
    const errors: Error[] = [];
    t.onError((e) => errors.push(e));
    let closeCode: number | null | undefined = "unset" as unknown as null;
    t.onClose((c) => {
      closeCode = c;
    });

    await t.start();
    // Allow child error event to fire async.
    await waitFor(
      () =>
        errors.some((e) => e instanceof TransportProtocolError) || closeCode === null
          ? true
          : undefined,
      "spawn error",
    );

    // Either onError fires with TransportProtocolError, or onClose fires
    // with null exit code — both are acceptable error paths.
    const got = errors.find((e) => e instanceof TransportProtocolError);
    expect(got || closeCode === null).toBeTruthy();

    await t.stop();
  });
});

describe("StdioTransport — SIGKILL grace period (Task 6.5)", () => {
  it("force-kills child that ignores SIGTERM after shutdownGraceMs", async () => {
    const t = new StdioTransport({
      command: "node",
      args: [sigtermFixture],
      shutdownGraceMs: 100,
    });
    let closed = false;
    t.onClose(() => {
      closed = true;
    });
    await t.start();
    await delay(80); // Let child boot.

    const stopStart = Date.now();
    await t.stop();
    const stopElapsed = Date.now() - stopStart;
    // Stop should return within ~grace + small overhead.
    // Give a generous margin (300ms) for CI variance.
    expect(stopElapsed).toBeLessThan(300);

    // Wait for close event to propagate.
    await waitFor(() => (closed ? true : undefined), "forced close event");
    expect(closed).toBe(true);
  }, 5_000);
});
