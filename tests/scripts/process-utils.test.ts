import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { stopChildProcess } from "../../scripts/process-utils.mjs";

class FakeChild extends EventEmitter {
  readonly pid = 5101;
  readonly exitCode = null;
  readonly signalCode = null;
  readonly kill = vi.fn(() => true);
}

describe("process utilities", () => {
  it("waits for a non-Windows child to exit after SIGTERM", async () => {
    const child = new FakeChild();
    let resolved = false;
    const stopping = stopChildProcess(child, {
      platform: "linux",
      timeoutMs: 100
    }).then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(resolved).toBe(false);

    child.emit("exit", 0, null);
    await stopping;
    expect(resolved).toBe(true);
  });

  it("bounds the wait when a non-Windows child ignores SIGTERM", async () => {
    const child = new FakeChild();
    const startedAt = Date.now();

    await stopChildProcess(child, { platform: "linux", timeoutMs: 10 });

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
