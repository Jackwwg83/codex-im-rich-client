import { describe, expect, it } from "vitest";
import { MutationRateLimit } from "../src/rate-limit.js";

const ACTOR = { userId: "u-alice" } as const;
const ACTOR_B = { userId: "u-bob" } as const;
const TARGET = { platform: "telegram", chatId: "-1001" } as const;
const TARGET_B = { platform: "telegram", chatId: "-2002" } as const;

function makeClock(initial = 1_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let t = initial;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

describe("MutationRateLimit", () => {
  it("allows the first request", () => {
    const clock = makeClock();
    const rl = new MutationRateLimit({ clock: clock.now });
    expect(rl.check(ACTOR, TARGET)).toEqual({ kind: "allow" });
  });

  it("allows up to maxRequests in the window and denies the next one", () => {
    const clock = makeClock();
    const rl = new MutationRateLimit({ clock: clock.now, maxRequests: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      expect(rl.check(ACTOR, TARGET).kind).toBe("allow");
    }
    const deny = rl.check(ACTOR, TARGET);
    expect(deny.kind).toBe("deny");
    if (deny.kind === "deny") {
      expect(deny.limit).toBe(3);
      expect(deny.retryAfterMs).toBeGreaterThan(0);
      expect(deny.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("does not consume a slot when denying (a denied request stays denied until the window slides)", () => {
    const clock = makeClock();
    const rl = new MutationRateLimit({ clock: clock.now, maxRequests: 2, windowMs: 60_000 });
    expect(rl.check(ACTOR, TARGET).kind).toBe("allow");
    expect(rl.check(ACTOR, TARGET).kind).toBe("allow");
    expect(rl.check(ACTOR, TARGET).kind).toBe("deny");
    // Time hasn't moved; another check should still deny, not slide.
    expect(rl.check(ACTOR, TARGET).kind).toBe("deny");
  });

  it("recovers once the window slides past the oldest timestamp", () => {
    const clock = makeClock();
    const rl = new MutationRateLimit({ clock: clock.now, maxRequests: 2, windowMs: 60_000 });
    rl.check(ACTOR, TARGET);
    clock.advance(20_000);
    rl.check(ACTOR, TARGET);
    expect(rl.check(ACTOR, TARGET).kind).toBe("deny");

    // Advance just past the window for the FIRST request only.
    clock.advance(40_001);
    expect(rl.check(ACTOR, TARGET).kind).toBe("allow");
  });

  it("isolates buckets by actor (different user, same chat is independent)", () => {
    const clock = makeClock();
    const rl = new MutationRateLimit({ clock: clock.now, maxRequests: 2 });
    rl.check(ACTOR, TARGET);
    rl.check(ACTOR, TARGET);
    expect(rl.check(ACTOR, TARGET).kind).toBe("deny");
    // Bob in the same chat is unaffected.
    expect(rl.check(ACTOR_B, TARGET).kind).toBe("allow");
    expect(rl.check(ACTOR_B, TARGET).kind).toBe("allow");
  });

  it("isolates buckets by target (same user, different chat is independent)", () => {
    const clock = makeClock();
    const rl = new MutationRateLimit({ clock: clock.now, maxRequests: 2 });
    rl.check(ACTOR, TARGET);
    rl.check(ACTOR, TARGET);
    expect(rl.check(ACTOR, TARGET).kind).toBe("deny");
    // Same actor in a different chat is unaffected.
    expect(rl.check(ACTOR, TARGET_B).kind).toBe("allow");
    expect(rl.check(ACTOR, TARGET_B).kind).toBe("allow");
  });

  it("isolates buckets by platform (same userId on different platform is independent)", () => {
    const clock = makeClock();
    const rl = new MutationRateLimit({ clock: clock.now, maxRequests: 1 });
    rl.check(ACTOR, TARGET);
    expect(rl.check(ACTOR, TARGET).kind).toBe("deny");
    expect(rl.check(ACTOR, { platform: "lark", chatId: TARGET.chatId }).kind).toBe("allow");
  });

  it("retryAfterMs is the gap until the oldest in-window timestamp ages out", () => {
    const clock = makeClock();
    const rl = new MutationRateLimit({ clock: clock.now, maxRequests: 1, windowMs: 60_000 });
    rl.check(ACTOR, TARGET); // recorded at t=1_000_000
    clock.advance(15_000); // now t=1_015_000
    const deny = rl.check(ACTOR, TARGET);
    expect(deny.kind).toBe("deny");
    if (deny.kind === "deny") {
      // Oldest is at 1_000_000, window 60s → expires at 1_060_000. Now
      // is 1_015_000, so retryAfter ≈ 45_000.
      expect(deny.retryAfterMs).toBe(45_000);
    }
  });

  it("uses sane defaults (10 req / 60_000 ms)", () => {
    const clock = makeClock();
    const rl = new MutationRateLimit({ clock: clock.now });
    for (let i = 0; i < 10; i++) {
      expect(rl.check(ACTOR, TARGET).kind).toBe("allow");
    }
    expect(rl.check(ACTOR, TARGET).kind).toBe("deny");
  });

  it("prune drops fully-expired buckets", () => {
    const clock = makeClock();
    const rl = new MutationRateLimit({ clock: clock.now, maxRequests: 2, windowMs: 60_000 });
    rl.check(ACTOR, TARGET);
    rl.check(ACTOR_B, TARGET);
    expect(rl.size()).toBe(2);
    clock.advance(60_001);
    rl.prune();
    expect(rl.size()).toBe(0);
  });

  it("prune trims partial buckets without dropping live entries", () => {
    const clock = makeClock();
    const rl = new MutationRateLimit({ clock: clock.now, maxRequests: 5, windowMs: 60_000 });
    rl.check(ACTOR, TARGET); // t=1_000_000
    clock.advance(30_000);
    rl.check(ACTOR, TARGET); // t=1_030_000
    clock.advance(30_001); // t=1_060_001 → first entry just expired
    rl.prune();
    // Bucket should still exist but with only the t=1_030_000 entry left.
    expect(rl.size()).toBe(1);
    // After a further 30s, only the t=1_030_000 entry's clock will be 31s in.
    // That's still inside its window — one more allow should still work.
    expect(rl.check(ACTOR, TARGET).kind).toBe("allow");
  });
});
