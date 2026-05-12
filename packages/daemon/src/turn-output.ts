// Slice 2 Cut 1 — Turn output projection extracted from daemon.ts.
//
// TurnOutputManager owns the per-(thread, turn) output buffer, IM-side
// projection (placeholder, edit, terminal flush, file attachments), and the
// progress-edit throttle. Public surface is intentionally small: 5 methods
// + 1 discriminated signal type. The Daemon class is responsible for
// driving open/handle/interrupt and acting on the `turn_terminal` signal
// (which is where #clearTerminalActiveTurn lives — that helper reads
// #sessionRouter, which the manager intentionally does not see).
//
// All formatting / parsing helpers come from packages/daemon/src/format.ts.
// The manager is independent of: SessionRouter, SecurityPolicy,
// ApprovalBroker, callback tokens, and the IM platform identity. Adapter
// methods are the only side effects.

import type { CodexRichEvent } from "@codex-im/codex-runtime";
import type { Target } from "@codex-im/core";
import type {
  DaemonMessageRef,
  DaemonOutboundFile,
  DaemonTurnOutputFile,
  DaemonTurnOutputState,
} from "./daemon.js";
import {
  type ImOutputLanguage,
  appendImText,
  codexTurnCompletedMessage,
  codexTurnFailedMessage,
  codexTurnInterruptedMessage,
  codexWorkingMessage,
  errorMessage,
  extractCodexItemFiles,
  isAppendOnlyTextRef,
  isGlobalRuntimeStatusMethod,
  outputItemSummaries,
  outputStatusSummaries,
  readRecord,
  readStringField,
  redactLocalPathsForNormalIm,
  splitImText,
  summarizeCodexItem,
  summarizeCodexRuntimeNotice,
  summarizeCodexStatusEvent,
  truncateImText,
  turnOutputBodyWithSections,
  turnOutputFileKey,
  turnOutputKey,
} from "./format.js";

/** Audit hook. Called fire-and-forget; must not throw. */
export type TurnOutputAuditEmitter = (event: string, detail: object) => void;

/** Read an artifact from disk. Used when item-completed files reference a path. */
export type TurnOutputReadFile = (path: string) => Promise<Uint8Array>;

/** Monotonic millisecond clock. Injected so the progress-edit throttle is testable. */
export type TurnOutputClock = () => number;

/**
 * The IM-side surface the manager touches. Every method is optional because
 * not every channel adapter supports every operation (e.g. some adapters
 * cannot edit messages, some cannot send files).
 */
export interface TurnOutputAdapter {
  sendText?(target: Target, body: string): Promise<DaemonMessageRef> | DaemonMessageRef;
  editText?(ref: DaemonMessageRef, body: string): Promise<void> | void;
  sendFile?(target: Target, file: DaemonOutboundFile): Promise<DaemonMessageRef> | DaemonMessageRef;
}

/**
 * Discriminated signal returned by `handle(event)` so that the Daemon caller
 * can perform the boundary-straddling cleanup (`#clearTerminalActiveTurn`,
 * which reads `#sessionRouter`) without the manager itself reaching back
 * into Daemon-internal state.
 *
 * `progress` covers all non-terminal events the cluster processes (delta
 * append, status summary append, item summary append). Callers do not need
 * to act on `progress`; it exists so callers can match on
 * `signal === undefined` to mean "event ignored / no state".
 */
export type TurnOutputHandleSignal =
  | {
      readonly kind: "turn_terminal";
      readonly target: Target;
      readonly threadId: string;
      readonly turnId: string;
    }
  | { readonly kind: "progress" };

/** Minimal contract for a runtime that the manager pumps events from. */
export interface TurnOutputRuntime {
  readonly events?: {
    events(): AsyncIterableIterator<CodexRichEvent>;
  };
}

const MAX_IM_ITEM_SUMMARIES = 6;
const MAX_IM_STATUS_SUMMARIES = 12;
const MAX_IM_ARTIFACT_FILES = 3;
const MAX_IM_ARTIFACT_FILE_BYTES = 10 * 1024 * 1024;
const PROGRESS_EDIT_INTERVAL_MS = 1_500;
const PROGRESS_SIGNAL: TurnOutputHandleSignal = { kind: "progress" };

export interface TurnOutputOpenOptions {
  readonly suppressAuxiliarySummaries?: boolean;
  readonly redactLocalPaths?: boolean;
  readonly suppressCommandLogFiles?: boolean;
  readonly language?: ImOutputLanguage;
}

export class TurnOutputManager {
  readonly #adapter: TurnOutputAdapter;
  readonly #audit: TurnOutputAuditEmitter;
  readonly #readFile: TurnOutputReadFile;
  readonly #clock: TurnOutputClock;
  readonly #outputs = new Map<string, DaemonTurnOutputState>();
  readonly #pumpedRuntimes = new WeakSet<object>();

  constructor(
    adapter: TurnOutputAdapter,
    audit: TurnOutputAuditEmitter,
    readFile: TurnOutputReadFile,
    clock: TurnOutputClock,
  ) {
    this.#adapter = adapter;
    this.#audit = audit;
    this.#readFile = readFile;
    this.#clock = clock;
  }

  async open(
    target: Target,
    threadId: string,
    turnId: string,
    options: boolean | TurnOutputOpenOptions = false,
  ): Promise<void> {
    const normalizedOptions =
      typeof options === "boolean" ? { suppressAuxiliarySummaries: options } : options;
    const suppressAuxiliarySummaries = normalizedOptions.suppressAuxiliarySummaries === true;
    const state: DaemonTurnOutputState = {
      target,
      threadId,
      turnId,
      suppressAuxiliarySummaries,
      redactLocalPaths: normalizedOptions.redactLocalPaths ?? suppressAuxiliarySummaries,
      suppressCommandLogFiles:
        normalizedOptions.suppressCommandLogFiles ?? suppressAuxiliarySummaries,
      language: normalizedOptions.language ?? "en",
      statusSummaries: [],
      itemSummaries: [],
      files: [],
      text: "",
    };
    this.#outputs.set(turnOutputKey(threadId, turnId), state);
    if (this.#adapter.sendText === undefined) {
      return;
    }
    try {
      state.messageRef = await this.#adapter.sendText(target, codexWorkingMessage(state.language));
    } catch (error) {
      this.#audit("runtime.turn_output_send_failed", {
        target,
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
    }
  }

  async handle(event: CodexRichEvent): Promise<TurnOutputHandleSignal | undefined> {
    if (event.type === "agent_message_delta") {
      const state = this.#outputs.get(turnOutputKey(event.threadId, event.turnId));
      if (state === undefined) {
        return undefined;
      }
      state.text = appendImText(state.text, event.deltaText);
      await this.#maybeEditTurnProgress(state);
      return PROGRESS_SIGNAL;
    }

    if (event.type === "item_completed") {
      const state = this.#outputs.get(turnOutputKey(event.threadId, event.turnId));
      if (state === undefined) {
        return undefined;
      }
      const summary = summarizeCodexItem(event.raw);
      if (
        summary !== undefined &&
        state.itemSummaries.length < MAX_IM_ITEM_SUMMARIES &&
        !state.itemSummaries.includes(summary)
      ) {
        state.itemSummaries.push(summary);
      }
      for (const file of extractCodexItemFiles(event.raw)) {
        if (state.files.length >= MAX_IM_ARTIFACT_FILES) {
          break;
        }
        if (
          !state.files.some((candidate) => turnOutputFileKey(candidate) === turnOutputFileKey(file))
        ) {
          state.files.push(file);
        }
      }
      return PROGRESS_SIGNAL;
    }

    if (event.type === "unknown") {
      const state = this.#stateForStatusEvent(event);
      if (state === undefined) {
        return undefined;
      }
      const summary = summarizeCodexStatusEvent(event);
      await this.#appendStatusSummary(state, summary);
      return PROGRESS_SIGNAL;
    }

    if (event.type === "warning" || event.type === "error") {
      const state = this.#stateForRuntimeNotice(event.raw);
      if (state === undefined) {
        return undefined;
      }
      const summary = summarizeCodexRuntimeNotice(event);
      await this.#appendStatusSummary(state, summary);
      return PROGRESS_SIGNAL;
    }

    if (
      event.type !== "turn_completed" &&
      event.type !== "turn_failed" &&
      event.type !== "turn_interrupted"
    ) {
      return undefined;
    }

    const key = turnOutputKey(event.threadId, event.turnId);
    const state = this.#outputs.get(key);
    if (state === undefined) {
      return undefined;
    }
    this.#outputs.delete(key);
    await this.#publishTerminalTurnOutput(
      state,
      this.#terminalTurnOutputBody(
        event,
        state,
        outputStatusSummaries(state),
        outputItemSummaries(state),
      ),
    );
    await this.#publishTerminalTurnFiles(state);
    return {
      kind: "turn_terminal",
      target: state.target,
      threadId: event.threadId,
      turnId: event.turnId,
    };
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    const key = turnOutputKey(threadId, turnId);
    const state = this.#outputs.get(key);
    if (state === undefined) {
      return;
    }
    this.#outputs.delete(key);
    await this.#publishTerminalTurnOutput(
      state,
      this.#terminalTurnOutputBody(
        { type: "turn_interrupted", threadId, turnId, raw: {}, terminal: true },
        state,
      ),
    );
  }

  clear(): void {
    this.#outputs.clear();
  }

  ensureEventPump(runtime: TurnOutputRuntime): void {
    const events = runtime.events?.events;
    if (events === undefined || typeof events !== "function" || typeof runtime !== "object") {
      return;
    }
    if (this.#pumpedRuntimes.has(runtime)) {
      return;
    }
    this.#pumpedRuntimes.add(runtime);
    void this.#consumeRuntimeEvents(events.call(runtime.events)).catch((error: unknown) => {
      this.#audit("runtime.event_pump_failed", {
        result: "failed",
        metadata: { error: errorMessage(error) },
      });
    });
  }

  async #consumeRuntimeEvents(events: AsyncIterable<CodexRichEvent>): Promise<void> {
    for await (const event of events) {
      await this.handle(event);
    }
  }

  #stateForStatusEvent(
    event: Extract<CodexRichEvent, { type: "unknown" }>,
  ): DaemonTurnOutputState | undefined {
    const params = readRecord(event.params);
    const threadId = readStringField(params, "threadId");
    const turnId = readStringField(params, "turnId");
    if (threadId !== undefined && turnId !== undefined) {
      return this.#outputs.get(turnOutputKey(threadId, turnId));
    }
    if (threadId !== undefined) {
      for (const state of this.#outputs.values()) {
        if (state.threadId === threadId) {
          return state;
        }
      }
      return undefined;
    }
    if (isGlobalRuntimeStatusMethod(event.method) && this.#outputs.size === 1) {
      return this.#outputs.values().next().value;
    }
    return undefined;
  }

  async #appendStatusSummary(
    state: DaemonTurnOutputState | undefined,
    summary: string | undefined,
  ): Promise<void> {
    if (
      state !== undefined &&
      summary !== undefined &&
      state.statusSummaries.length < MAX_IM_STATUS_SUMMARIES &&
      !state.statusSummaries.includes(summary)
    ) {
      state.statusSummaries.push(summary);
      await this.#maybeEditTurnProgress(state);
    }
  }

  #stateForRuntimeNotice(raw: unknown): DaemonTurnOutputState | undefined {
    const rawRecord = readRecord(raw);
    const params = readRecord(rawRecord?.params);
    const threadId = readStringField(params, "threadId") ?? readStringField(rawRecord, "threadId");
    const turnId = readStringField(params, "turnId") ?? readStringField(rawRecord, "turnId");
    if (threadId !== undefined && turnId !== undefined) {
      return this.#outputs.get(turnOutputKey(threadId, turnId));
    }
    if (threadId !== undefined) {
      for (const state of this.#outputs.values()) {
        if (state.threadId === threadId) {
          return state;
        }
      }
      return undefined;
    }
    if (this.#outputs.size === 1) {
      return this.#outputs.values().next().value;
    }
    return undefined;
  }

  async #editTurnOutput(state: DaemonTurnOutputState, body: string): Promise<boolean> {
    if (state.messageRef === undefined || this.#adapter.editText === undefined) {
      return false;
    }
    try {
      await this.#adapter.editText(state.messageRef, body);
      return true;
    } catch (error) {
      this.#audit("runtime.turn_output_edit_failed", {
        target: state.target,
        result: "failed",
        metadata: { error: errorMessage(error), turnId: state.turnId },
      });
      return false;
    }
  }

  async #publishTerminalTurnOutput(state: DaemonTurnOutputState, body: string): Promise<void> {
    const chunks = splitImText(body);
    const [firstChunk, ...continuationChunks] = chunks;
    if (firstChunk !== undefined) {
      const edited = isAppendOnlyTextRef(state.messageRef)
        ? false
        : await this.#editTurnOutput(state, firstChunk);
      if (!edited && !(await this.#sendTurnOutputChunk(state, firstChunk))) {
        return;
      }
    }
    if (continuationChunks.length === 0 || this.#adapter.sendText === undefined) {
      return;
    }
    for (const chunk of continuationChunks) {
      if (!(await this.#sendTurnOutputChunk(state, chunk))) {
        return;
      }
    }
  }

  async #sendTurnOutputChunk(state: DaemonTurnOutputState, body: string): Promise<boolean> {
    if (this.#adapter.sendText === undefined) {
      return false;
    }
    try {
      await this.#adapter.sendText(state.target, body);
      return true;
    } catch (error) {
      this.#audit("runtime.turn_output_send_failed", {
        target: state.target,
        result: "failed",
        metadata: { error: errorMessage(error), turnId: state.turnId },
      });
      return false;
    }
  }

  async #publishTerminalTurnFiles(state: DaemonTurnOutputState): Promise<void> {
    const files = state.suppressCommandLogFiles
      ? state.files.filter((file) => file.kind !== "command_log")
      : state.files;
    if (files.length === 0) {
      return;
    }
    if (this.#adapter.sendFile === undefined) {
      this.#audit("runtime.turn_output_file_skipped", {
        target: state.target,
        result: "skipped",
        metadata: { reason: "adapter_unsupported", turnId: state.turnId },
      });
      return;
    }
    for (const file of files) {
      await this.#sendTurnOutputFile(state, file);
    }
  }

  async #sendTurnOutputFile(
    state: DaemonTurnOutputState,
    file: DaemonTurnOutputFile,
  ): Promise<void> {
    try {
      const bytes =
        file.bytes ?? (file.path === undefined ? undefined : await this.#readFile(file.path));
      if (bytes === undefined) {
        this.#audit("runtime.turn_output_file_skipped", {
          target: state.target,
          result: "skipped",
          metadata: {
            reason: "missing_file_source",
            filename: file.filename,
            turnId: state.turnId,
          },
        });
        return;
      }
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IM_ARTIFACT_FILE_BYTES) {
        this.#audit("runtime.turn_output_file_skipped", {
          target: state.target,
          result: "skipped",
          metadata: {
            reason: bytes.byteLength === 0 ? "empty_file" : "file_too_large",
            filename: file.filename,
            turnId: state.turnId,
          },
        });
        return;
      }
      await this.#adapter.sendFile?.(state.target, {
        filename: file.filename,
        bytes,
        contentType: file.contentType,
      });
    } catch (error) {
      this.#audit("runtime.turn_output_file_send_failed", {
        target: state.target,
        result: "failed",
        metadata: { error: errorMessage(error), filename: file.filename, turnId: state.turnId },
      });
    }
  }

  async #maybeEditTurnProgress(state: DaemonTurnOutputState): Promise<void> {
    const statusSummaries = outputStatusSummaries(state);
    const itemSummaries = outputItemSummaries(state);
    if (state.text.length === 0 && statusSummaries.length === 0 && itemSummaries.length === 0) {
      return;
    }
    if (isAppendOnlyTextRef(state.messageRef)) {
      return;
    }
    const nowMs = this.#clock();
    if (
      state.lastProgressEditAtMs !== undefined &&
      nowMs - state.lastProgressEditAtMs < PROGRESS_EDIT_INTERVAL_MS
    ) {
      return;
    }
    state.lastProgressEditAtMs = nowMs;
    await this.#editTurnOutput(state, this.#inProgressTurnOutputBody(state));
  }

  #inProgressTurnOutputBody(state: DaemonTurnOutputState): string {
    const statusSummaries = outputStatusSummaries(state);
    const itemSummaries = outputItemSummaries(state);
    const visibleText = this.#visibleText(state, state.text);
    if (statusSummaries.length === 0 && itemSummaries.length === 0) {
      return visibleText.length === 0
        ? codexWorkingMessage(state.language)
        : truncateImText(visibleText);
    }
    return truncateImText(turnOutputBodyWithSections(visibleText, statusSummaries, itemSummaries));
  }

  #terminalTurnOutputBody(
    event: CodexRichEvent,
    state: DaemonTurnOutputState,
    statusSummaries: readonly string[] = [],
    itemSummaries: readonly string[] = [],
  ): string {
    const text = this.#visibleText(state, state.text);
    let body: string;
    if (event.type === "turn_completed") {
      body = text.length === 0 ? codexTurnCompletedMessage(state.language) : text;
    } else if (event.type === "turn_interrupted") {
      body =
        text.length === 0
          ? codexTurnInterruptedMessage(state.language)
          : `${text}\n\n[turn interrupted]`;
    } else {
      body =
        text.length === 0 ? codexTurnFailedMessage(state.language) : `${text}\n\n[turn failed]`;
    }
    if (statusSummaries.length === 0 && itemSummaries.length === 0) {
      return body;
    }
    return truncateImText(turnOutputBodyWithSections(body, statusSummaries, itemSummaries));
  }

  #visibleText(state: DaemonTurnOutputState, text: string): string {
    return state.redactLocalPaths ? redactLocalPathsForNormalIm(text) : text;
  }
}
