import {
  renderRunLogSchema,
  type RenderJobKind,
  type RenderRunLog,
  type RenderRunLogQueued
} from "../../schema/index.js";
import { ProjectRepositoryError } from "../projects/project-repository.js";
import {
  RenderRunLogStoreError,
  type RenderRunLogStorePort
} from "./render-run-log-store.js";
import {
  RENDER_JOB_ERROR_CODE,
  RenderJobError,
  type RenderJobErrorCode
} from "./render-job-errors.js";
import type { RenderPreflightServicePort } from "./render-preflight.js";
import type {
  RenderOutputStorePort,
  RenderOutputTarget
} from "./render-output-store.js";
import type { Mp4RendererPort, ThumbnailRendererPort } from "./renderers.js";

export type RenderJobQueueItem = {
  readonly projectId: string;
  readonly runId: string;
  readonly kind: RenderJobKind;
};

export type RenderJobWorkerOptions = {
  readonly runLogStore: RenderRunLogStorePort;
  readonly preflight: RenderPreflightServicePort;
  readonly outputStore: RenderOutputStorePort;
  readonly mp4Renderer: Mp4RendererPort;
  readonly thumbnailRenderer: ThumbnailRendererPort;
  readonly now?: () => Date;
};

export type RenderJobWorkerPort = Pick<
  RenderJobWorker,
  "enqueue" | "start" | "stop"
>;

function asQueuedLog(log: RenderRunLog): RenderRunLogQueued {
  if (log.status !== "queued") {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.runLogReadFailed,
      500,
      "The render run is not queued."
    );
  }
  return log;
}

function normalizeFailureCode(
  error: unknown,
  kind: RenderJobKind
): RenderJobErrorCode {
  if (error instanceof RenderJobError) {
    return error.code;
  }
  if (error instanceof RenderRunLogStoreError) {
    if (error.code === "RENDER_RUN_NOT_FOUND") {
      return RENDER_JOB_ERROR_CODE.runNotFound;
    }
    if (error.code === "RENDER_RUN_LOG_READ_FAILED") {
      return RENDER_JOB_ERROR_CODE.runLogReadFailed;
    }
    if (error.code === "RENDER_RUN_LOG_WRITE_FAILED") {
      return RENDER_JOB_ERROR_CODE.runLogWriteFailed;
    }
    if (
      error.code === "RENDER_RUN_LOG_INVALID" ||
      error.code === "RENDER_RUN_LOG_PATH_INVALID"
    ) {
      return RENDER_JOB_ERROR_CODE.runLogReadFailed;
    }
  }
  if (error instanceof ProjectRepositoryError) {
    if (error.code === "PROJECT_NOT_FOUND") {
      return RENDER_JOB_ERROR_CODE.projectNotFound;
    }
    if (error.code === "PROJECT_ID_INVALID") {
      return RENDER_JOB_ERROR_CODE.projectIdInvalid;
    }
  }
  return kind === "mp4"
    ? RENDER_JOB_ERROR_CODE.mp4RenderFailed
    : RENDER_JOB_ERROR_CODE.thumbnailRenderFailed;
}

function isoNow(now: () => Date): string {
  return now().toISOString();
}

export class RenderJobWorker implements RenderJobWorkerPort {
  private readonly runLogStore: RenderRunLogStorePort;
  private readonly preflight: RenderPreflightServicePort;
  private readonly outputStore: RenderOutputStorePort;
  private readonly mp4Renderer: Mp4RendererPort;
  private readonly thumbnailRenderer: ThumbnailRendererPort;
  private readonly now: () => Date;
  private readonly queue: RenderJobQueueItem[] = [];
  private readonly queuedKeys = new Set<string>();
  private running = false;
  private pumpPromise: Promise<void> | undefined;

  constructor(options: RenderJobWorkerOptions) {
    this.runLogStore = options.runLogStore;
    this.preflight = options.preflight;
    this.outputStore = options.outputStore;
    this.mp4Renderer = options.mp4Renderer;
    this.thumbnailRenderer = options.thumbnailRenderer;
    this.now = options.now ?? (() => new Date());
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.kick();
  }

  enqueue(item: RenderJobQueueItem): void {
    const key = this.keyOf(item);
    if (this.queuedKeys.has(key)) {
      return;
    }
    this.queuedKeys.add(key);
    this.queue.push(item);
    this.kick();
  }

  async stop(): Promise<void> {
    this.running = false;
    const pending = this.queue.splice(0);
    for (const item of pending) {
      this.queuedKeys.delete(this.keyOf(item));
      await this.failQueuedItem(item, RENDER_JOB_ERROR_CODE.workerStopped);
    }
    await this.pumpPromise;
  }

  private kick(): void {
    if (!this.running || this.pumpPromise !== undefined) {
      return;
    }
    this.pumpPromise = this.processQueue().finally(() => {
      this.pumpPromise = undefined;
      if (this.running && this.queue.length > 0) {
        this.kick();
      }
    });
  }

  private async processQueue(): Promise<void> {
    while (this.running) {
      const item = this.queue.shift();
      if (item === undefined) {
        return;
      }
      await this.processItem(item);
      this.queuedKeys.delete(this.keyOf(item));
    }
  }

  private async processItem(item: RenderJobQueueItem): Promise<void> {
    let queuedLog: RenderRunLog;
    try {
      queuedLog = await this.runLogStore.read(item.projectId, item.runId);
      asQueuedLog(queuedLog);
    } catch (error) {
      console.error(
        "render job could not be loaded",
        normalizeFailureCode(error, item.kind)
      );
      return;
    }

    let runningLog: RenderRunLog | undefined;
    let outputTarget: RenderOutputTarget | undefined;
    try {
      const queued = asQueuedLog(queuedLog);
      runningLog = renderRunLogSchema.parse({
        ...queued,
        status: "running",
        startedAt: isoNow(this.now),
        completedAt: null
      });
      await this.runLogStore.write(item.projectId, runningLog);

      const preflight = await this.preflight.validate(item.projectId);
      if (preflight.project.revision !== queued.projectRevision) {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.manifestStale,
          422,
          "The project changed after the render was queued."
        );
      }
      outputTarget = await this.outputStore.prepare(
        item.projectId,
        item.kind,
        item.runId
      );
      const renderer =
        item.kind === "mp4" ? this.mp4Renderer : this.thumbnailRenderer;
      await renderer.render({
        projectId: item.projectId,
        runId: item.runId,
        project: preflight.project,
        manifest: preflight.manifest,
        outputPath: outputTarget.temporaryPath
      });
      if (!this.running) {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.workerStopped,
          500,
          "The render worker stopped before promotion."
        );
      }
      const promotion = await this.outputStore.promote(outputTarget);
      const succeeded = renderRunLogSchema.parse({
        ...runningLog,
        status: "succeeded",
        completedAt: isoNow(this.now),
        outputPath: promotion.outputPath,
        outputChecksum: promotion.outputChecksum
      });
      await this.runLogStore.write(item.projectId, succeeded);
    } catch (error) {
      try {
        await this.outputStore.cleanup(outputTarget);
      } catch {
        // Cleanup must not replace the normalized render failure.
      }
      const errorCode = normalizeFailureCode(error, item.kind);
      const base = runningLog ?? queuedLog;
      await this.persistFailure(item, base, errorCode);
    }
  }

  private async failQueuedItem(
    item: RenderJobQueueItem,
    errorCode: RenderJobErrorCode
  ): Promise<void> {
    let current: RenderRunLog;
    try {
      current = await this.runLogStore.read(item.projectId, item.runId);
    } catch (error) {
      console.error(
        "queued render job could not be stopped",
        normalizeFailureCode(error, item.kind)
      );
      return;
    }
    if (current.status !== "queued") {
      return;
    }
    await this.persistFailure(item, current, errorCode);
  }

  private async persistFailure(
    item: RenderJobQueueItem,
    base: RenderRunLog,
    errorCode: RenderJobErrorCode
  ): Promise<void> {
    if (base.status === "succeeded" || base.status === "failed") {
      return;
    }
    const failed = renderRunLogSchema.parse({
      runId: base.runId,
      projectId: base.projectId,
      kind: base.kind,
      projectRevision: base.projectRevision,
      queuedAt: base.queuedAt,
      status: "failed",
      startedAt: base.status === "running" ? base.startedAt : null,
      completedAt: isoNow(this.now),
      errorCode
    });
    try {
      await this.runLogStore.write(item.projectId, failed);
    } catch (error) {
      console.error(
        "render job failure could not be persisted",
        normalizeFailureCode(error, item.kind)
      );
    }
  }

  private keyOf(item: RenderJobQueueItem): string {
    return `${item.projectId}\u0000${item.runId}`;
  }
}
