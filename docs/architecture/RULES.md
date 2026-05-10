# Architecture rules

Rules in this file are non-negotiable boundaries on how the code may
evolve. Each rule states when it took effect; the rule applies to every
slice from that date forward.

## R1. `daemon.ts` no-grow rule

**In effect from**: Slice 2 (after `0.1.0-alpha.1`, 2026-05-10).

**Rule**. New functionality, new policy logic, new capability-detection
code, and new security/approval logic **must not** be added to
`packages/daemon/src/daemon.ts`. Such code must live in a new module
under `packages/daemon/src/` (or in a separate package if the boundary
warrants it) and be invoked from `daemon.ts`. `daemon.ts` itself is
allowed to grow only with the minimal wiring needed to call into the
new module.

**Why**. At the start of Slice 2 `daemon.ts` is roughly 6,300 lines and
holds approval routing, capability detection, security policy
evaluation, render scheduling glue, IM adapter wiring, computer-use
arbitration, and shutdown lifecycle in one file. Continuing to grow
this file makes it progressively harder to:

- review changes (large unrelated diffs land in the same hunks);
- write narrowly-scoped tests (every test pulls the full `Daemon`
  surface);
- enforce architectural boundaries (the file already mixes concerns
  the layered architecture wants kept separate — see project root
  `CLAUDE.md` "必须坚持的架构").

**How to apply**.

- A pure bug fix that adds < 10 lines to `daemon.ts` to repair an
  existing code path is allowed.
- A behavior change that adds a new condition, rule, capability
  probe, or policy table is **not** allowed in `daemon.ts`. Add the
  new module, expose the smallest possible function, and have
  `daemon.ts` call into it.
- Refactor commits that move code out of `daemon.ts` are encouraged
  and not gated by this rule.

**Enforcement**. Code review at PR time. There is intentionally no
hard line-count gate at this stage — drift is detected by reviewer
judgement against this rule, not by an automated bisection.

**Slice 1 self-conformance**. Slice 1 (commits between
`refactor(docs): move process docs under docs/internal/` and
`docs(architecture): add ADR 0001-0004 + R1`) made no changes to
`daemon.ts` and added no lines.
