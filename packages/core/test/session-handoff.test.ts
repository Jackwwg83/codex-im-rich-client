import { describe, expect, it } from "vitest";
import { TeamOperatorPolicy, handoffSession } from "../src/index.js";
import type {
  SessionBindingInput,
  SessionBindingRepository,
  SessionRoute,
  SessionThreadBindingRecord,
  Target,
} from "../src/index.js";
import { SessionRouter } from "../src/session-router.js";

const SOURCE: Target = { platform: "telegram", chatId: "c-source" };
const DESTINATION: Target = { platform: "lark", chatId: "oc-destination" };
const OTHER_DESTINATION: Target = { platform: "dingtalk", chatId: "dt-other" };
const ACTOR = { kind: "im", platform: "telegram", userId: "u-alice" } as const;

class FakeBindingRepository implements SessionBindingRepository {
  readonly writes: Array<SessionBindingInput & { target: Target }> = [];
  readonly #records = new Map<string, SessionThreadBindingRecord>();

  upsert(input: SessionBindingInput & { target: Target }): SessionThreadBindingRecord {
    this.writes.push(input);
    const record: SessionThreadBindingRecord = {
      id: `tb_${this.writes.length}`,
      target: input.target,
      projectId: input.projectId,
      cwd: input.cwd,
      ...(input.codexThreadId !== undefined ? { codexThreadId: input.codexThreadId } : {}),
      ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
      ...(input.activeTurnId !== undefined ? { activeTurnId: input.activeTurnId } : {}),
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    };
    this.#records.set(JSON.stringify(input.target), record);
    return record;
  }

  findByTarget(target: Target): SessionThreadBindingRecord | undefined {
    return this.#records.get(JSON.stringify(target));
  }
}

function bindSource(router: SessionRouter): SessionRoute {
  return router.bind(SOURCE, {
    projectId: "web",
    cwd: "/repo/web",
    codexThreadId: "thread-source",
    defaultModel: "gpt-5.5",
    activeTurnId: "turn-active",
  });
}

function makePolicy(allowedTargets: readonly Target[]): TeamOperatorPolicy {
  return new TeamOperatorPolicy({
    operators: [
      {
        actor: ACTOR,
        roles: ["operator"],
        allowedProjectIds: ["web"],
        allowedTargets,
      },
    ],
  });
}

describe("session handoff (JAC-108)", () => {
  it("denies handoff when destination target is not policy-bound and performs no write", () => {
    const bindings = new FakeBindingRepository();
    const router = new SessionRouter({ bindings });
    bindSource(router);
    bindings.writes.length = 0;

    expect(
      handoffSession({
        router,
        operatorPolicy: makePolicy([SOURCE]),
        actor: ACTOR,
        fromTarget: SOURCE,
        toTarget: DESTINATION,
      }),
    ).toEqual({
      kind: "deny",
      reason: "destination_policy_denied",
      policyReason: "target_not_allowed",
    });
    expect(bindings.writes).toEqual([]);
  });

  it("copies a bound source route to destination through router.bind only after policy passes", () => {
    const bindings = new FakeBindingRepository();
    const router = new SessionRouter({ bindings });
    bindSource(router);
    bindings.writes.length = 0;

    expect(
      handoffSession({
        router,
        operatorPolicy: makePolicy([SOURCE, DESTINATION]),
        actor: ACTOR,
        fromTarget: SOURCE,
        toTarget: DESTINATION,
      }),
    ).toEqual({
      kind: "bound",
      route: {
        kind: "bound",
        target: DESTINATION,
        projectId: "web",
        cwd: "/repo/web",
        codexThreadId: "thread-source",
        defaultModel: "gpt-5.5",
        activeTurnId: "turn-active",
      },
    });
    expect(bindings.writes).toEqual([
      {
        target: DESTINATION,
        projectId: "web",
        cwd: "/repo/web",
        codexThreadId: "thread-source",
        defaultModel: "gpt-5.5",
        activeTurnId: "turn-active",
      },
    ]);
  });

  it("fails closed when the source target is unbound", () => {
    const bindings = new FakeBindingRepository();
    const router = new SessionRouter({ bindings });

    expect(
      handoffSession({
        router,
        operatorPolicy: makePolicy([SOURCE, DESTINATION]),
        actor: ACTOR,
        fromTarget: SOURCE,
        toTarget: DESTINATION,
      }),
    ).toEqual({ kind: "deny", reason: "source_unbound" });
    expect(bindings.writes).toEqual([]);
  });

  it("does not overwrite a conflicting destination binding", () => {
    const bindings = new FakeBindingRepository();
    const router = new SessionRouter({ bindings });
    bindSource(router);
    router.bind(DESTINATION, {
      projectId: "infra",
      cwd: "/repo/infra",
      codexThreadId: "thread-other",
    });
    bindings.writes.length = 0;

    expect(
      handoffSession({
        router,
        operatorPolicy: makePolicy([SOURCE, DESTINATION, OTHER_DESTINATION]),
        actor: ACTOR,
        fromTarget: SOURCE,
        toTarget: DESTINATION,
      }),
    ).toEqual({ kind: "deny", reason: "destination_already_bound" });
    expect(bindings.writes).toEqual([]);
  });
});
