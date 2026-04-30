/**
 * Initialize handshake helper — D1 from plan v2 Decision Log.
 *
 * Centralizes the `initialize` request + `initialized` notification sequence
 * so it lives in ONE place and is shared by:
 *   - `smoke:app-server` (Phase 0 Section J)
 *   - `smoke:real-turn` (Phase 0 Section J)
 *   - `CodexRuntime.initialize` (Phase 1)
 *
 * Codex outside-voice finding #7: returns the typed `InitializeResponse`
 * (not `void`) — the result carries operational facts (codexHome, platform,
 * userAgent) that Phase 1 health/version checks will consume.
 *
 * Wire shape (Phase 0 wire spike, host-environment.md case 1):
 *   request:  { id, method: "initialize", params: { clientInfo } }
 *   response: { id, result: { userAgent, codexHome, platformFamily, platformOs } }
 *   then:     notify "initialized"
 */

import type { ClientInfo, InitializeResponse } from "@codex-im/protocol";
import type { AppServerClient } from "./client.js";

export interface HandshakeOptions {
  /** Override the default 10s timeout for the initialize request. */
  timeoutMs?: number;
}

export async function performInitializeHandshake(
  client: AppServerClient,
  clientInfo: ClientInfo,
  opts: HandshakeOptions = {},
): Promise<InitializeResponse> {
  const result = await client.request<InitializeResponse>(
    "initialize",
    { clientInfo },
    { timeoutMs: opts.timeoutMs ?? 10_000 },
  );
  client.notify("initialized");
  return result;
}
