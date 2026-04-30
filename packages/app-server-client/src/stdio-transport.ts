/**
 * StdioTransport — spawns a child process and frames JSONL on stdin/stdout.
 *
 * Production use: spawn `codex app-server --listen stdio://`, route stderr
 * to pino.warn (it's diagnostic noise, not protocol — see Phase 0 wire spike
 * case 5: malformed JSON goes only to stderr). On stop(), close stdin
 * gracefully, wait shutdownGraceMs, then SIGKILL if still alive.
 *
 * Lifecycle:
 *   start() -> execa spawn -> stdin/stdout/stderr piped
 *   stdout chunks -> JsonlDecoder -> onMessage handlers
 *   stderr lines  -> logger.warn (never parsed as JSON)
 *   stop()  -> stdin.end() -> wait grace -> SIGKILL if needed
 *   child exit -> onClose(exitCode)
 *
 * Codex outside-voice finding #6: StdioTransportOptions has the full
 * shape from day one (command, args, cwd?, env?, configOverrides?,
 * shutdownGraceMs?, logger?). configOverrides translates to repeated
 * `-c key=value` args appended to args. Values are TOML-encoded:
 *   string -> JSON.stringify (gives quoted form)
 *   number/boolean -> raw
 */

import { type Options, type ResultPromise, execa } from "execa";
import pino, { type Logger } from "pino";
import { TransportClosedError, TransportProtocolError } from "./errors.js";
import { JsonlDecoder, encodeJsonl } from "./jsonl.js";
import type { Transport, Unsubscribe } from "./transport.js";

export interface StdioTransportOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /**
   * TOML overrides translated to repeated `-c key=value` args appended after
   * args. Values are TOML-quoted (string -> JSON.stringify; number/boolean raw).
   */
  configOverrides?: Record<string, string | number | boolean>;
  /** Grace period before SIGKILL when stop() is called (default 2000ms). */
  shutdownGraceMs?: number;
  /** Optional logger; default a pino instance scoped to "StdioTransport". */
  logger?: Logger;
}

export class StdioTransport implements Transport {
  private child: ResultPromise | null = null;
  private decoder = new JsonlDecoder();
  private msgHandlers = new Set<(m: unknown) => void>();
  private errHandlers = new Set<(e: Error) => void>();
  private closeHandlers = new Set<(c: number | null) => void>();
  private stderrBuf = "";
  private readonly log: Logger;
  private stopped = false;

  constructor(private readonly opts: StdioTransportOptions) {
    this.log = opts.logger ?? pino({ name: "StdioTransport", level: "warn" });
  }

  async start(): Promise<void> {
    const finalArgs = [...this.opts.args];
    for (const [k, v] of Object.entries(this.opts.configOverrides ?? {})) {
      const toml = typeof v === "string" ? JSON.stringify(v) : String(v);
      finalArgs.push("-c", `${k}=${toml}`);
    }

    // Build execa Options conditionally — exactOptionalPropertyTypes
    // forbids passing literal undefined for optional properties, and execa's
    // Options interface isn't designed for that flag, so we explicitly type
    // the spread.
    const execaOpts: Options = {
      env: { ...process.env, ...(this.opts.env ?? {}) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      reject: false,
      ...(this.opts.cwd !== undefined ? { cwd: this.opts.cwd } : {}),
    };

    let child: ResultPromise;
    try {
      child = execa(this.opts.command, finalArgs, execaOpts);
    } catch (err) {
      throw new TransportProtocolError(
        `spawn failed (sync): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.child = child;

    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr || !child.stdin) {
      throw new TransportProtocolError(
        "spawn produced no stdin/stdout/stderr — execa contract violation",
      );
    }

    stdout.on("data", (chunk: Buffer) => {
      try {
        const out = this.decoder.push(chunk);
        for (const m of out) {
          for (const h of this.msgHandlers) h(m);
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        for (const h of this.errHandlers) h(e);
      }
    });

    stderr.on("data", (chunk: Buffer) => {
      this.stderrBuf += chunk.toString("utf8");
      while (true) {
        const idx = this.stderrBuf.indexOf("\n");
        if (idx === -1) break;
        const line = this.stderrBuf.slice(0, idx).trimEnd();
        this.stderrBuf = this.stderrBuf.slice(idx + 1);
        if (line) this.log.warn({ stream: "stderr" }, line);
      }
    });

    // Surface child-process spawn errors (ENOENT, EACCES) async.
    // execa uses .on for the underlying child's `error` event.
    child.on?.("error", (err: Error) => {
      const wrapped =
        "code" in err && err.code === "ENOENT"
          ? new TransportProtocolError(`spawn failed: command not found (${this.opts.command})`)
          : new TransportProtocolError(`child error: ${err.message}`);
      for (const h of this.errHandlers) h(wrapped);
    });

    void child.then(
      (result) => {
        const code = result.exitCode ?? null;
        for (const h of this.closeHandlers) h(code);
      },
      (err) => {
        // execa with reject:false should not throw; if it does, surface it.
        for (const h of this.errHandlers) h(err instanceof Error ? err : new Error(String(err)));
        for (const h of this.closeHandlers) h(null);
      },
    );
  }

  async stop(): Promise<void> {
    if (!this.child || this.stopped) return;
    this.stopped = true;
    const grace = this.opts.shutdownGraceMs ?? 2000;
    try {
      this.child.stdin?.end();
    } catch {
      // ignore — best-effort
    }
    const result = await Promise.race([
      this.child.then(
        (r) => r,
        () => null,
      ),
      new Promise<null>((r) => setTimeout(() => r(null), grace)),
    ]);
    if (result === null && this.child && !this.child.killed) {
      this.child.kill("SIGKILL");
    }
    this.child = null;
  }

  send(msg: unknown): void {
    if (!this.child || this.stopped) {
      throw new TransportClosedError(null);
    }
    if (!this.child.stdin) throw new TransportClosedError(null);
    this.child.stdin.write(encodeJsonl(msg));
  }

  onMessage(h: (m: unknown) => void): Unsubscribe {
    this.msgHandlers.add(h);
    return () => {
      this.msgHandlers.delete(h);
    };
  }

  onError(h: (e: Error) => void): Unsubscribe {
    this.errHandlers.add(h);
    return () => {
      this.errHandlers.delete(h);
    };
  }

  onClose(h: (c: number | null) => void): Unsubscribe {
    this.closeHandlers.add(h);
    return () => {
      this.closeHandlers.delete(h);
    };
  }
}
