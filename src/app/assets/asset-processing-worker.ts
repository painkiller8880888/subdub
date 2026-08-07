import { AssetProcessingService } from "./asset-processing-service.js";
import type { AssetProcessingKey } from "./asset-repository.js";

export type AssetProcessingWorkerOptions = {
  service: AssetProcessingService;
  pollIntervalMs?: number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

export class AssetProcessingWorker {
  private readonly service: AssetProcessingService;
  private readonly pollIntervalMs: number;
  private readonly sleep: (
    milliseconds: number,
    signal: AbortSignal
  ) => Promise<void>;
  private readonly inProgress = new Set<string>();
  private readonly abortController = new AbortController();
  private running = false;
  private loopPromise: Promise<void> | undefined;

  constructor(options: AssetProcessingWorkerOptions) {
    this.service = options.service;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.sleep =
      options.sleep ??
      ((ms, signal) => {
        if (signal.aborted) {
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          }, ms);
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
        });
      });
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.abortController.abort();
    await this.loopPromise;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.processPendingOnce();
      } catch (error) {
        console.error("asset processing worker iteration failed", error);
      }
      if (this.running) {
        await this.sleep(this.pollIntervalMs, this.abortController.signal);
      }
    }
  }

  private keyOf(key: AssetProcessingKey): string {
    return `${key.assetId}:${key.version}`;
  }

  async processPendingOnce(): Promise<void> {
    const keys = await this.service.listProcessingAssetKeys();
    for (const key of keys) {
      const keyString = this.keyOf(key);
      if (this.inProgress.has(keyString)) {
        continue;
      }
      this.inProgress.add(keyString);
      try {
        await this.service.processAsset(key.assetId, key.version);
      } catch (error) {
        console.error(
          `asset processing failed unexpectedly for ${key.assetId} v${key.version}`,
          error
        );
      } finally {
        this.inProgress.delete(keyString);
      }
    }
  }
}
