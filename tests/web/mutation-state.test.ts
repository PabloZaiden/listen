import { describe, expect, test } from "bun:test";
import { createMutationGate, mutationErrorMessage, runExclusiveMutation } from "../../src/web/mutation-state";

describe("mutation state", () => {
  test("releases a successful mutation after local reconciliation", async () => {
    const gate = createMutationGate();
    let refreshed = false;

    const result = await runExclusiveMutation(gate, "notifications:delete", async () => {
      refreshed = true;
      return { deletedCount: 1 };
    });

    expect(result).toEqual({ started: true, value: { deletedCount: 1 } });
    expect(refreshed).toBe(true);
    expect(gate.isActive("notifications:delete")).toBe(false);
  });

  test("releases a rejected mutation so the caller can retry", async () => {
    const gate = createMutationGate();
    const failure = new Error("request failed");

    await expect(runExclusiveMutation(gate, "source:delete", async () => {
      throw failure;
    })).rejects.toBe(failure);

    expect(gate.isActive("source:delete")).toBe(false);
  });

  test("does not start a duplicate mutation while the first is pending", async () => {
    const gate = createMutationGate();
    let resolveFirst: (() => void) | undefined;
    let calls = 0;
    const first = runExclusiveMutation(gate, "notifications:delete", () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
    });

    const duplicate = await runExclusiveMutation(gate, "notifications:delete", async () => {
      calls += 1;
    });

    expect(duplicate).toEqual({ started: false });
    expect(calls).toBe(1);
    resolveFirst?.();
    await first;
    expect(gate.isActive("notifications:delete")).toBe(false);
  });

  test("uses a safe fallback for unknown errors", () => {
    expect(mutationErrorMessage(new Error("network failed"))).toBe("network failed");
    expect(mutationErrorMessage({ reason: "unknown" }, "Try again later.")).toBe("Try again later.");
  });
});
