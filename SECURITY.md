# Security Policy

## Supported Versions

This project is in early-access alpha. Only the latest `0.1.x` release
receives security updates. Earlier `0.1.x` releases are not maintained.

| Version  | Supported            |
|----------|----------------------|
| `0.1.x`  | latest only          |
| `< 0.1`  | not supported        |

Production deployments are not a supported scope at this stage.

## Reporting a Vulnerability

Email **hqwu810@gmail.com** with the subject line
`[security] codex-im-rich-client`. Include:

- a short description of the issue;
- minimal reproduction steps or proof-of-concept;
- affected version (commit hash or release tag);
- impact you observed.

Please **do not** open a public GitHub issue for security reports.

Please **do not** include real secrets in your report. This includes
IM bot tokens, Keychain values, OAuth credentials, session tokens,
webhook signing secrets, or any other live credential. Replace such
values with `<REDACTED>` placeholders before sending.

### Response expectations

This is a small open-source project without a paid security team. We
aim — best-effort, with no formal SLA — to:

- acknowledge receipt within **24–72 hours**;
- agree on a coordinated disclosure timeline once the report is
  confirmed;
- ship a fix on the next `0.1.x` release after agreement.

If we do not respond within 72 hours, please re-send.
