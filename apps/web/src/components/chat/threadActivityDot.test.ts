import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveThreadActivityKind, threadActivityLabel } from "./threadActivityDot";

type Input = Pick<
  EnvironmentThreadShell,
  "hasPendingApprovals" | "hasPendingUserInput" | "runtime" | "latestRun"
>;

function thread(overrides: Partial<Input> = {}): Input {
  return {
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    runtime: null,
    latestRun: null,
    ...overrides,
  };
}

function runtime(
  status: NonNullable<Input["runtime"]>["status"],
  extra: Partial<NonNullable<Input["runtime"]>> = {},
): NonNullable<Input["runtime"]> {
  return {
    status,
    activeRunId: null,
    providerInstanceId: "claude" as NonNullable<Input["runtime"]>["providerInstanceId"],
    providerName: null,
    lastError: null,
    updatedAt: "2026-10-15T00:00:00.000Z",
    ...extra,
  };
}

function latestRun(status: NonNullable<Input["latestRun"]>["status"]): Input["latestRun"] {
  return {
    runId: "run-1" as NonNullable<Input["latestRun"]>["runId"],
    status,
    requestedAt: null,
    startedAt: null,
    completedAt: null,
    assistantMessageId: null,
  };
}

describe("resolveThreadActivityKind", () => {
  it("waits on the user before anything else, even mid-run", () => {
    expect(
      resolveThreadActivityKind(thread({ hasPendingApprovals: true, runtime: runtime("running") })),
    ).toBe("waiting");
    expect(resolveThreadActivityKind(thread({ hasPendingUserInput: true }))).toBe("waiting");
  });

  it("is busy while a turn is in flight or parked on background work", () => {
    expect(resolveThreadActivityKind(thread({ runtime: runtime("running") }))).toBe("busy");
    expect(resolveThreadActivityKind(thread({ runtime: runtime("preparing") }))).toBe("busy");
    expect(resolveThreadActivityKind(thread({ runtime: runtime("idle") }))).toBe("busy");
  });

  it("is broken when the latest turn failed", () => {
    const failed = thread({ runtime: runtime("failed", { lastErrorClass: "usage_limit" }) });
    expect(resolveThreadActivityKind(failed)).toBe("broken");
    expect(threadActivityLabel(failed)).toBe("Usage limit reached");
    expect(threadActivityLabel(thread({ runtime: runtime("failed") }))).toBe("Failed");
  });

  it("is done once the latest turn completed", () => {
    expect(
      resolveThreadActivityKind(
        thread({ runtime: runtime("completed"), latestRun: latestRun("completed") }),
      ),
    ).toBe("done");
  });

  it("is stale when nothing ran or the last turn never finished", () => {
    expect(resolveThreadActivityKind(thread())).toBe("stale");
    expect(
      resolveThreadActivityKind(
        thread({ runtime: runtime("interrupted"), latestRun: latestRun("interrupted") }),
      ),
    ).toBe("stale");
    expect(threadActivityLabel(thread({ latestRun: latestRun("cancelled") }))).toBe("No response");
  });
});
