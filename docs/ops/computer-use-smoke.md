# Computer Use Smoke Runbook

Status: Phase 6 JAC-99 fake/manual smoke documentation.

## Scope

This runbook covers the Phase 6 Computer Use smoke path. It is intentionally
Chrome-only and fake/manual by default.

Allowed:

- fake provider tests;
- unsupported provider fail-closed tests;
- manual operator checklist for a future Chrome-only live smoke.

Forbidden by default:

- unattended desktop control;
- real browser cookies, Keychain data, passwords, OAuth tokens, recovery codes,
  screenshots, private session data, or `.env` contents in logs/docs/Linear;
- real provider execution in CI;
- non-Chrome app control;
- Terminal, Keychain Access, 1Password, System Settings, payment apps, wallet
  apps, or security/privacy settings.

## Fake Smoke

Run the fake/provider boundary tests:

```bash
pnpm vitest run --config vitest.config.ts --project unit \
  packages/core/test/computer-use-provider.test.ts \
  packages/core/test/computer-use-session.test.ts \
  packages/core/test/computer-use-audit.test.ts
```

Expected:

- unsupported provider returns `{ contentItems: [], success: false }`;
- fake provider returns deterministic fake output;
- no active `/cu` session fails closed;
- denied app never reaches provider;
- sensitive step fails closed and exposes no `allow_session`;
- explicit `/cu` trigger audit redacts token-looking task text.

## Manual Chrome-Only Smoke

Manual smoke is not an automated command in Phase 6. Use it only when the live
provider issue explicitly enables a reviewed real provider.

Checklist before starting:

- Chrome is the only allowed app.
- Use a disposable browser profile or a blank local page.
- Close password managers and sensitive apps.
- Do not use logged-in sessions containing private data.
- Prepare a harmless visible target, such as a local static HTML page.
- Confirm no recording, logs, or screenshots will capture secrets.

Allowed manual task examples:

- `/cu summarize the visible local test page`
- `/cu click the visible "OK" button on the local test page`

Disallowed manual task examples:

- login, password, token, checkout, purchase, transfer, delete, submit, publish;
- opening 1Password, Keychain Access, System Settings, Terminal, or private
  account pages;
- copying browser cookies or session storage;
- sending messages, posting comments, or changing production configuration.

Expected fail-closed behavior:

- no active `/cu` session -> tool call response `{ contentItems: [], success: false }`;
- app not allowlisted -> provider is not called;
- denied app -> provider is not called;
- sensitive keyword or sensitive step -> provider is not called and
  `allow_session` is unavailable;
- provider unavailable -> provider returns `{ contentItems: [], success: false }`.

## Redaction

Before attaching any smoke output to docs, Linear, or GPT consultation:

- remove tokens, cookies, OAuth codes, passwords, private URLs, and user IDs;
- do not include screenshots unless a future reviewed plan explicitly allows a
  redacted screenshot fixture;
- include only command names, gate status, fake provider outputs, and redacted
  audit metadata.

## Rollback / Stop

Stop immediately if Chrome displays:

- credential or payment UI;
- private account data;
- a permission prompt;
- a download/upload dialog;
- another application or system settings surface.

Rollback is simply to stop the provider/session, clear the fake `/cu` session,
and close the disposable Chrome profile. Do not attempt to continue by asking
for approval inside the same smoke; sensitive approval behavior is tested by
unit/fake paths until a reviewed live provider exists.
