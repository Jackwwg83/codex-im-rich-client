# `codex app-server generate-ts` — stable vs `--experimental` diff

**Date**: 2026-04-29
**Codex CLI**: 0.125.0
**Both modes succeed**: exit 0.

## Headline numbers

|              | stable | experimental | delta |
|--------------|-------:|-------------:|------:|
| files (top + v2) | 488 | 517 | **+29** |
| total bytes      | 267 KB | 283 KB | **+6 %** |
| `ClientRequest.ts` | 11.4 KB | 14.1 KB | **+24 %** |
| `index.ts`         | 4.9 KB  | 5.5 KB  | **+12 %** |

## What the experimental flag actually adds

Six top-level files (all FuzzyFileSearch session lifecycle):

```
FuzzyFileSearchSessionStartParams.ts
FuzzyFileSearchSessionStartResponse.ts
FuzzyFileSearchSessionStopParams.ts
FuzzyFileSearchSessionStopResponse.ts
FuzzyFileSearchSessionUpdateParams.ts
FuzzyFileSearchSessionUpdateResponse.ts
```

23 v2/ files (grouped by feature area):

| Feature area | Files added | Phase relevance |
|--------------|-------------|-----------------|
| Realtime conversation (voice) | `ThreadRealtime{Start,Stop,AppendAudio,AppendText,ListVoices}{Params,Response}.ts` | Out of scope through Phase 6 |
| Memory mode | `ThreadMemoryModeSet{Params,Response}.ts`, `MemoryResetResponse.ts` | Out of scope (Phase 1+ may reconsider for context compaction) |
| Elicitation counters | `Thread{Increment,Decrement}Elicitation{Params,Response}.ts` | Out of scope |
| Background terminals | `ThreadBackgroundTerminalsClean{Params,Response}.ts` | Out of scope through Phase 5 |
| Collaboration mode | `CollaborationModeList{Params,Response}.ts` | Out of scope |
| Mock for testing | `MockExperimentalMethod{Params,Response}.ts` | Test infrastructure for Codex itself, not for us |

`ClientRequest.ts` adds the corresponding union arms:
```
thread/realtime/{start,stop,appendAudio,appendText,listVoices}
thread/memoryMode/set
memory/reset
thread/increment_elicitation
thread/decrement_elicitation
thread/backgroundTerminals/clean
collaborationMode/list
mock/experimentalMethod
fuzzyFileSearch/session{Start,Stop,Update}
```

## What is in BOTH stable and experimental (no delta)

This is what we actually need for Phase 0–6:

| Need | Symbol(s) | Notes |
|------|-----------|-------|
| Initialize | `InitializeParams`, `InitializeResponse`, `InitializeCapabilities`, `ClientInfo` | base handshake |
| Thread lifecycle | `thread/{start,resume,fork,archive,unsubscribe,setName,metadataUpdate,unarchive,compact/start,shellCommand,rollback,list,read,turns/list,inject_items}` | all in `ClientRequest` union |
| Turn lifecycle | `turn/{start,steer,interrupt}` | core to Phase 1 CodexRuntime |
| Review | `review/start` | Phase 1 |
| Approvals (server-initiated, real method names) | `ServerRequest`: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `applyPatchApproval`, `execCommandApproval` | These are the **real** approval names. 05-PROTOCOL.md's old assumptions are stale. |
| Guardian deny resolution | `thread/approveGuardianDeniedAction` | Codex outside-voice spotted this; it's in stable |
| Commands | `command/exec`, `command/exec/{write,terminate,resize}` | turn-time shell |
| FS access | `fs/{readFile,writeFile,createDirectory,getMetadata,readDirectory,remove,copy,watch,unwatch}` | available in stable too |
| MCP servers | `mcpServer/{oauth/login,resource/read,tool/call}`, `mcpServerStatus/list`, `config/mcpServer/reload` | Phase 1+ |
| Auth | `account/{login/start,login/cancel,logout,read,rateLimits/read,sendAddCreditsNudgeEmail}`, `getAuthStatus` | needed for `/cu` and real-turn smoke |
| Tooling | `Tool.ts` (generic `{name,title,description,inputSchema,outputSchema,...}`) — **Computer Use is a runtime tool instance, not a type-level distinction** | Phase 6 |
| Shell tool details | `LocalShellAction`, `LocalShellExecAction`, `LocalShellStatus`, `ParsedCommand` | Phase 1 EventNormalizer |
| File-change tool | `FileChange`, `ApplyPatchApprovalParams`, `ApplyPatchApprovalResponse`, `ExecCommandApprovalParams`, `ExecCommandApprovalResponse` | Phase 1 |
| Server notifications | `ServerNotification.ts` (10.7 KB — full notification union) | Phase 1 EventNormalizer |
| Response items | `ResponseItem.ts` (2 KB — content union including reasoning, function calls, web search) | Phase 1 |

## Decision: use **STABLE** (no `--experimental`) for Phase 0–6

**This reverses the preliminary stance in `docs/internal/superpowers/plans/2026-04-29-phase-0-bootstrap.md` Task 0.2 / Task 2.2.** The reversal is grounded in the empirical diff above, not in speculation about "what experimental might contain."

### Why stable is sufficient

1. Every Codex App Server feature on the Phase 0–6 roadmap has its protocol surface in stable (initialize, thread/turn lifecycle, command exec, file change, approvals, server-initiated requests, MCP, auth, tools).
2. Computer Use is exposed as a generic `Tool` instance, discovered at runtime, not as a type-level union member. `--experimental` does NOT add a "ComputerUse" type. Phase 6 will discover the `Tool.name == "computer-use"` (or however codex names it) at runtime and apply policy.
3. Real approval method names (`item/commandExecution/requestApproval`, etc.) are in stable. 05-PROTOCOL.md needs to be updated in Phase 1 to reflect these.

### What we lose by skipping --experimental

- **Realtime voice** (`thread/realtime/*`): Out of Phase 0–6 scope. If we ever add voice, regenerate with `--experimental` and expand the facade.
- **Fuzzy file search session lifecycle**: One-shot `fuzzyFileSearch` is in stable (a single request, no session). The session-based variant (start/update/stop) is experimental-only. We can use the one-shot in Phase 0–6.
- **Memory mode set / memory reset**: We can rely on default mode for now; revisit if context window pressure becomes a Phase 1+ issue.
- **Elicitation counters / background terminals / collaboration mode**: Niche features, not on roadmap.

### What we gain by skipping --experimental

- ~6 % smaller generated surface = smaller code-review burden when codex upgrades.
- Less risk of accidentally writing code against an experimental method that gets renamed/removed.
- Lower churn from codex-version to codex-version (experimental fields move more).
- Forces explicit opt-in if/when we need a P7+ feature: regenerate with `--experimental`, update facade.

### Switching to --experimental later

When Phase 7+ asks for voice / memory mode / fuzzy session:

1. Update `package.json#codexIm.codexVersion` and root `CODEX_VERSION` if also bumping codex.
2. Edit `protocol:generate` script to add `--experimental` to both `generate-ts` and `generate-json-schema`.
3. `pnpm protocol:generate`.
4. Review the diff (the same diff this document captures, but at the new codex version).
5. Update `packages/codex-protocol/src/index.ts` facade to add the new types we now consume.
6. Update `packages/testkit/fixtures/codex-X.Y.Z/` with new wire fixtures if behavior changed.

### Caveat — moving target

`codex app-server` is marked `[experimental]` at the top level. Even stable surface may rename / drop methods on codex upgrade. Mitigation:
- `pnpm check:codex-version` (Task 1.5) gates startup on version match.
- `packages/testkit/fixtures/codex-0.125.0/` (Section E + I) replays raw wire frames in contract tests.
- `pnpm protocol:check` (Task 2.2) catches any uncommitted regeneration drift in CI.
