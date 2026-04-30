/**
 * JSONL framing for Codex App Server's JSON-RPC lite stream.
 *
 * The transport (`stdio://` or `unix://`) emits one JSON object per line.
 * `JsonlDecoder` accepts arbitrary chunks (bytes do not respect line boundaries),
 * yields complete parsed objects, and tolerates blank lines + partial chunks.
 *
 * Wire facts confirmed by Phase 0 wire spike (docs/phase-0/host-environment.md):
 *   - Each frame is a single JSON object terminated by '\n'
 *   - The codex side does NOT emit the JSON-RPC `jsonrpc: "2.0"` field
 *   - Malformed input does NOT produce a JSON-RPC error response, only stderr
 */

export class JsonlDecoder {
  private buffer = "";

  /**
   * Push a chunk of incoming bytes / string. Returns 0+ parsed JSON values
   * for whatever complete lines were available. Partial trailing line is
   * buffered until the next push.
   */
  push(chunk: string | Buffer): unknown[] {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const out: unknown[] = [];
    while (true) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`JsonlDecoder: invalid JSON: ${reason}: ${line.slice(0, 200)}`);
      }
    }
    return out;
  }
}

/**
 * Encode a single JSON-RPC message as a newline-terminated UTF-8 line.
 * Used by `StdioTransport` to write to the codex child process's stdin.
 */
export function encodeJsonl(msg: unknown): string {
  return `${JSON.stringify(msg)}\n`;
}
