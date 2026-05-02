import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Daemon, type DaemonOptions } from "../src/index.js";

const SRC_DIR = join(import.meta.dirname, "../src");

function readSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...readSourceFiles(path));
      continue;
    }
    if (path.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("Daemon skeleton (T14)", () => {
  it("starts and stops as an idempotent no-op skeleton", async () => {
    const daemon = new Daemon();

    expect(daemon.isStarted()).toBe(false);
    await expect(daemon.start()).resolves.toBeUndefined();
    await expect(daemon.start()).resolves.toBeUndefined();
    expect(daemon.isStarted()).toBe(true);

    await expect(daemon.stop()).resolves.toBeUndefined();
    await expect(daemon.stop()).resolves.toBeUndefined();
    expect(daemon.isStarted()).toBe(false);
  });

  it("stores the future injection bag without invoking dependencies in T14", async () => {
    const loadConfig = vi.fn();
    const openStorage = vi.fn();
    const createBroker = vi.fn();
    const createSecurityPolicy = vi.fn();
    const createSessionRouter = vi.fn();
    const createSupervisor = vi.fn();
    const createAdapter = vi.fn();
    const options: DaemonOptions = {
      loadConfig,
      openStorage,
      createBroker,
      createSecurityPolicy,
      createSessionRouter,
      createSupervisor,
      createAdapter,
    };

    const daemon = new Daemon(options);
    expect(daemon.options).toBe(options);
    await daemon.start();
    await daemon.stop();

    expect(loadConfig).not.toHaveBeenCalled();
    expect(openStorage).not.toHaveBeenCalled();
    expect(createBroker).not.toHaveBeenCalled();
    expect(createSecurityPolicy).not.toHaveBeenCalled();
    expect(createSessionRouter).not.toHaveBeenCalled();
    expect(createSupervisor).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("does not introduce a public listener surface", () => {
    const source = readSourceFiles(SRC_DIR)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(source).not.toMatch(/\bcreateServer\s*\(/);
    expect(source).not.toMatch(/\bnew\s+Server\s*\(/);
    expect(source).not.toMatch(/\.listen\s*\(/);
  });
});
