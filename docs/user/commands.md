# IM Commands

Plain text enters the current bound Codex thread or starts a Codex turn in the
selected project. Slash commands control project, thread, status, approval, and
bounded Computer Use behavior.

## First Commands

```text
/use codex-im
Reply exactly: OK
```

If the project is configured and your IM user/chat is allowlisted, Codex should
reply through the same IM conversation.

## Project And Thread Control

| Command | Use |
|---|---|
| `/projects` | List configured Codex projects. |
| `/use <project>` | Select a project for the current IM target. |
| `/new` | Start a new thread. |
| `/threads` | List known threads. |
| `/switch <n>` | Switch to a listed thread. |
| `/alias <name>` | Give the current thread a local alias. |
| `/fork` | Fork the current thread when supported by Codex App Server. |
| `/stop` | Interrupt the active turn. |

## Status And Diagnostics

| Command | Use |
|---|---|
| `/status` | Redacted daemon, binding, and pending-approval status. |
| `/whoami` | Show the IM identity and allowlist target seen by Codex-IM. |
| `/model` | Show or control the Codex model surface when available. |
| `/compact` | Ask Codex to compact the current thread context. |
| `/usage` | Show usage/status information when available. |
| `/diagnostics` | Show redacted local diagnostics. |

## Codex Capabilities

| Command | Use |
|---|---|
| `/tools` | List available tool surfaces. |
| `/skills` | List available Codex skills. |
| `/plugins` | List available plugins. |
| `/apps` | List available apps/connectors. |
| `/mcp` | Show MCP server status. |
| `/mcp login <server>` | Start MCP login when Codex App Server supports it. |
| `/mcp reload` | Reload MCP server configuration. |

Outputs are summaries. Raw tool arguments, secrets, cookies, tokens, and private
payloads are redacted or suppressed.

## Approvals

Approval cards/buttons are the primary approval path.

Use a button such as `Allow once`, `Allow session`, or `Decline` when the IM
platform supports it.

Fallback command:

```text
/approve <id> <action>
```

Use `/approve` only for an already-visible pending approval. It is not a raw
callback-token interface and cannot approve arbitrary work.

## Files And Images

Supported IM platforms can send and receive files or images.

- Outbound Codex artifacts may appear as IM files or images.
- Inbound images are passed to Codex as local image input where the App Server
  supports it.
- Inbound generic files are represented as explicit local file context because
  current Codex App Server input has no generic `UserInput.file` shape.
- Oversized attachments fail closed before a Codex turn starts.

## Computer Use

Computer Use is explicit.

```text
/cu status
/cu inspect the local browser page
```

Current accepted scope:

- macOS only;
- Google Chrome only;
- bounded local file or localhost page behavior;
- policy, audit, active-session, and allowed-tool gates;
- screenshots/artifacts can be summarized or attached when present.

Not supported as a launch claim:

- arbitrary desktop automation;
- entering secrets, tokens, passwords, payment, or recovery codes;
- controlling external websites without a reviewed gate;
- triggering Computer Use from a normal prompt without `/cu`.
