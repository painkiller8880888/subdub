import {
  normalizeRunLog,
  runLogSchema,
  type RenderJobKind,
  type CommonRenderRunLog
} from "../../schema/index.js";
import { RunLogStoreError } from "../run-log-store.js";
import { ProjectRepositoryError } from "../projects/project-repository.js";
import { RenderRunLogStoreError } from "./render-run-log-store.js";
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
  readonly runLogStore: RenderRunLogPersistencePort;
  readonly preflight: RenderPreflightServicePort;
  readonly outputStore: RenderOutputStorePort;
  readonly mp4Renderer: Mp4RendererPort;
  readonly thumbnailRenderer: ThumbnailRendererPort;
  readonly now?: () => Date;
};

export type RenderRunLogPersistencePort = {
  read(projectId: unknown, runId: unknown): Promise<unknown>;
  write(projectId: unknown, runLog: unknown): Promise<void>;
};

export type RenderJobWorkerPort = Pick<
  RenderJobWorker,
  "enqueue" | "start" | "stop"
>;

function asRenderLog(log: unknown): CommonRenderRunLog {
  const normalized = normalizeRunLog(log);
  if (normalized?.kind !== "render") {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.runLogReadFailed,
      500,
      "The render run is invalid."
    );
  }
  return normalized;
}

function asQueuedLog(log: unknown): CommonRenderRunLog {
  const renderLog = asRenderLog(log);
  if (renderLog.status !== "queued") {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.runLogReadFailed,
      500,
      "The render run is not queued."
    );
  }
  return renderLog;
}

function parseRenderLog(value: unknown): CommonRenderRunLog {
  const parsed = runLogSchema.parse(value);
  if (parsed.kind !== "render") {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.runLogReadFailed,
      500,
      "The render run is invalid."
    );
  }
  return parsed;
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
  if (error instanceof RunLogStoreError) {
    if (error.code === "RUN_LOG_NOT_FOUND") {
      return RENDER_JOB_ERROR_CODE.runNotFound;
    }
    if (
      error.code === "RUN_LOG_READ_FAILED" ||
      error.code === "RUN_LOG_INVALID" ||
      error.code === "RUN_LOG_PATH_INVALID"
    ) {
      return RENDER_JOB_ERROR_CODE.runLogReadFailed;
    }
    if (error.code === "RUN_LOG_WRITE_FAILED") {
      return RENDER_JOB_ERROR_CODE.runLogWriteFailed;
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
  private readonly runLogStore: RenderRunLogPersistencePort;
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
    let queuedLog: CommonRenderRunLog;
    try {
      queuedLog = asQueuedLog(
        await this.runLogStore.read(item.projectId, item.runId)
      );
    } catch (error) {
      console.error(
        "render job could not be loaded",
        normalizeFailureCode(error, item.kind)
      );
      return;
    }

    let runningLog: CommonRenderRunLog | undefined;
    let outputTarget: RenderOutputTarget | undefined;
    try {
      const queued = asQueuedLog(queuedLog);
      runningLog = parseRenderLog({
        ...queued,
        status: "running",
        startedAt: isoNow(this.now),
        finishedAt: null,
        outputs: [],
        errorCode: null
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
      const succeeded = parseRenderLog({
        ...runningLog,
        status: "succeeded",
        finishedAt: isoNow(this.now),
        outputs: [
          {
            path: `projects/${item.projectId}/${promotion.outputPath}`,
            checksum: promotion.outputChecksum.toLowerCase()
          }
        ],
        errorCode: null
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
    let current: CommonRenderRunLog;
    try {
      current = asRenderLog(
        await this.runLogStore.read(item.projectId, item.runId)
      );
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
    base: CommonRenderRunLog,
    errorCode: RenderJobErrorCode
  ): Promise<void> {
    if (base.status === "succeeded" || base.status === "failed") {
      return;
    }
    const failed = parseRenderLog({
      runId: base.runId,
      projectId: base.projectId,
      kind: "render",
      projectRevision: base.projectRevision,
      queuedAt: base.queuedAt,
      startedAt: base.status === "running" ? base.startedAt : null,
      finishedAt: isoNow(this.now),
      status: "failed",
      inputHash: base.inputHash,
      model: base.model,
      engine: base.engine,
      privacy: base.privacy,
      outputs: [],
      errorCode,
      renderKind: base.renderKind
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
