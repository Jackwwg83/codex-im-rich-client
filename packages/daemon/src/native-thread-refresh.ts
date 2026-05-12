import type { Target } from "@codex-im/core";
import type { ThreadSessionUpsert } from "@codex-im/storage-sqlite";
import { projectDisplayNameFromCwd } from "./format.js";

export interface NativeThreadRefreshEntry {
  readonly threadId: string;
  readonly cwd: string;
  readonly title: string;
}

export interface NativeThreadRefreshRepository {
  upsert(input: ThreadSessionUpsert): unknown;
}

export function importNativeThreads(input: {
  readonly repository: NativeThreadRefreshRepository;
  readonly target: Target;
  readonly threads: readonly NativeThreadRefreshEntry[];
  readonly nowIso: string;
}): number {
  for (const thread of input.threads) {
    input.repository.upsert({
      target: input.target,
      contextKind: "native_thread",
      projectLabel: projectDisplayNameFromCwd(thread.cwd),
      cwd: thread.cwd,
      codexThreadId: thread.threadId,
      title: thread.title,
      now: input.nowIso,
    });
  }
  return input.threads.length;
}
