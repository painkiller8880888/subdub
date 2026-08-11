import { createHash, randomUUID } from "node:crypto";

import {
  idSchema,
  renderJobKindSchema,
  renderRunLogSchema,
  type RenderAcceptedData,
  type RenderJobKind,
  type RenderRunLog
} from "../../schema/index.js";
import { RunLogStore, RunLogStoreError } from "../run-log-store.js";
import type { ManifestPreviewService } from "./manifest-preview-service.js";
import { RENDER_JOB_ERROR_CODE, RenderJobError } from "./render-job-errors.js";
import {
  RenderJobWorker,
  type RenderJobQueueItem,
  type RenderRunLogPersistencePort,
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
  createLazyMp4Renderer,
  createLazyThumbnailRenderer,
  type Mp4RendererPort,
  type ThumbnailRendererPort
} from "./renderers.js";
import type { ProjectRepository } from "../projects/project-repository.js";

export type RenderJobServiceOptions = {
  readonly workspaceRoot: string;
  readonly projectRepository: Pick<ProjectRepository, "read">;
  readonly manifestPreviewService?: Pick<ManifestPreviewService, "get">;
  readonly preflight?: RenderPreflightServicePort;
  readonly runLogStore?: RenderRunLogPersistencePort;
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

function inputHash(manifest: unknown, kind: RenderJobKind): string {
  return createHash("sha256")
    .update(JSON.stringify({ manifest, renderKind: kind }), "utf8")
    .digest("hex");
}

function failedPreflightCode(error: unknown): string {
  return error instanceof RenderJobError
    ? error.code
    : RENDER_JOB_ERROR_CODE.enqueueFailed;
}

function normalizeRunLogStoreError(error: unknown): RenderJobError | undefined {
  if (!(error instanceof RunLogStoreError)) {
    return undefined;
  }
  if (error.code === "RUN_LOG_NOT_FOUND") {
    return new RenderJobError(
      RENDER_JOB_ERROR_CODE.runNotFound,
      404,
      "The render run does not exist."
    );
  }
  if (error.code === "RUN_LOG_WRITE_FAILED") {
    return new RenderJobError(
      RENDER_JOB_ERROR_CODE.runLogWriteFailed,
      500,
      "The render run log could not be written."
    );
  }
  return new RenderJobError(
    RENDER_JOB_ERROR_CODE.runLogReadFailed,
    500,
    "The render run log could not be read."
  );
}

export class RenderJobService {
  private readonly projectRepository: Pick<ProjectRepository, "read">;
  private readonly runLogStore: RenderRunLogPersistencePort;
  private readonly preflight: RenderPreflightServicePort;
  private readonly worker: RenderJobWorkerPort;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: RenderJobServiceOptions) {
    this.projectRepository = options.projectRepository;
    this.runLogStore =
      options.runLogStore ??
      new RunLogStore({ workspaceRoot: options.workspaceRoot });
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
          options.thumbnailRenderer ??
          createLazyThumbnailRenderer({ workspaceRoot: options.workspaceRoot }),
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
    let rawLog: unknown;
    try {
      rawLog = await this.runLogStore.read(safeProject, safeRun);
    } catch (error) {
      throw normalizeRunLogStoreError(error) ?? error;
    }
    const parsed = renderRunLogSchema.safeParse(rawLog);
    if (!parsed.success) {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.runLogReadFailed,
        500,
        "The render run log is invalid."
      );
    }
    return parsed.data;
  }

  private async enqueue(
    projectId: unknown,
    kind: RenderJobKind
  ): Promise<RenderAcceptedData> {
    const safeProject = safeProjectId(projectId);
    const parsedKind = renderJobKindSchema.parse(kind);
    const project = await this.projectRepository.read(safeProject);
    const runIdResult = idSchema.safeParse(this.createId());
    if (!runIdResult.success) {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.runIdInvalid,
        500,
        "The render run ID could not be generated."
      );
    }
    const runId = runIdResult.data;

    let preflight: Awaited<ReturnType<RenderPreflightServicePort["validate"]>>;
    try {
      preflight = await this.preflight.validate(safeProject);
    } catch (error) {
      const failed = {
        runId,
        projectId: safeProject,
        kind: "render" as const,
        renderKind: parsedKind,
        projectRevision: project.revision,
        queuedAt: isoNow(this.now),
        startedAt: null,
        finishedAt: isoNow(this.now),
        status: "failed" as const,
        inputHash: inputHash(
          { projectRevision: project.revision, manifest: null },
          parsedKind
        ),
        model: null,
        engine: "Remotion",
        privacy: {
          execution: "local" as const,
          dataCollection: null,
          zdr: null,
          providerFallbacks: null
        },
        outputs: [],
        errorCode: failedPreflightCode(error)
      };
      try {
        await this.runLogStore.write(safeProject, failed);
      } catch {
        // Preserve the preflight error if the diagnostic write also fails.
      }
      throw error;
    }

    const queued = {
      runId,
      projectId: safeProject,
      kind: "render" as const,
      renderKind: parsedKind,
      projectRevision: preflight.project.revision,
      queuedAt: isoNow(this.now),
      startedAt: null,
      finishedAt: null,
      status: "queued" as const,
      inputHash: inputHash(preflight.manifest, parsedKind),
      model: null,
      engine: "Remotion",
      privacy: {
        execution: "local" as const,
        dataCollection: null,
        zdr: null,
        providerFallbacks: null
      },
      outputs: [],
      errorCode: null
    };
    try {
      await this.runLogStore.write(safeProject, queued);
    } catch (error) {
      throw normalizeRunLogStoreError(error) ?? error;
    }
    const item: RenderJobQueueItem = { projectId: safeProject, runId, kind };
    try {
      this.worker.enqueue(item);
    } catch {
      const failed = {
        ...queued,
        status: "failed",
        finishedAt: isoNow(this.now),
        startedAt: null,
        outputs: [],
        errorCode: RENDER_JOB_ERROR_CODE.enqueueFailed
      } as const;
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
