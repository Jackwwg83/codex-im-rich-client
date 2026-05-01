// Phase 2 T4 — string-redaction primitive (F10 / Codex P1-3 / Codex Q5).
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T4
//
// `redact(text)` is the lowest-layer string-redaction primitive in
// `@codex-im/core`. T5 wraps it inside `AuditEmitter.emit` (deep-walking
// `event.metadata`); T15 re-exports it from `@codex-im/render`. T4 ships
// the string primitive ONLY — no object walking, no logger wiring, no
// audit integration.
//
// Patterns covered (11 from plan T4.1 + benign passthrough + idempotency):
//   1.  SSH private key blocks  (multiline elision)
//   2.  PEM/TLS certificate blocks (multiline elision)
//   3.  Telegram bot tokens
//   4.  GitHub tokens (ghp_ / gho_ / ghs_ / github_pat_)
//   5.  Slack tokens (xoxa- / xoxb- / xoxp-)
//   6.  Anthropic tokens (sk-ant-)            ← BEFORE OpenAI to win the prefix race
//   7.  OpenAI tokens (sk-)
//   8.  AWS access keys (AKIA…)
//   9.  GCP API keys (AIza…)
//   10. Azure connection strings (AccountKey=…)
//   11. Authorization headers (Bearer / Token)
//   12. Env-var-style assignments (NAME=value, value > 16 chars, NAME ends
//       in KEY/TOKEN/SECRET/PASSWORD/PASSWD/PWD)
//   13. Contextual long base64 (key=/cert=/secret= ≥ 40 base64 chars)
//   14. Absolute /Users/<name>/ paths
//
// PLACEHOLDER CHOICE & IDEMPOTENCY:
//   Every replacement uses the form `***REDACTED:<type>***` (or the
//   plan-specified `/Users/<redacted>/...` for paths). Idempotency is
//   guaranteed by TWO complementary mechanisms:
//
//   (1) Many placeholders structurally cannot match the regex that
//       produced them — e.g. `***REDACTED:telegram-token***` has no
//       run of 8 consecutive digits, `***REDACTED:github-token***`
//       doesn't start with `ghp_`/`gho_`/etc., `***REDACTED:base64***`
//       contains `*` and `:` which aren't valid base64 chars, and the
//       SSH/PEM block placeholders don't contain `BEGIN`/`END` markers.
//
//   (2) Where (1) doesn't hold by structure (Authorization headers,
//       Azure connection strings, env-var-style assignments, contextual
//       base64), the redaction regex carries an explicit
//       `(?!\*\*\*REDACTED)` negative-lookahead before the value match.
//       The lookahead skips already-redacted positions so the regex
//       does not re-match. This is the PRIMARY mechanism for those
//       four families.
//
//   Path rule (`/Users/<name>/`) uses a `(?!<redacted>(?:/|$))` negative
//   lookahead to skip `/Users/<redacted>/` paths that are already
//   redacted.
//
//   Net effect: `redact(redact(x)) === redact(x)` for every input. The
//   idempotency test suite exercises every rule family.
//
// REGEX ORDER (most-specific-first):
//   Multi-line elision (SSH/PEM) runs FIRST so a private-key block
//   doesn't get partially clobbered by intermediate token regexes.
//   Anthropic `sk-ant-` runs BEFORE OpenAI `sk-` so anthropic tokens
//   aren't mistaken for openai. Env-var-style (NAME=…) runs BEFORE
//   contextual-base64 because `SECRET=` is uppercase env-var-style,
//   while `secret=` is lowercase contextual-base64 — case-sensitive
//   patterns separate them.

const PLACEHOLDERS = {
  sshKey: "***REDACTED:ssh-private-key***",
  pemCert: "***REDACTED:pem-certificate***",
  telegram: "***REDACTED:telegram-token***",
  github: "***REDACTED:github-token***",
  slack: "***REDACTED:slack-token***",
  anthropic: "***REDACTED:anthropic-token***",
  openai: "***REDACTED:openai-token***",
  aws: "***REDACTED:aws-access-key***",
  gcp: "***REDACTED:gcp-api-key***",
  azureKey: "***REDACTED:azure-account-key***",
  bearer: "***REDACTED:bearer***",
  authToken: "***REDACTED:auth-token***",
  envValue: "***REDACTED:env-value***",
  base64: "***REDACTED:base64***",
} as const;

/**
 * Ordered redaction rules. Each rule is `[pattern, replacement]` and is
 * applied in array order via `String.prototype.replace`. Order matters:
 *
 *   1. Multi-line key/cert blocks elide first so token-shaped strings
 *      inside the block don't get partially redacted.
 *   2. Specific-prefix tokens (Telegram, GitHub, Slack, Anthropic, OpenAI,
 *      AWS, GCP) before generic patterns.
 *   3. Anthropic `sk-ant-` BEFORE OpenAI `sk-`.
 *   4. Authorization headers before env-var-style and contextual base64
 *      (so `Authorization: Bearer ...` isn't matched as env-var-style).
 *   5. Env-var-style (uppercase) before contextual-base64 (lowercase
 *      `key=` / `cert=` / `secret=`) so `SECRET=…` doesn't double-redact.
 *   6. /Users/ paths last — the path pattern is broad and could match
 *      inside a redacted token if run earlier.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // 1. SSH private key blocks (multi-line elision; non-greedy)
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    PLACEHOLDERS.sshKey,
  ],
  // 2. PEM/TLS certificate blocks
  [/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, PLACEHOLDERS.pemCert],
  // 3. Telegram bot tokens: 8-10 digits + ":" + 35 chars from [A-Za-z0-9_-]
  //    `(?![A-Za-z0-9_-])` lookahead ensures we don't grab the first 35
  //    chars of a longer suffix.
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, PLACEHOLDERS.telegram],
  // 4. GitHub tokens
  [/\bghp_[A-Za-z0-9_]{20,}/g, PLACEHOLDERS.github],
  [/\bgho_[A-Za-z0-9_]{20,}/g, PLACEHOLDERS.github],
  [/\bghs_[A-Za-z0-9_]{20,}/g, PLACEHOLDERS.github],
  [/\bghu_[A-Za-z0-9_]{20,}/g, PLACEHOLDERS.github], // user-to-server tokens
  [/\bghr_[A-Za-z0-9_]{20,}/g, PLACEHOLDERS.github], // refresh tokens
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, PLACEHOLDERS.github],
  // 5. Slack tokens (xoxa / xoxb / xoxp / xoxs / xoxr / xoxd)
  [/\bxox[abdprs]-[A-Za-z0-9-]{10,}/g, PLACEHOLDERS.slack],
  // 6. Anthropic FIRST (more specific prefix wins the race)
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, PLACEHOLDERS.anthropic],
  // 7. OpenAI
  [/\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/g, PLACEHOLDERS.openai],
  // 8. AWS access keys (AKIA + 16 alphanumerics, total 20 chars)
  [/\bAKIA[0-9A-Z]{16}\b/g, PLACEHOLDERS.aws],
  // 9. GCP API keys (AIza + 35 chars from [A-Za-z0-9_-]).
  //    Trailing `(?![A-Za-z0-9_-])` lookahead — same pattern as Telegram.
  //    `\b` alone breaks when the 35th char is `-` followed by a non-word
  //    char (`-` is `\W`, so the boundary doesn't fire). The lookahead
  //    works regardless of whether the 35th char is `-` or alphanumeric.
  [/\bAIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, PLACEHOLDERS.gcp],
  // 10. Azure connection-string AccountKey value: redact the value only,
  //     keep the surrounding "AccountKey=" so the structure is visible.
  //     `(?!\*\*\*REDACTED)` lookahead skips already-redacted lines.
  [/AccountKey=(?!\*\*\*REDACTED)[A-Za-z0-9+/=]+/g, `AccountKey=${PLACEHOLDERS.azureKey}`],
  // 11. Authorization headers — Bearer / Token. Case-insensitive (`/i`)
  //     because HTTP header names are case-insensitive and real logs
  //     contain `authorization:` lowercase. `\b` before `Authorization`
  //     prevents matching inside `NotAuthorization:` or
  //     `XAuthorization:` (mid-word). The replacement always emits
  //     canonical capitalization — minor normalization, acceptable for
  //     audit emission.
  [
    /\bAuthorization:\s*Bearer\s+(?!\*\*\*REDACTED)\S+/gi,
    `Authorization: Bearer ${PLACEHOLDERS.bearer}`,
  ],
  [
    /\bAuthorization:\s*Token\s+(?!\*\*\*REDACTED)\S+/gi,
    `Authorization: Token ${PLACEHOLDERS.authToken}`,
  ],
  // 12. Env-var-style assignments: redact the value of NAME=value where
  //     value > 16 non-space chars AND NAME is one of:
  //       (a) a small allowlist of well-known bare names: API_KEY,
  //           SECRET, TOKEN, PASSWORD, PASSWD;
  //       (b) any underscore-delimited prefix + KEY/TOKEN/SECRET/
  //           PASSWORD/PASSWD suffix (e.g. OPENAI_API_KEY, MY_TOKEN,
  //           CLIENT_SECRET, REFRESH_TOKEN, ACCESS_KEY).
  //
  //     IMPORTANT (Codex T4 review P1-1): the prefix portion of (b)
  //     requires a `_` between prefix and suffix so MONKEY / HOTKEY /
  //     PWD don't false-positive. PWD is NOT in the allowlist because
  //     it's the shell's working-directory env var — almost never a
  //     secret; Codex review explicitly flagged it.
  //
  //     `(?!\*\*\*REDACTED)` lookahead is idempotent-safe.
  [
    /\b(API_KEY|SECRET|TOKEN|PASSWORD|PASSWD|[A-Z][A-Z0-9_]*_(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD))=(?!\*\*\*REDACTED)\S{17,}/g,
    `$1=${PLACEHOLDERS.envValue}`,
  ],
  // 13. Contextual long base64: lowercase `key=` / `cert=` / `secret=`
  //     followed by 40+ valid base64 chars. Case-sensitive lowercase per
  //     plan (uppercase trigger names are env-var-style above).
  //     The `\b` word-boundary BEFORE the keyword prevents matching
  //     uppercase-mixed contexts like `AccountKey=` (already handled by
  //     rule 10).
  [
    /(?<![A-Za-z])(key|cert|secret)=(?!\*\*\*REDACTED)[A-Za-z0-9+/=]{40,}/g,
    `$1=${PLACEHOLDERS.base64}`,
  ],
  // 14. /Users/<name>/ paths — replace user-name segment with <redacted>;
  //     keep the path-tail. `(?!<redacted>)` prevents re-redacting an
  //     already-redacted path. `[^/\s<>]+` for the user-name segment so
  //     we don't cross slash/whitespace boundaries and don't gobble
  //     `<redacted>` chars.
  [/\/Users\/(?!<redacted>(?:\/|$))[^/\s<>]+\//g, "/Users/<redacted>/"],
];

/**
 * Redact sensitive data from a string. Returns a copy with every detected
 * pattern replaced by a stable `***REDACTED:<type>***` placeholder (or
 * `/Users/<redacted>/...` for paths). Pure function: same input always
 * yields same output; `redact(redact(x)) === redact(x)` (idempotent).
 *
 * Use this at any boundary where a string may carry credentials, paths,
 * or other sensitive material. T5 wires it into `AuditEmitter.emit` so
 * every audit event flows through redaction before it reaches pino /
 * the in-memory ring.
 *
 * NOT a security barrier on its own — false negatives are possible
 * (novel token formats, custom env-var names not matching the suffix
 * heuristic). Defense in depth: never log raw params, never put
 * untrusted data through `redact` and assume it is safe to display.
 */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
