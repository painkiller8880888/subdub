import { describe, expect, it, vi } from "vitest";

import { AssetProcessingWorker } from "../../src/app/assets/asset-processing-worker.js";
import type { AssetProcessingKey } from "../../src/app/assets/asset-repository.js";
import type { AssetProcessingService } from "../../src/app/assets/asset-processing-service.js";
import type { AssetProcessingOutcome } from "../../src/app/assets/asset-processing-service.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createServiceStub(keys: AssetProcessingKey[]) {
  const gate = deferred<void>();
  const calls: Array<[string, number]> = [];
  const service = {
    listProcessingAssetKeys: vi.fn(async () => keys),
    processAsset: vi.fn(
      async (
        assetId: string,
        version: number
      ): Promise<AssetProcessingOutcome> => {
        calls.push([assetId, version]);
        await gate.promise;
        return { status: "processed" };
      }
    )
  };
  return { service, gate, calls };
}

describe("asset processing worker", () => {
  it("processes each pending key exactly once per loop iteration", async () => {
    const keys: AssetProcessingKey[] = [
      { assetId: "asset-1", version: 1 },
      { assetId: "asset-2", version: 1 }
    ];
    const { service, gate } = createServiceStub(keys);
    const worker = new AssetProcessingWorker({
      service: service as unknown as AssetProcessingService,
      pollIntervalMs: 1
    });

    const iteration = worker.processPendingOnce();
    await delay(10);
    gate.resolve();
    await iteration;

    expect(service.listProcessingAssetKeys).toHaveBeenCalledOnce();
    expect(service.processAsset).toHaveBeenCalledTimes(2);
    expect(service.processAsset).toHaveBeenCalledWith("asset-1", 1);
    expect(service.processAsset).toHaveBeenCalledWith("asset-2", 1);
  });

  it("does not process a key twice when loop iterations overlap concurrently", async () => {
    const keys: AssetProcessingKey[] = [
      { assetId: "asset-1", version: 1 },
      { assetId: "asset-2", version: 1 }
    ];
    const { service, gate } = createServiceStub(keys);
    const worker = new AssetProcessingWorker({
      service: service as unknown as AssetProcessingService,
      pollIntervalMs: 1
    });

    const first = worker.processPendingOnce();
    const second = worker.processPendingOnce();
    await delay(10);
    gate.resolve();
    await Promise.all([first, second]);

    expect(service.processAsset).toHaveBeenCalledTimes(2);
    expect(service.processAsset).toHaveBeenCalledWith("asset-1", 1);
    expect(service.processAsset).toHaveBeenCalledWith("asset-2", 1);
  });

  it("continues to the next key when processing throws unexpectedly", async () => {
    const keys: AssetProcessingKey[] = [
      { assetId: "asset-boom", version: 1 },
      { assetId: "asset-ok", version: 1 }
    ];
    const gate = deferred<void>();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const service = {
      listProcessingAssetKeys: vi.fn(async () => keys),
      processAsset: vi.fn(async (assetId: string) => {
        if (assetId === "asset-boom") {
          throw new Error("boom");
        }
        await gate.promise;
        return { status: "processed" };
      })
    };
    const worker = new AssetProcessingWorker({
      service: service as unknown as AssetProcessingService,
      pollIntervalMs: 1
    });

    const iteration = worker.processPendingOnce();
    await delay(10);
    gate.resolve();
    await iteration;

    expect(service.processAsset).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("releases the in-progress guard even when processing throws", async () => {
    const keys: AssetProcessingKey[] = [
      { assetId: "asset-boom", version: 1 },
      { assetId: "asset-boom", version: 1 }
    ];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { service, gate } = createServiceStub(keys);
    service.processAsset.mockImplementation(async () => {
      await gate.promise;
      throw new Error("boom");
    });
    const worker = new AssetProcessingWorker({
      service: service as unknown as AssetProcessingService,
      pollIntervalMs: 1
    });

    const iteration = worker.processPendingOnce();
    await delay(10);
    gate.resolve();
    await iteration;

    expect(service.processAsset).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("stop() aborts an in-flight sleep promptly", async () => {
    let interruptedSleep: Promise<void> | undefined;
    const sleep = vi.fn((ms: number, signal: AbortSignal) => {
      interruptedSleep = new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
      return interruptedSleep;
    });
    const { service } = createServiceStub([]);
    const worker = new AssetProcessingWorker({
      service: service as unknown as AssetProcessingService,
      pollIntervalMs: 1_000,
      sleep: sleep as (ms: number, signal: AbortSignal) => Promise<void>
    });

    worker.start();
    await delay(10);
    expect(worker.isRunning).toBe(true);
    const stopPromise = worker.stop();
    await stopPromise;
    expect(worker.isRunning).toBe(false);
    expect(sleep).toHaveBeenCalled();
    expect(interruptedSleep).toBeDefined();
  });

  it("start() is idempotent and stop() when not running is a no-op", () => {
    const { service } = createServiceStub([]);
    const worker = new AssetProcessingWorker({
      service: service as unknown as AssetProcessingService,
      pollIntervalMs: 1
    });
    worker.start();
    worker.start();
    expect(worker.isRunning).toBe(true);
    void worker.stop();
    return worker.stop();
  });
});
