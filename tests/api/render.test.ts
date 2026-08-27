import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/api/app.js";
import {
  RENDER_JOB_ERROR_CODE,
  RenderJobError
} from "../../src/app/rendering/render-job-errors.js";
import { RenderJobService } from "../../src/app/rendering/render-job-service.js";
import type { RenderRendererInput } from "../../src/app/rendering/renderers.js";
import {
  previewRenderAcceptedResponseSchema,
  renderAcceptedResponseSchema,
  renderRunStatusResponseSchema
} from "../../src/schema/api.js";
import {
  renderManifestSchema,
  type RenderRunLog,
  videoProjectSchema
} from "../../src/schema/index.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const projectId = "manual-video-project";
const project = videoProjectSchema.parse(videoProjectFixture);
const manifest = renderManifestSchema.parse(renderManifestFixture);

let temporaryRoot: string | undefined;

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value?: T): void;
} {
  let resolvePromise!: (value?: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = (value?: T) => resolve(value as T);
  });
  return { promise, resolve: resolvePromise };
}

async function createRoot(): Promise<string> {
  temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "subdub-render-api-")
  );
  await fs.mkdir(path.join(temporaryRoot, "projects", projectId), {
    recursive: true
  });
  return temporaryRoot;
}

async function removeRoot(): Promise<void> {
  if (temporaryRoot !== undefined) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
}

describe("render API", () => {
  afterEach(removeRoot);

  it("returns 202 before a deferred MP4 renderer completes", async () => {
    const root = await createRoot();
    const started = deferred<void>();
    const release = deferred<void>();
    const renderer = {
      render: vi.fn(async (input: RenderRendererInput) => {
        started.resolve();
        await release.promise;
        await fs.writeFile(input.outputPath, "async mp4");
      })
    };
    const service = new RenderJobService({
      workspaceRoot: root,
      projectRepository: { read: vi.fn(async () => project) },
      preflight: { validate: vi.fn(async () => ({ project, manifest })) },
      mp4Renderer: renderer,
      thumbnailRenderer: renderer,
      createId: () => "api-run-1"
    });
    const app = buildApp({ renderJobService: service });
    service.start();

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/render`
    });
    expect(response.statusCode).toBe(202);
    expect(renderAcceptedResponseSchema.parse(response.json())).toEqual({
      data: { runId: "api-run-1", status: "queued", kind: "mp4" }
    });

    await started.promise;
    expect(renderer.render).toHaveBeenCalledTimes(1);
    release.resolve();
    await service.stop();
    await app.close();
  });

  it("returns the same accepted contract for thumbnail jobs", async () => {
    const service = {
      enqueueMp4: vi.fn(async () => ({
        runId: "mp4-run",
        status: "queued" as const,
        kind: "mp4" as const
      })),
      enqueueThumbnail: vi.fn(async () => ({
        runId: "thumbnail-run",
        status: "queued" as const,
        kind: "thumbnail" as const
      })),
      getStatus: vi.fn(async () => {
        throw new Error("not used");
      })
    };
    const app = buildApp({ renderJobService: service });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/thumbnail/render`
    });

    expect(response.statusCode).toBe(202);
    expect(renderAcceptedResponseSchema.parse(response.json())).toEqual({
      data: { runId: "thumbnail-run", status: "queued", kind: "thumbnail" }
    });
    expect(service.enqueueThumbnail).toHaveBeenCalledWith(projectId);
    await app.close();
  });

  it("accepts a fixed preview preset through the preview render boundary", async () => {
    const service = {
      enqueueMp4: vi.fn(async () => ({
        runId: "mp4-run",
        status: "queued" as const,
        kind: "mp4" as const
      })),
      enqueueThumbnail: vi.fn(async () => ({
        runId: "thumbnail-run",
        status: "queued" as const,
        kind: "thumbnail" as const
      })),
      enqueuePreview: vi.fn(
        async (_projectId: unknown, previewPreset: unknown) => ({
          runId: "preview-run",
          status: "queued" as const,
          kind: "preview" as const,
          previewPreset: previewPreset as "sd" | "hd" | "fhd"
        })
      ),
      getStatus: vi.fn(async () => {
        throw new Error("not used");
      })
    };
    const app = buildApp({ renderJobService: service });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/preview/render`,
      payload: { previewPreset: "fhd" }
    });

    expect(response.statusCode).toBe(202);
    expect(previewRenderAcceptedResponseSchema.parse(response.json())).toEqual({
      data: {
        runId: "preview-run",
        status: "queued",
        kind: "preview",
        previewPreset: "fhd"
      }
    });
    expect(service.enqueuePreview).toHaveBeenCalledWith(projectId, "fhd");
    await app.close();
  });

  it("validates status responses and maps unknown projects, runs, and ids", async () => {
    const succeeded: RenderRunLog = {
      runId: "run-1",
      projectId,
      kind: "mp4",
      projectRevision: 0,
      queuedAt: "2026-08-11T00:00:00.000Z",
      status: "succeeded",
      startedAt: "2026-08-11T00:00:01.000Z",
      completedAt: "2026-08-11T00:00:02.000Z",
      outputPath: "output/render-run-1.mp4",
      outputChecksum: "a".repeat(64)
    };
    const service = {
      enqueueMp4: vi.fn(async () => {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.projectNotFound,
          404,
          "The project does not exist."
        );
      }),
      enqueueThumbnail: vi.fn(async () => ({
        runId: "thumbnail-run",
        status: "queued" as const,
        kind: "thumbnail" as const
      })),
      getStatus: vi.fn(async (_projectId: unknown, runId: unknown) => {
        if (runId === "missing-run") {
          throw new RenderJobError(
            RENDER_JOB_ERROR_CODE.runNotFound,
            404,
            "The render run does not exist."
          );
        }
        return succeeded;
      })
    };
    const app = buildApp({ renderJobService: service });

    const statusResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/render/run-1`
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(renderRunStatusResponseSchema.parse(statusResponse.json())).toEqual({
      data: succeeded
    });

    const missingRun = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/render/missing-run`
    });
    expect(missingRun.statusCode).toBe(404);
    expect(missingRun.json().error.code).toBe("RENDER_RUN_NOT_FOUND");

    const unknownProject = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/render`
    });
    expect(unknownProject.statusCode).toBe(404);
    expect(unknownProject.json().error.code).toBe("RENDER_PROJECT_NOT_FOUND");

    const invalidId = await app.inject({
      method: "GET",
      url: "/api/projects/INVALID/render/run-1"
    });
    expect(invalidId.statusCode).toBe(422);
    expect(invalidId.json().error.code).toBe("REQUEST_VALIDATION_FAILED");
    await app.close();
  });
});
