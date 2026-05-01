// T4.1 (Phase 2) — failing test for the redact() string primitive.
//
// Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md §5 T4
//
// `redact(text: string): string` is the lowest-layer string-redaction
// primitive in `@codex-im/core`. T5 wraps it inside `AuditEmitter.emit`
// (deep-walking `event.metadata`); T15 re-exports it from
// `@codex-im/render`. T4 ships the string primitive ONLY — no object
// walking, no logger wiring, no audit integration. Those are downstream
// tasks per plan §5 T5 / T15.
//
// Patterns covered (11 from plan T4.1 + benign passthrough + idempotency):
//   1.  Telegram bot tokens (`\d{8,10}:[A-Za-z0-9_-]{35}`)
//   2.  GitHub tokens (`ghp_*`, `gho_*`, `ghs_*`, `github_pat_*`)
//   3.  Slack tokens (`xoxb-*`, `xoxp-*`, `xoxa-*`)
//   4.  OpenAI/Anthropic tokens (`sk-*`, `sk-ant-*`)
//   5.  Generic Authorization headers (`Bearer …` / `Token …`)
//   6.  Absolute `/Users/<name>/...` paths
//   7.  SSH private key blocks
//   8.  PEM/TLS certificate blocks
//   9.  Cloud provider keys (AWS `AKIA*`, GCP `AIza*`, Azure connection strings)
//   10. Env-var-style assignments with values longer than 16 chars
//   11. Contextual long base64 blobs (≥40 chars in `key=`/`cert=`/`secret=` context)
//   +   Benign text passthrough (CLI commands, prose, etc.)
//   +   Idempotency: `redact(redact(x)) === redact(x)`
//
// FIXTURE DISCIPLINE:
//   All values below are OBVIOUSLY FAKE — they share the structural
//   shape of real secrets so the regex matches, but contain only test
//   markers (`FAKE`, `EXAMPLE`, `NOT_REAL`, `SAMPLE`). DO NOT use real
//   credentials in tests, ever (plan §0.4 redline + 07-SECURITY §8).
//
// ASSERTION STRATEGY:
//   - For patterns where the plan specifies an exact replacement
//     (Telegram → `***REDACTED:telegram-token***`; paths →
//     `/Users/<redacted>/<path-tail>`; SSH/PEM → "entirely elided"),
//     assert exact match.
//   - For other patterns, assert structurally:
//       (a) the literal secret value is GONE from the output
//       (b) some redaction marker is present (the test does NOT pin the
//           exact marker string — T4.3 implementation picks it; this lets
//           the implementation choose between e.g. `***REDACTED:github-token***`
//           and `[REDACTED:github]` without forcing a particular spelling).
//
// History: T4.1 wrote these tests against a not-yet-existing module
// (TDD failing-test step); T4.3 implemented redact.ts to make them
// pass; Codex review (T4 post-impl) surfaced 4 P1 fixes — the
// false-positive / regression suite below was added in that round to
// pin the bugs Codex caught (env-var false positives on PWD/MONKEY/
// HOTKEY, lowercase Authorization, GCP dash-ending boundary).

import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.js";

// ─── Fake fixtures (NEVER real credentials) ──────────────────────────────

const FAKE_TELEGRAM_TOKEN = "1234567890:ABCDEFGHIJabcdefghij1234567890ABCDE";
// 10 digits + ":" + exactly 35 chars from [A-Za-z0-9_-] = matches Telegram regex.

const FAKE_GITHUB_PAT = "ghp_FAKETOKEN1234567890abcdefghijklmnop";
const FAKE_GITHUB_OAUTH = "gho_FAKETOKEN1234567890abcdefghijklmnop";
const FAKE_GITHUB_SERVER = "ghs_FAKETOKEN1234567890abcdefghijklmnop";
const FAKE_GITHUB_FINE = "github_pat_FAKETOKEN1234567890abcdefghijklmnop";

const FAKE_SLACK_BOT = "xoxb-FAKE-1234567890-abcdefghijklmnop";
const FAKE_SLACK_USER = "xoxp-FAKE-1234567890-abcdefghijklmnop";
const FAKE_SLACK_APP = "xoxa-FAKE-1234567890-abcdefghijklmnop";

const FAKE_OPENAI = "sk-FAKETOKEN1234567890abcdefghijklmnop";
const FAKE_ANTHROPIC = "sk-ant-FAKETOKEN1234567890abcdefghijklmnop";

const FAKE_BEARER = "FAKE_BEARER_NOT_REAL_VALUE_1234567890abcdef";
const FAKE_AUTH_TOKEN = "FAKE_AUTH_TOKEN_NOT_REAL_VALUE_1234567890";

const FAKE_AWS_KEY = "AKIAIOSFODNN7EXAMPLE"; // AWS docs canonical fake
const FAKE_GCP_KEY = "AIzaSyDFAKE1234567890fakeGoogleApiKey45";
// AIza + exactly 35 chars from [A-Za-z0-9_-] = matches GCP API key regex (39 total).

const FAKE_GCP_KEY_DASH_ENDING = "AIzaSyDFAKE1234567890fakeGoogleApiKey4-";
// AIza + exactly 35 chars ending in `-` — exercises the (?![A-Za-z0-9_-])
// boundary lookahead (Codex T4 review P1-3). The trailing `4-` makes the
// 35-char body end in `-`; followed by whitespace/quote/comma in the
// test, the original `\b` boundary would have failed.
const FAKE_AZURE_CONN =
  "DefaultEndpointsProtocol=https;AccountName=fakestorage;AccountKey=ZmFrZUtleVZhbHVlPT0=;EndpointSuffix=core.windows.net";

const FAKE_SSH_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
FAKEKEYBODYabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP
QRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFG
-----END OPENSSH PRIVATE KEY-----`;

const FAKE_PEM_CERT = `-----BEGIN CERTIFICATE-----
MIIDXFAKECERTBODYabcdefghijklmnopqrstuvwxyzABCDEFGHI
JKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxy
-----END CERTIFICATE-----`;

const FAKE_RSA_KEY = `-----BEGIN RSA PRIVATE KEY-----
FAKERSABODYabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP
-----END RSA PRIVATE KEY-----`;

const FAKE_BASE64_LONG = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5LWZha2U=";
// 56 chars; plain text "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-fake" base64'd

// ─── Test suite ─────────────────────────────────────────────────────────

describe("@codex-im/core redact (T4.1)", () => {
  // ─── 1. Telegram bot tokens ────────────────────────────────────────
  describe("Telegram bot tokens", () => {
    it("redacts a bare Telegram bot token to ***REDACTED:telegram-token***", () => {
      expect(redact(FAKE_TELEGRAM_TOKEN)).toBe("***REDACTED:telegram-token***");
    });

    it("redacts a Telegram token embedded in a longer string", () => {
      const out = redact(`got token=${FAKE_TELEGRAM_TOKEN} for bot init`);
      expect(out).not.toContain(FAKE_TELEGRAM_TOKEN);
      expect(out).toContain("***REDACTED:telegram-token***");
    });
  });

  // ─── 2. GitHub tokens ──────────────────────────────────────────────
  describe("GitHub tokens", () => {
    it.each([
      ["ghp_ classic PAT", FAKE_GITHUB_PAT],
      ["gho_ OAuth", FAKE_GITHUB_OAUTH],
      ["ghs_ server", FAKE_GITHUB_SERVER],
      ["github_pat_ fine-grained", FAKE_GITHUB_FINE],
    ])("redacts %s", (_label, token) => {
      const out = redact(`gh auth token: ${token}`);
      expect(out).not.toContain(token);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });
  });

  // ─── 3. Slack tokens ───────────────────────────────────────────────
  describe("Slack tokens", () => {
    it.each([
      ["xoxb- bot", FAKE_SLACK_BOT],
      ["xoxp- user", FAKE_SLACK_USER],
      ["xoxa- app", FAKE_SLACK_APP],
    ])("redacts %s", (_label, token) => {
      const out = redact(`slack creds: ${token}`);
      expect(out).not.toContain(token);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });
  });

  // ─── 4. OpenAI / Anthropic tokens ──────────────────────────────────
  describe("OpenAI / Anthropic tokens", () => {
    it("redacts an OpenAI sk- token", () => {
      const out = redact(`OPENAI_API_KEY=${FAKE_OPENAI}`);
      expect(out).not.toContain(FAKE_OPENAI);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("redacts an Anthropic sk-ant- token", () => {
      const out = redact(`ANTHROPIC_API_KEY=${FAKE_ANTHROPIC}`);
      expect(out).not.toContain(FAKE_ANTHROPIC);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });
  });

  // ─── 5. Authorization headers ──────────────────────────────────────
  describe("Authorization headers", () => {
    it("redacts the value of `Authorization: Bearer …`", () => {
      const out = redact(`Authorization: Bearer ${FAKE_BEARER}`);
      expect(out).not.toContain(FAKE_BEARER);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("redacts the value of `Authorization: Token …`", () => {
      const out = redact(`Authorization: Token ${FAKE_AUTH_TOKEN}`);
      expect(out).not.toContain(FAKE_AUTH_TOKEN);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });
  });

  // ─── 6. Absolute /Users/<name>/ paths ──────────────────────────────
  describe("Absolute /Users/<name>/ paths", () => {
    it("redacts the user-name segment but keeps the path-tail", () => {
      // Plan format: `/Users/<redacted>/<path-tail>`
      expect(redact("/Users/secret/proj/file.ts")).toBe("/Users/<redacted>/proj/file.ts");
    });

    it("redacts within a longer string and preserves surrounding text", () => {
      const out = redact("cwd=/Users/jack/code/repo running pnpm test");
      expect(out).not.toContain("/Users/jack/");
      expect(out).toContain("/Users/<redacted>/code/repo");
      expect(out).toContain("running pnpm test");
    });

    it("does not affect non-/Users absolute paths (Linux /home, /tmp, /opt)", () => {
      expect(redact("/home/jack/code/repo")).toBe("/home/jack/code/repo");
      expect(redact("/tmp/build/output.log")).toBe("/tmp/build/output.log");
      expect(redact("/opt/codex/bin")).toBe("/opt/codex/bin");
    });

    it("redacts a /Users/ path whose tail contains spaces", () => {
      const out = redact("/Users/secret/My Documents/notes.md");
      expect(out).not.toContain("/Users/secret/");
      expect(out).toContain("/Users/<redacted>/");
    });
  });

  // ─── 7. SSH private key blocks ─────────────────────────────────────
  describe("SSH private key blocks", () => {
    it("entirely elides an OPENSSH PRIVATE KEY block", () => {
      const out = redact(FAKE_SSH_KEY);
      expect(out).not.toContain("FAKEKEYBODY");
      expect(out).not.toContain("BEGIN OPENSSH PRIVATE KEY");
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("entirely elides an RSA PRIVATE KEY block", () => {
      const out = redact(FAKE_RSA_KEY);
      expect(out).not.toContain("FAKERSABODY");
      expect(out).not.toContain("BEGIN RSA PRIVATE KEY");
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("preserves surrounding prose when the key block is embedded", () => {
      const before = "Here is the key file contents:\n";
      const after = "\n(end of file)";
      const out = redact(`${before}${FAKE_SSH_KEY}${after}`);
      expect(out).toContain("Here is the key file contents:");
      expect(out).toContain("(end of file)");
      expect(out).not.toContain("FAKEKEYBODY");
    });
  });

  // ─── 8. PEM/TLS certificate blocks ─────────────────────────────────
  describe("PEM/TLS certificate blocks", () => {
    it("entirely elides a CERTIFICATE block", () => {
      const out = redact(FAKE_PEM_CERT);
      expect(out).not.toContain("FAKECERTBODY");
      expect(out).not.toContain("BEGIN CERTIFICATE");
      expect(out.toLowerCase()).toMatch(/redacted/);
    });
  });

  // ─── 9. Cloud provider keys ────────────────────────────────────────
  describe("Cloud provider keys", () => {
    it("redacts an AWS AKIA* access key", () => {
      const out = redact(`aws creds: ${FAKE_AWS_KEY}`);
      expect(out).not.toContain(FAKE_AWS_KEY);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("redacts a GCP AIza* API key", () => {
      const out = redact(`gcp api key: ${FAKE_GCP_KEY}`);
      expect(out).not.toContain(FAKE_GCP_KEY);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("redacts an Azure connection string (AccountKey value)", () => {
      const out = redact(FAKE_AZURE_CONN);
      expect(out).not.toContain("ZmFrZUtleVZhbHVlPT0=");
      expect(out.toLowerCase()).toMatch(/redacted/);
    });
  });

  // ─── 10. Env-var-style assignments ─────────────────────────────────
  describe("Env-var-style assignments", () => {
    it("redacts API_KEY=<long value>", () => {
      const out = redact("API_KEY=ThisIsAFakeApiKeyValueLongerThan16chars");
      expect(out).not.toContain("ThisIsAFakeApiKeyValueLongerThan16chars");
      expect(out).toContain("API_KEY=");
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("redacts SECRET=<long value>", () => {
      const out = redact("SECRET=AnotherFakeSecretValueLongerThan16chars");
      expect(out).not.toContain("AnotherFakeSecretValueLongerThan16chars");
      expect(out).toContain("SECRET=");
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("redacts TOKEN=<long value>", () => {
      const out = redact("TOKEN=YetAnotherFakeTokenValueLongerThan16chars");
      expect(out).not.toContain("YetAnotherFakeTokenValueLongerThan16chars");
      expect(out).toContain("TOKEN=");
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("does NOT redact short env values (≤16 chars per plan)", () => {
      // Plan spec: redact only when value is longer than 16 chars.
      const out = redact("DEBUG=true API_KEY=short PORT=3000");
      expect(out).toContain("DEBUG=true");
      expect(out).toContain("API_KEY=short");
      expect(out).toContain("PORT=3000");
    });

    it("does NOT redact non-secret-named env vars regardless of length", () => {
      const out = redact("PATH=/usr/local/bin:/usr/bin:/bin LANG=en_US.UTF-8");
      expect(out).toContain("PATH=/usr/local/bin");
      expect(out).toContain("LANG=en_US.UTF-8");
    });
  });

  // ─── 11. Contextual long base64 blobs ──────────────────────────────
  describe("Contextual long base64 blobs", () => {
    it("redacts a long base64 value in `key=` context", () => {
      const out = redact(`config: key=${FAKE_BASE64_LONG} other=ignored`);
      expect(out).not.toContain(FAKE_BASE64_LONG);
      expect(out.toLowerCase()).toMatch(/redacted/);
      expect(out).toContain("other=ignored");
    });

    it("redacts a long base64 value in `cert=` context", () => {
      const out = redact(`tls cert=${FAKE_BASE64_LONG}`);
      expect(out).not.toContain(FAKE_BASE64_LONG);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("redacts a long base64 value in `secret=` context", () => {
      const out = redact(`oauth secret=${FAKE_BASE64_LONG}`);
      expect(out).not.toContain(FAKE_BASE64_LONG);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("does NOT redact long base64 outside suspicious context", () => {
      // A long base64 string in plain prose with no key/cert/secret label
      // should NOT be redacted — that's the "contextual" qualifier.
      const benign = `result data: ${FAKE_BASE64_LONG} (computed hash)`;
      expect(redact(benign)).toContain(FAKE_BASE64_LONG);
    });
  });

  // ─── Benign text passthrough ───────────────────────────────────────
  describe("Benign text passthrough", () => {
    it.each([
      "pnpm test",
      "git status",
      "npm run build",
      "cargo build --release",
      "Reply OK",
      "applying patch to packages/core/src/audit.ts",
      "approval request received",
      "user clicked allow_once",
      "duration: 1.04s (354 tests passed)",
    ])("leaves benign text unchanged: %s", (input) => {
      expect(redact(input)).toBe(input);
    });

    it("leaves an empty string unchanged", () => {
      expect(redact("")).toBe("");
    });

    it("leaves single-character input unchanged", () => {
      expect(redact("x")).toBe("x");
    });
  });

  // ─── False-positive regression (Codex T4 review P1) ───────────────
  describe("False-positive regression — added by Codex T4 review", () => {
    it("does NOT redact PWD=<value> as an env-var-style secret (P1-1: PWD removed from suffix list)", () => {
      // PWD is the shell's working-directory env var. The path-redaction
      // rule may still rewrite the /Users/<name>/ portion of the value,
      // but the PWD= prefix and the path-tail must survive.
      const out = redact("PWD=/Users/jack/code/repo");
      expect(out).toContain("PWD=");
      expect(out).toContain("/Users/<redacted>/code/repo");
      expect(out).not.toContain("/Users/jack/");
      expect(out).not.toContain("***REDACTED:env-value***");
    });

    it("does NOT redact MONKEY=<long value> (P1-1: bare MONKEY isn't a secret-named env)", () => {
      const out = redact("MONKEY=banana12345678abcdefghijklmnop");
      expect(out).toBe("MONKEY=banana12345678abcdefghijklmnop");
    });

    it("does NOT redact HOTKEY=<long value> (P1-1: bare HOTKEY isn't a secret-named env)", () => {
      const out = redact("HOTKEY=ctrl+shift+something1234567890abc");
      expect(out).toBe("HOTKEY=ctrl+shift+something1234567890abc");
    });

    it("DOES redact MY_KEY=<long value> (underscore-prefix form must still match)", () => {
      const out = redact("MY_KEY=ARealLookingFakeSecretValue1234567890abc");
      expect(out).toContain("MY_KEY=***REDACTED:env-value***");
      expect(out).not.toContain("ARealLookingFakeSecretValue1234567890abc");
    });

    it("DOES redact lowercase `authorization: Bearer …` (P1-2: case-insensitive)", () => {
      const out = redact(`authorization: Bearer ${FAKE_BEARER}`);
      expect(out).not.toContain(FAKE_BEARER);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("DOES redact UPPERCASE `AUTHORIZATION: Bearer …` (P1-2: case-insensitive)", () => {
      const out = redact(`AUTHORIZATION: Bearer ${FAKE_BEARER}`);
      expect(out).not.toContain(FAKE_BEARER);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("does NOT match Authorization mid-word (P1-2: \\b boundary catches NotAuthorization:)", () => {
      const out = redact("Header NotAuthorization: Bearer SHOULD_STAY_VISIBLE_XYZ");
      expect(out).toContain("SHOULD_STAY_VISIBLE_XYZ");
      expect(out).toContain("NotAuthorization: Bearer");
    });

    it("DOES redact a GCP key whose 35th char is `-` followed by whitespace (P1-3: lookahead boundary)", () => {
      const out = redact(`gcp api key: ${FAKE_GCP_KEY_DASH_ENDING} and other text`);
      expect(out).not.toContain(FAKE_GCP_KEY_DASH_ENDING);
      expect(out.toLowerCase()).toMatch(/redacted/);
      expect(out).toContain("and other text");
    });

    it("DOES redact a GCP key whose 35th char is `-` followed by a quote", () => {
      const out = redact(`{"gcpKey":"${FAKE_GCP_KEY_DASH_ENDING}"}`);
      expect(out).not.toContain(FAKE_GCP_KEY_DASH_ENDING);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });
  });

  // ─── Codex T4 review P2: extra GitHub/Slack variants test coverage ─
  describe("Extra GitHub/Slack token variants beyond plan-listed (P2 coverage)", () => {
    it("redacts ghu_ user-to-server token", () => {
      const token = "ghu_FAKETOKEN1234567890abcdefghijklmnop";
      const out = redact(`gh auth: ${token}`);
      expect(out).not.toContain(token);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("redacts ghr_ refresh token", () => {
      const token = "ghr_FAKETOKEN1234567890abcdefghijklmnop";
      const out = redact(`gh auth: ${token}`);
      expect(out).not.toContain(token);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });

    it("redacts xoxs- Slack legacy token", () => {
      const token = "xoxs-FAKE-1234567890-abcdefghijklmnop";
      const out = redact(`slack: ${token}`);
      expect(out).not.toContain(token);
      expect(out.toLowerCase()).toMatch(/redacted/);
    });
  });

  // ─── Idempotency (defensive — exercises every rule family) ─────────
  describe("Idempotency (redact ∘ redact === redact) — every rule family", () => {
    it.each([
      ["Telegram", FAKE_TELEGRAM_TOKEN],
      ["GitHub PAT", FAKE_GITHUB_PAT],
      ["GitHub OAuth", FAKE_GITHUB_OAUTH],
      ["Slack bot", FAKE_SLACK_BOT],
      ["OpenAI", FAKE_OPENAI],
      ["Anthropic", FAKE_ANTHROPIC],
      ["Authorization Bearer", `Authorization: Bearer ${FAKE_BEARER}`],
      ["Authorization Token (lowercase)", `authorization: Token ${FAKE_AUTH_TOKEN}`],
      ["AWS access key", FAKE_AWS_KEY],
      ["GCP API key", FAKE_GCP_KEY],
      ["GCP API key dash-ending", FAKE_GCP_KEY_DASH_ENDING],
      ["Azure connection", FAKE_AZURE_CONN],
      ["Env-var API_KEY", "API_KEY=AnEnvVarValueLongerThan16chars"],
      ["Env-var underscore-prefix MY_TOKEN", "MY_TOKEN=AnotherEnvVarValueLongerThan16chars"],
      ["SSH private key", FAKE_SSH_KEY],
      ["RSA private key", FAKE_RSA_KEY],
      ["PEM cert", FAKE_PEM_CERT],
      ["Contextual base64 (key=)", `config: key=${FAKE_BASE64_LONG} other=ignored`],
      ["Contextual base64 (cert=)", `tls cert=${FAKE_BASE64_LONG}`],
      ["Contextual base64 (secret=)", `oauth secret=${FAKE_BASE64_LONG}`],
      ["Absolute /Users/ path", "/Users/secret/proj/file.ts"],
      [
        "Mixed (multiple secret families in one string)",
        `mixed: ${FAKE_TELEGRAM_TOKEN} and ${FAKE_GITHUB_PAT} and ${FAKE_AWS_KEY} and Authorization: Bearer ${FAKE_BEARER} and /Users/jack/code and API_KEY=SomeLongValue1234567890abc`,
      ],
      ["Benign text", "pnpm test"],
      ["Empty string", ""],
    ])("redact(redact(x)) === redact(x) for %s fixture", (_label, input) => {
      const once = redact(input);
      const twice = redact(once);
      expect(twice).toBe(once);
    });
  });
});
