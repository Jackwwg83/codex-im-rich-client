# IM Project And Conversation Entry Design

Generated: 2026-05-09

Status: approved with changes by GPT Pro; revised for implementation.

## Goal

Align the IM entry model with Codex App's user-facing project and
conversation model without inventing new Codex App Server protocol concepts.

The bridge must let users work from IM the way they work in Codex App:

- send a message and get a Codex conversation;
- list projects;
- enter a project context;
- list existing conversations;
- switch to an existing conversation;
- create a new conversation inside a project;
- create a new default conversation without choosing a project.

The bridge must not let IM become a remote local-filesystem path entry point.
IM users cannot create projects, cannot create directories, and cannot provide
raw cwd values.

## App Server Facts

The design is based on current generated protocol types and the public Codex
App Server documentation:

- `thread/start` accepts an optional `cwd`.
- `thread/start` can be called without `cwd`.
- `ThreadStartResponse` returns the effective `cwd`.
- `Thread` has a required `cwd` field.
- `thread/list` can filter by one or more `cwd` values.
- There is no generated App Server `Project`, `Workspace`, `projectId`, or
  `workspaceId` protocol object.

Reference:

- `packages/codex-protocol/src/generated/v2/ThreadStartParams.ts`
- `packages/codex-protocol/src/generated/v2/ThreadStartResponse.ts`
- `packages/codex-protocol/src/generated/v2/Thread.ts`
- `packages/codex-protocol/src/generated/v2/ThreadListParams.ts`
- https://developers.openai.com/codex/app-server

## Terminology

### User-facing terms

`Project`

: A Codex App-style entry in the IM UI. It is a label for a known Codex
  execution context derived from App Server thread history and optionally
  decorated by local bridge config. It is not an App Server protocol object.

`Conversation`

: A Codex App Server thread. This is the first-class object in IM.

`Default conversation`

: A conversation created with `thread/start({})`, letting App Server choose its
  native default execution context.

### Implementation terms

`cwd`

: The App Server execution context. New conversations may pass it explicitly
  when the user selected a project; default conversations omit it and use the
  server's default.

`threadId`

: The App Server thread identifier used by `/switch`, `turn/start`, and
  subsequent turns.

`configured project entry`

: A bridge-local config entry under the existing `projects.<name>` key. It can
  provide a stable label, access policy, writable roots, and default model for a
  cwd. It does not create a Codex App project.

`Codex-known project`

: A project-like group discovered by calling App Server `thread/list` and
  grouping returned threads by their `cwd`.

## Product Rules

1. Conversation is the primary IM object.
2. Project is an optional context selector.
3. IM does not create projects.
4. IM does not accept raw cwd or path input.
5. IM can create conversations.
6. If a project is selected, new conversations use that project's `cwd`.
7. If no project is selected, new conversations use App Server native default
   behavior by omitting `cwd`.
8. Existing conversations are resumed by `threadId`, not by project.
9. A Codex-known project can be shown in `/projects` only if it comes from App
   Server thread history or bridge config.
10. A configured project entry is explicit local policy. If the current IM
    user/chat is allowed by that entry, show it even if App Server has never
    seen a thread for that cwd.

## Command Semantics

### Plain text

If the IM target already has a current conversation, plain text starts or
continues a turn in that conversation.

If the IM target has no current conversation but has a selected project, plain
text creates a new conversation in that project:

```ts
thread/start({ cwd: selectedProject.cwd })
turn/start({ threadId, input })
```

If the IM target has no current conversation and no selected project, plain text
creates a default conversation:

```ts
thread/start({})
turn/start({ threadId, input })
```

The bridge stores the returned `threadId` and returned effective `cwd`.

### `/new [project] [task]`

`/new <task>` with a selected project:

```ts
thread/start({ cwd: selectedProject.cwd })
turn/start({ threadId, input })
```

`/new <task>` without a selected project:

```ts
thread/start({})
turn/start({ threadId, input })
```

`/new <task>` after `/switch` to an existing conversation uses the current
conversation cwd as transient context:

```ts
thread/start({ cwd: currentConversation.cwd })
turn/start({ threadId, input })
```

That cwd is not promoted to a reusable project alias.

`/new 1 <task>`:

```ts
resolve project selector 1
thread/start({ cwd: project.cwd })
turn/start({ threadId, input })
```

`/new /Users/me/repo <task>`:

```text
reject
```

The rejection must not echo the full path.

### `/projects`

Lists project-like contexts without showing local paths.

Sources, in order:

1. Configured project entries allowed for the current IM target.
2. App Server `thread/list` grouped by `cwd`.
3. Matching configured entries merged onto discovered cwd groups.

Visibility and selectability are distinct:

- configured project: visible and selectable when its allow policy passes;
- discovered cwd with matching configured project: visible and selectable when
  that configured project allow policy passes;
- discovered cwd without configured project: visible only under explicit native
  discovery policy, resumable by `/switch`, and not selectable for `/use` or
  `/new 1` by default.

Suggested output:

```text
Projects:
* 1. codex-im-rich-client
  current
  conversations: 8
  use: /use 1
  new: /new 1 <task>

  2. SASMO
  conversations: 3
  use: /use 2
  new: /new 2 <task>
```

Do not show:

```text
cwd: /Users/alice/private/repo
source: config
```

`/cwds` remains a technical alias. It should not be promoted in the first
screen help. It may produce the same safe output as `/projects`, or a
maintainer-only diagnostic output if explicitly documented.

### `/use <selector>`

Selects a project from `/projects`.

Allowed:

```text
/use 1
/use codex-im-rich-client
```

Forbidden:

```text
/use /Users/me/repo
/use ~/repo
/use ../repo
```

The selected project becomes the default `cwd` for later `/new <task>` and
plain-text default conversation creation if there is no current thread.

### `/threads [project]`

Lists App Server native conversations.

Without a project selector, list recent conversations visible to the IM target.
With a project selector, call `thread/list` using that project's `cwd`.

The list should show conversation titles and short IDs. It should not show
absolute cwd. If a conversation's cwd maps to a configured or discovered
project label, show that label. If it does not, show a non-selectable label
such as `project: Codex default` or `project: from Codex`.

### `/switch <selector>`

Resumes an existing conversation by `threadId`.

```ts
thread/resume({ threadId })
```

Switching to a conversation does not require the cwd to be a configured
project. The current IM target becomes bound to that thread and its returned or
listed cwd.

Switching to an unconfigured conversation must not add a reusable project alias.

### `/status`

Shows current binding:

```text
Status:
binding: bound
project: codex-im-rich-client
conversation: thread-abcde...
pending approvals: 0
```

For App Server default or unconfigured context:

```text
project: Codex default
```

Do not show cwd in normal status.

### `/whoami`

Shows redacted IM identity and current project/conversation binding. It must not
show cwd.

### `/diagnostics`

May show redacted or tilde-shortened cwd for operator debugging:

```text
cwd: ~/projects/codex-im-rich-client
```

This is a technical surface, not first-use product output.

## Project Discovery Model

The bridge needs a resolver that separates user labels from protocol
primitives.

Proposed internal shape:

```ts
type ImProjectSource = "codex_thread_history" | "configured" | "merged";

interface ImProjectEntry {
  key: string;
  label: string;
  cwd: string;
  source: ImProjectSource;
  configuredProjectId?: string;
  conversationCount: number;
  lastUsedAt?: string;
  defaultModel?: string;
  allowedForTarget: boolean;
  selectableForUse: boolean;
  selectableForNew: boolean;
}
```

Important distinctions:

- `label` is shown to the user.
- `cwd` is passed to App Server only when explicitly selected.
- `configuredProjectId` is local bridge state.
- `key` must be stable inside the current list but must not be treated as an
  App Server object ID.
- `selectableForUse` and `selectableForNew` must be false for unconfigured
  discovered cwd groups unless explicit policy allows them.

Suggested label derivation:

1. Configured project id when a config entry matches cwd.
2. Existing thread name group if App Server ever exposes a stable project label
   in the future.
3. Safe basename of cwd, with conflict suffixes such as `repo (2)`.
4. `Codex default` for no explicit selected project in status output.

Do not expose full cwd in normal IM output.

## Storage Model

Current storage has a mismatch:

- `thread_bindings.project_id` is `NOT NULL`.
- `thread_sessions.project_id` is `NOT NULL`.

That shape forces no-project or App Server default conversations to be stored
as fake projects. The next implementation should remove that pressure.

Preferred migration:

1. Add context columns:

```sql
context_kind TEXT NOT NULL DEFAULT 'configured_project'
  CHECK(context_kind IN (
    'configured_project',
    'codex_project',
    'app_default',
    'native_thread'
  )),
project_id TEXT,
project_label TEXT,
cwd TEXT
```

2. Rebuild `thread_bindings` so `project_id` is nullable.
3. Rebuild `thread_sessions` so `project_id` is nullable.
4. Existing rows migrate to:

```text
context_kind = configured_project
project_id = previous project_id
project_label = previous project_id
cwd = null
```

Existing rows may lack a stored cwd because older schema versions did not keep
one in `thread_sessions`. New default and native conversation writes must store
the returned/listed cwd, and fallback `/switch` must fail closed for historical
rows that still lack it.

5. New default conversations store:

```text
context_kind = app_default
project_id = null
project_label = Codex default
cwd = returned cwd from ThreadStartResponse
```

6. Switched native conversations without configured project store:

```text
context_kind = native_thread
project_id = null
project_label = derived safe label
cwd = thread.cwd
```

Compatibility option:

If the migration becomes too large for one patch, a temporary reserved
`project_id` such as `__app_default__` is possible, but it is explicitly
inferior. It should not be the final design because it fabricates a project.

## Runtime Flow

### Default conversation from plain text

```text
Inbound text
  -> no current thread
  -> runtime.threadStart({})
  -> persist returned threadId + returned cwd
  -> runtime.turnStart({ threadId, input })
  -> bind active turn
```

### New conversation inside selected project

```text
/use 1
  -> selected project cwd stored in binding

/new fix tests
  -> runtime.threadStart({ cwd })
  -> persist returned threadId + returned cwd
  -> runtime.turnStart({ threadId, input })
```

### New default conversation

```text
/new fix tests
  -> no selected project
  -> runtime.threadStart({})
  -> persist returned threadId + returned cwd as app_default context
  -> runtime.turnStart({ threadId, input })
```

### Existing conversation takeover

```text
/threads
  -> runtime.threadList(...)
  -> show selectors

/switch 1
  -> runtime.threadResume({ threadId })
  -> persist target -> threadId + cwd
```

## Security Rules

1. IM must never accept raw local paths.
2. IM must never create directories.
3. IM must never create projects.
4. IM must not expose absolute cwd in normal output.
5. App Server default cwd is acceptable only when chosen by App Server through
   `thread/start({})`, not when guessed by the daemon.
6. A discovered cwd from `thread/list` may be listed as a project-like group but
   must still pass IM target/user allow policy before `/use` or `/new 1`.
7. An unconfigured native thread can be resumed by `threadId`; this does not
   grant reusable project access for new threads.
8. Existing approval, callback-token, messageRef, SecurityPolicy, and
   Computer Use boundaries remain unchanged.

## Implementation Slices

### Slice 1 - Storage context migration

- Add nullable `project_id`, `context_kind`, and `project_label` to
  `thread_bindings` and `thread_sessions` through a SQLite table rebuild
  migration.
- Update repositories and types.
- Preserve existing rows as `configured_project`.
- Add rollback/failure tests for sync write-through behavior.

### Slice 2 - Default conversation creation

- Add tests proving `/new <task>` with no selected project calls
  `threadStart({})`.
- Add tests proving ordinary text with no current thread and no selected project
  creates a default conversation instead of requiring `/projects`.
- Add tests proving ordinary text with selected project and no thread calls
  `threadStart({ cwd: selectedProject.cwd })`.
- Capture returned `cwd` from `ThreadStartResponse`.
- Persist default context as `app_default`.

### Slice 3 - Project discovery

- Add a project resolver that merges App Server `thread/list` cwd groups with
  bridge config entries.
- `/projects` uses the resolver.
- Raw cwd remains rejected.
- Output hides paths.

### Slice 4 - Thread takeover parity

- Ensure `/threads` lists native App Server threads even if they were never
  created from IM.
- `/switch` resumes by `threadId`.
- Unconfigured conversations remain resumable but do not become configured
  projects.

### Slice 5 - Docs and acceptance

- Update user docs to present project/conversation language.
- Update admin docs to explain `cwd` and App Server primitives.
- Update handoff docs with the revised semantics.
- Run targeted tests, full gates, and existing IM smoke paths.

## Test Checklist

- `/new <task>` with no selected project calls `threadStart({})`.
- Plain text with no current thread calls `threadStart({})` then `turnStart`.
- The returned effective cwd is persisted.
- `/new 1 <task>` calls `threadStart({ cwd })`.
- `/use 1` selects an allowed project.
- `/use /Users/me/repo` rejects without echoing the path.
- `/new /Users/me/repo task` rejects without echoing the path.
- `/projects` lists App Server-discovered cwd groups without full paths.
- `/projects` merges matching configured project labels.
- `/projects` hides unallowed projects.
- `/threads` calls `thread/list`.
- `/threads 1` filters by selected project cwd.
- `/switch 1` calls `thread/resume({ threadId })`.
- `/switch` to an unconfigured native thread binds the conversation but does not
  add a configured project.
- `/status` hides cwd and shows project/conversation state.
- `/whoami` hides cwd.
- `/diagnostics` may show redacted cwd.
- Existing approval and Computer Use tests stay green.

## Documentation Checklist

- User quickstart should start with plain prompt or `/new <task>`, not require
  `/projects`.
- `/projects` should be documented as a project chooser, not a project creator.
- `/new` should be documented as conversation creation.
- Docs must state: Codex-IM project is a UI label for known App Server cwd
  groups and local policy; it is not an App Server project object.
- Maintainer docs can mention `cwd`, `threadId`, and SQLite context columns.
- Customer-facing docs must avoid raw local path examples as normal workflow.

## GPT Pro Review Outcome

Verdict: `APPROVE_WITH_CHANGES`.

Applied review decisions:

1. Discovered Codex projects are not selectable for `/use` by default. They are
   resumable through `/switch` only unless they match an allowed configured
   project or explicit native discovery policy.
2. `/new <task>` after `/switch` uses the current conversation cwd as transient
   context, but this cwd is not promoted to a reusable project alias.
3. The storage migration to nullable `project_id` and `context_kind` should land
   with the default-conversation behavior. Do not ship a stable fake
   `__app_default__` project model.
4. Normal output should say `project: Codex default` for App Server default
   context.
5. `/cwds` should be a safe alias for `/projects` with a note that `/projects`
   is preferred. Raw cwd remains diagnostics-only.
6. `turn/start` should not routinely pass `cwd` after `thread/start({ cwd })`.
   The thread establishes cwd; turns continue inside that thread.

## Recommended Decision

Implement this design in small slices, starting with Slice 1 and Slice 2. Do
not merge the current draft patch as-is because it still treats project
selection as required for `/new` in some paths. The corrected direction is:

```text
conversation first;
project optional;
no IM project creation;
no raw cwd input;
App Server decides default cwd when cwd is omitted.
```
