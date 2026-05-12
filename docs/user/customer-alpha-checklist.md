# Customer Alpha Checklist

A single-page walk from "I cloned the repo" to "I sent my first IM command".
Use this when you are testing Codex-IM as a customer in this early-access
alpha.

## Before You Install

- [ ] macOS (latest two majors). Linux/Windows are not customer targets.
- [ ] Node.js `>=24` available (`node --version`).
- [ ] pnpm `>=10 <11` available (`pnpm --version`).
- [ ] Codex CLI installed and logged in (`codex --version`). The generated
  protocol pin for maintainers lives in `CODEX_VERSION`; customer installs run
  a runtime compatibility check instead of requiring an exact version match.
- [ ] One IM bot / app already registered in the platform's own console
  (Telegram BotFather, Feishu/Lark developer console, DingTalk app, Slack
  app). The setup wizard does **not** create the bot for you.
- [ ] Token / secret values ready to paste **once** into the local wizard.
  Do not put them in `config.toml`, screenshots, or chat transcripts.
- [ ] A development directory chosen as the project `cwd`. **This is not
  `codex-im-rich-client` itself unless you really mean to make Codex
  operate on the bridge codebase.** Most customer tests should point at a
  separate repo such as `~/work/my-app`.

## Install

```bash
git clone https://github.com/Jackwwg83/codex-im-rich-client.git
cd codex-im-rich-client
git checkout v0.1.0-alpha.6
pnpm install
pnpm codex-im:install
```

The combined installer asks one platform to configure first. For
non-interactive setup pass the platform explicitly, e.g.
`pnpm codex-im:install --platform telegram`. You can preview without making
any local changes with `--dry-run`.

The installer:

1. checks Node, pnpm, and Codex App Server runtime compatibility;
2. runs the setup wizard (writes `~/.codex-im-bridge/config.toml`, backs up
   any prior config, stores secrets in macOS Keychain);
3. runs `pnpm im:doctor`;
4. builds and installs the daemon bundle;
5. installs and checks the current-user launchd service.

Watch the install output. When you see "Codex-IM local install complete.",
move on.

## First Message

In the IM chat you allowlisted during setup, send:

```text
/projects
/use 1
Reply exactly: OK
```

Expected behaviour:

- `/projects` lists projects by number; you do not need to memorize names.
- `/use 1` picks the first project.
- `Reply exactly: OK` should come back as a Codex reply containing `OK`.

If something fails, run `pnpm codex-im:status` locally before reporting.

## Useful Local Commands After Install

```bash
pnpm codex-im:status               # local-only readiness summary
pnpm codex-im:upgrade --check      # remote tag check (writes a redacted cache)
pnpm codex-im:upgrade --plan       # show planned upgrade target
pnpm codex-im:uninstall            # remove daemon + LaunchAgent (keeps config)
```

In this alpha, `pnpm codex-im:upgrade --apply` (without `--dry-run`) and
`pnpm codex-im:rollback` are rejected with explanatory errors. To roll back,
check out the previous tag and re-run `pnpm codex-im:install`.

## When You Get Stuck

- Re-run `pnpm codex-im:status` and read the doctor output.
- Read [troubleshooting.md](troubleshooting.md) first — most setup failures
  are listed there.
- File a bug using
  [customer-bug-report-template.md](customer-bug-report-template.md). Open
  the issue at the project's GitHub Issues, not a public chat. Do **not**
  paste real tokens or full daemon logs.
- For security reports, follow [SECURITY.md](../../SECURITY.md) instead of
  filing a public issue.

## What Counts as a Successful Customer Alpha Test

- [ ] Install command finished without manual intervention.
- [ ] `pnpm im:doctor` reports `ready` for the platform you configured, or
  the only `attention` item is the documented `writable_roots` metadata-only
  alpha warning.
- [ ] `/projects → /use 1 → Reply exactly: OK` completed end-to-end.
- [ ] No raw absolute path, no token-shaped value, and no internal stack
  trace appeared in any IM message you received.
- [ ] At least one normal development prompt (e.g. asking Codex to list
  files in the project cwd) worked.

If all five pass, the alpha works for you. Please report it — positive
reports are useful evidence too.
