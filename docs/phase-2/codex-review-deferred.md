# Phase 2 Codex outside-voice review — deferred backfill

**Status:** DEFERRED — local Codex CLI was hung in implementer's environment
when T18-T22 + T24 integrated review were due (2026-05-02). Tag
`phase-2-approval-im-surface-complete` was applied at `0fa0c94` with
explicit deferral note in the annotation.

**Verified-GO reviews already completed during Phase 2:**

- Plan v1 → REJECT (Codex P0×7, P1×7) → fix arc → re-review APPROVE
- Plan v2 round-2 → APPROVE_WITH_CHANGES → polish (`bfeb3dc`)
- Plan v2.3 round-3 deep review → APPROVE_T4_AFTER_FIXES → polish (`7a69ad4`)
- T4 redact relocated — `codex-review-t4.md` (P1 fixes applied + re-reviewed)
- T5 audit emit applies redact — `codex-review-t5.md` (P1 polish applied)
- T7-T12 broker public surface + resolve centerpiece — combined review verdict
  NO_GO with 1 P0 + 3 P1 + 1 P2; fixes applied in `231f653`; re-review **GO**
- T13-T17 render package — combined review verdict GO with 2 P1 + 3 P2;
  fixes applied in `7f6b6a1`; re-review **GO**

**Deferred reviews (require codex CLI restoration to backfill):**

| Scope | Commits | Risk profile | Notes |
|---|---|---|---|
| **T18 channel-core skeleton + types + boundary tests** | `a08cc81` | LOW | Type definitions + 4 boundary tests asserting F13. Minimal new logic. |
| **T19 ChannelAdapter + TelegramShapeFakeChannelAdapter** | `acea679` | MEDIUM | Closed `ChannelAdapter` interface (D14) + fake adapter implementing Telegram Bot API constraints (callback_data ≤62B, 60s answerCallbackQuery deadline, parse_mode unsupported). 16 unit tests cover round-trip + bounds + deadline + post-stop reject. Key risk: real Telegram divergence (mitigated by inline doc citations to Bot API + stricter-than-spec budgets for headroom). |
| **T20 method-literal grep guard scope extension** | `27c3c76` | LOW | Replaces git-grep with filesystem walk; extends scope to render/ + channel-core/ + adds explicit `decision-mapper.ts` no-literal assertion. Mechanism change verified by all existing + new boundary tests passing. |
| **T21 full e2e (P2.10) — 14 paths + index stress + bounds** | `0a121e2` | MEDIUM | Tests-only file. Validates the full broker → render → channel-core → broker pipeline composes correctly. 19 new tests (18 active + 1 deferred for Phase 3 supervisor). Per-path R4 redaction-in-audit assertion. Index-drift stress (100 concurrent emit + resolve + expire). 6-digit max id + 8-digit overflow callback_data tests. |
| **T22 supervisor pre-attached-broker invariant** | `d452391` | LOW | One-line assertion at `Supervisor.#spawnFresh` head + load-bearing error message naming the production = Supervisor / dev = runtime-send split (Codex Q6). 4 dedicated tests. Updated 1 Phase 1 test to assert new error message. |
| **T24 integrated review** | `phase-1-runtime-complete..0fa0c94` (27 commits) | The integrated review is the highest-value deferred item — it can catch composition bugs that per-task reviews miss (e.g., how T7-T12 broker fixes interact with T22 supervisor; whether T20 grep guard correctly covers all the new Phase 2 dirs). |

**How to backfill (when codex CLI is restored):**

1. Verify codex CLI is responsive:
   ```bash
   codex --version
   ```
2. Run T18-T22 combined review:
   ```bash
   codex exec --skip-git-repo-check --sandbox read-only \
     "$(cat docs/phase-2/codex-review-deferred-prompt.md)" \
     > docs/phase-2/codex-review-t18-t22.md
   ```
3. Run T24 integrated review:
   ```bash
   codex exec --skip-git-repo-check --sandbox read-only \
     "Review all commits in phase-1-runtime-complete..phase-2-approval-im-surface-complete \
      for boundary violations, regressions, P0/P1 risks. Plan: docs/superpowers/plans/2026-05-01-phase-2-approval-im-surface.md. \
      Output VERDICT + per-commit findings." \
     > docs/phase-2/codex-review-t24-integrated.md
   ```
4. **If GO**: add `phase-2-codex-reviewed` annotated tag at the same commit
   pointing at the verified-GO state; bump `package.json#version` from
   `0.1.0-phase2-draft` to `0.1.0-phase2`.
5. **If GO_WITH_LOW_NITS**: apply nits inline on a `phase-2-review-nits`
   branch; merge; then add the `phase-2-codex-reviewed` tag.
6. **If NO_GO**: open scope per the review report; do NOT promote
   `phase-2-draft` → `phase-2`. The implementation tag stays as-is for
   reference but the project is "in review fix" until the next round.

**Why low-risk to defer:**

- The high-judgment-bearing code (broker resolve, decision-mapper, render
  projection, actor binding) ALREADY went through Codex review and bug
  fixes (`231f653`, `7f6b6a1`).
- T18-T22 build on top of that reviewed surface — they're integration
  + tests + small protocol assertions, not new dangerous logic.
- All internal gates green: typecheck (9 packages strict), lint (143
  files clean), 720 tests pass + 1 skipped (Phase 1 baseline 320 → +400).
- F1 method-literal boundary held (T20 explicit allowlist).
- F13 channel-core boundary held (no runtime imports of core/codex-runtime/
  app-server-client; explicit boundary tests).
- Telegram Bot API constraints in fake have inline doc citations to the
  actual Bot API spec (not made up).

**What NOT to do:**

- Do NOT promote `package.json#version` to `0.1.0-phase2` until the
  integrated review returns GO.
- Do NOT delete the implementation tag `phase-2-approval-im-surface-complete`
  even if backfill review surfaces issues — fixes go in subsequent
  commits + a follow-up `phase-2-approval-im-surface-reviewed` tag.
