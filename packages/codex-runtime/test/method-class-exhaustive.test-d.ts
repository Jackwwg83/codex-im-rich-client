// T6 (Phase 1, Codex outside-voice B5): type-level exhaustiveness
// guard for METHOD_CLASS.
//
// This file's filename ends in `.test-d.ts`. It is loaded by
// `tsc -p tsconfig.test.json --noEmit` (ci-check.sh step 3/8 added in
// T5 codex-review fix) and never executed at runtime — vitest's unit
// project explicitly includes only `*.test.ts`.
//
// What it asserts (compile-time only):
//   1. METHOD_CLASS's `satisfies` against
//      Record<ServerNotification["method"], EventClass> already enforces
//      key/value correctness. This test makes the invariant readable.
//   2. keyof typeof METHOD_CLASS === ServerNotification["method"] —
//      both directions must hold so isServerNotificationMethod can
//      derive its narrowing predicate from Object.hasOwn(METHOD_CLASS, m)
//      without silently dropping arms.

import type { ServerNotification } from "@codex-im/protocol";
import type { METHOD_CLASS } from "../src/event-class.js";
import type { EventClass } from "../src/types.js";

// Bidirectional set equality on keys.
type _MethodClassDomain = keyof typeof METHOD_CLASS;
type _ServerNotificationMethods = ServerNotification["method"];

// 1. Every key in METHOD_CLASS must be a real ServerNotification method.
//    (Catches typos / stale entries after a codex upgrade renames an arm.)
type _NoExtras = _MethodClassDomain extends _ServerNotificationMethods ? true : never;
const _noExtrasAssert: _NoExtras = true;
void _noExtrasAssert;

// 2. Every ServerNotification method must have a METHOD_CLASS entry.
//    (Catches new arms from a codex upgrade — the maintainer must
//    decide lifecycle vs delta before the narrowing helper accepts the
//    new method.)
type _NoMissing = _ServerNotificationMethods extends _MethodClassDomain ? true : never;
const _noMissingAssert: _NoMissing = true;
void _noMissingAssert;

// 3. Every METHOD_CLASS value must be EventClass. (The `satisfies` clause
//    on the const declaration already enforces this; restating here for
//    documentation.)
type _Values = (typeof METHOD_CLASS)[_MethodClassDomain];
type _ValuesAreEventClass = _Values extends EventClass ? true : never;
const _valuesAssert: _ValuesAreEventClass = true;
void _valuesAssert;

// (T6 codex-review #3 removed a fourth assertion — _FakeWouldFail —
// because it only fired when the protocol union literally widened to
// `string` or gained the literal "future/never/seen" arm. The realistic
// drift modes are covered by NoExtras + NoMissing above.)
