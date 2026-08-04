import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AutosaveCoordinator,
  type AutosaveState
} from "../../src/web/brief-autosave.js";

describe("AutosaveCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(save: (draft: string) => Promise<void>) {
    const states: AutosaveState[] = [];
    const coordinator = new AutosaveCoordinator({
      debounceMs: 100,
      save,
      isConflict: (error) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "PROJECT_REVISION_CONFLICT",
      onStateChange: (state) => states.push(state)
    });
    return { coordinator, states };
  }

  it("debounces changes and emits saving then saved", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const { coordinator, states } = setup(save);

    coordinator.update("latest");
    await vi.advanceTimersByTimeAsync(99);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(save).toHaveBeenCalledWith("latest");
    expect(states.map((state) => state.status)).toEqual([
      "pending",
      "saving",
      "saved"
    ]);
    coordinator.dispose();
  });

  it("serializes saves and schedules the newest draft after an in-flight save", async () => {
    vi.useFakeTimers();
    let resolveFirst: (() => void) | undefined;
    const save = vi.fn(
      (draft: string) =>
        new Promise<void>((resolve) => {
          if (draft === "first") {
            resolveFirst = resolve;
          } else {
            resolve();
          }
        })
    );
    const { coordinator } = setup(save);

    coordinator.update("first");
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    coordinator.update("second");
    resolveFirst?.();
    await vi.runAllTimersAsync();

    expect(save.mock.calls.map(([draft]) => draft)).toEqual([
      "first",
      "second"
    ]);
    expect(save).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("keeps a failed draft for an explicit retry", async () => {
    vi.useFakeTimers();
    const save = vi
      .fn<(_: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    const { coordinator, states } = setup(save);

    coordinator.update("keep me");
    await vi.runAllTimersAsync();
    expect(states.at(-1)?.status).toBe("error");
    expect(save).toHaveBeenCalledTimes(1);

    coordinator.retry();
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("keep me");
    expect(states.at(-1)?.status).toBe("saved");
    coordinator.dispose();
  });

  it("blocks automatic retry after a revision conflict until reset", async () => {
    vi.useFakeTimers();
    const conflict = { code: "PROJECT_REVISION_CONFLICT" };
    const save = vi.fn().mockRejectedValue(conflict);
    const { coordinator, states } = setup(save);

    coordinator.update("draft");
    await vi.runAllTimersAsync();
    expect(states.at(-1)?.status).toBe("conflict");

    coordinator.update("new draft");
    coordinator.retry();
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);

    coordinator.reset();
    coordinator.update("after reload");
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.status).toBe("conflict");
    coordinator.dispose();
  });

  it("cleans up the pending debounce on dispose", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const { coordinator } = setup(save);
    coordinator.update("discarded");
    coordinator.dispose();
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();
  });
});
