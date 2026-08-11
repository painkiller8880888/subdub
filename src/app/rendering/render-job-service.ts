import { randomUUID } from "node:crypto";

import {
  idSchema,
  renderJobKindSchema,
  renderRunLogSchema,
  type RenderAcceptedData,
  type RenderJobKind,
  type RenderRunLog
} from "../../schema/index.js";
import type { ManifestPreviewService } from "./manifest-preview-service.js";
import { RENDER_JOB_ERROR_CODE, RenderJobError } from "./render-job-errors.js";
import {
  RenderJobWorker,
  type RenderJobQueueItem,
  type RenderJobWorkerPort
} from "./render-job-worker.js";
import {
  RenderPreflightService,
  type RenderPreflightServicePort
} from "./render-preflight.js";
import {
  RenderOutputStore,
  type RenderOutputStorePort
} from "./render-output-store.js";
import {
  RenderRunLogStore,
  type RenderRunLogStorePort
} from "./render-run-log-store.js";
import {
  createLazyMp4Renderer,
  UnavailableThumbnailRenderer,
  type Mp4RendererPort,
  type ThumbnailRendererPort
} from "./renderers.js";
import type { ProjectRepository } from "../projects/project-repository.js";

export type RenderJobServiceOptions = {
  readonly workspaceRoot: string;
  readonly projectRepository: Pick<ProjectRepository, "read">;
  readonly manifestPreviewService?: Pick<ManifestPreviewService, "get">;
  readonly preflight?: RenderPreflightServicePort;
  readonly runLogStore?: RenderRunLogStorePort;
  readonly outputStore?: RenderOutputStorePort;
  readonly mp4Renderer?: Mp4RendererPort;
  readonly thumbnailRenderer?: ThumbnailRendererPort;
  readonly worker?: RenderJobWorkerPort;
  readonly createId?: () => string;
  readonly now?: () => Date;
};

export type RenderJobServicePort = Pick<
  RenderJobService,
  "enqueueMp4" | "enqueueThumbnail" | "getStatus"
>;

export type RenderJobLifecyclePort = RenderJobServicePort &
  Pick<RenderJobService, "start" | "stop">;

function safeProjectId(projectId: unknown): string {
  const result = idSchema.safeParse(projectId);
  if (!result.success) {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.projectIdInvalid,
      400,
      "The project ID is invalid."
    );
  }
  return result.data;
}

function safeRunId(runId: unknown): string {
  const result = idSchema.safeParse(runId);
  if (!result.success) {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.runIdInvalid,
      400,
      "The render run ID is invalid."
    );
  }
  return result.data;
}

function isoNow(now: () => Date): string {
  return now().toISOString();
}

export class RenderJobService {
  private readonly projectRepository: Pick<ProjectRepository, "read">;
  private readonly runLogStore: RenderRunLogStorePort;
  private readonly preflight: RenderPreflightServicePort;
  private readonly worker: RenderJobWorkerPort;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: RenderJobServiceOptions) {
    this.projectRepository = options.projectRepository;
    this.runLogStore =
      options.runLogStore ??
      new RenderRunLogStore({ workspaceRoot: options.workspaceRoot });
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());

    if (options.preflight !== undefined) {
      this.preflight = options.preflight;
    } else if (options.manifestPreviewService !== undefined) {
      this.preflight = new RenderPreflightService({
        projectRepository: this.projectRepository,
        manifestPreviewService: options.manifestPreviewService
      });
    } else {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.enqueueFailed,
        500,
        "Render preflight dependencies are not configured."
      );
    }

    if (options.worker !== undefined) {
      this.worker = options.worker;
    } else {
      const outputStore =
        options.outputStore ??
        new RenderOutputStore({ workspaceRoot: options.workspaceRoot });
      this.worker = new RenderJobWorker({
        runLogStore: this.runLogStore,
        preflight: this.preflight,
        outputStore,
        mp4Renderer:
          options.mp4Renderer ??
          createLazyMp4Renderer({ workspaceRoot: options.workspaceRoot }),
        thumbnailRenderer:
          options.thumbnailRenderer ?? new UnavailableThumbnailRenderer(),
        now: this.now
      });
    }
  }

  start(): void {
    this.worker.start();
  }

  async stop(): Promise<void> {
    await this.worker.stop();
  }

  async enqueueMp4(projectId: unknown): Promise<RenderAcceptedData> {
    return this.enqueue(projectId, "mp4");
  }

  async enqueueThumbnail(projectId: unknown): Promise<RenderAcceptedData> {
    return this.enqueue(projectId, "thumbnail");
  }

  async getStatus(projectId: unknown, runId: unknown): Promise<RenderRunLog> {
    const safeProject = safeProjectId(projectId);
    const safeRun = safeRunId(runId);
    await this.projectRepository.read(safeProject);
    return this.runLogStore.read(safeProject, safeRun);
  }

  private async enqueue(
    projectId: unknown,
    kind: RenderJobKind
  ): Promise<RenderAcceptedData> {
    const safeProject = safeProjectId(projectId);
    const parsedKind = renderJobKindSchema.parse(kind);
    const preflight = await this.preflight.validate(safeProject);
    const runIdResult = idSchema.safeParse(this.createId());
    if (!runIdResult.success) {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.runIdInvalid,
        500,
        "The render run ID could not be generated."
      );
    }
    const runId = runIdResult.data;
    const queued = renderRunLogSchema.parse({
      runId,
      projectId: safeProject,
      kind: parsedKind,
      projectRevision: preflight.project.revision,
      queuedAt: isoNow(this.now),
      status: "queued",
      startedAt: null,
      completedAt: null
    });
    await this.runLogStore.write(safeProject, queued);
    const item: RenderJobQueueItem = { projectId: safeProject, runId, kind };
    try {
      this.worker.enqueue(item);
    } catch {
      const failed = renderRunLogSchema.parse({
        ...queued,
        status: "failed",
        completedAt: isoNow(this.now),
        errorCode: RENDER_JOB_ERROR_CODE.enqueueFailed
      });
      try {
        await this.runLogStore.write(safeProject, failed);
      } catch {
        // Preserve the original enqueue failure for the HTTP response.
      }
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.enqueueFailed,
        500,
        "The render job could not be enqueued."
      );
    }
    return { runId, status: "queued", kind };
  }
}
