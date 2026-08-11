import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { RenderJobService } from "../../src/app/rendering/render-job-service.js";
import { RenderJobWorker } from "../../src/app/rendering/render-job-worker.js";
import {
  RENDER_JOB_ERROR_CODE,
  RenderJobError
} from "../../src/app/rendering/render-job-errors.js";
import { RenderOutputStore } from "../../src/app/rendering/render-output-store.js";
import { RenderRunLogStore } from "../../src/app/rendering/render-run-log-store.js";
import { RunLogStore } from "../../src/app/run-log-store.js";
import type {
  Mp4RendererPort,
  RenderRendererInput,
  ThumbnailRendererPort
} from "../../src/app/rendering/renderers.js";
import {
  renderManifestSchema,
  runLogSchema,
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

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean
): Promise<T> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const value = await read();
    if (predicate(value)) {
      return value;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}

async function createRoot(): Promise<string> {
  temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "subdub-render-job-")
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

function createPreflight() {
  return {
    validate: vi.fn(async () => ({ project, manifest }))
  };
}

function createRenderer(
  render: (input: RenderRendererInput) => Promise<void>
): Mp4RendererPort & ThumbnailRendererPort {
  return { render };
}

function createService(
  root: string,
  renderer: Mp4RendererPort & ThumbnailRendererPort,
  ids: readonly string[]
): RenderJobService {
  let idIndex = 0;
  return new RenderJobService({
    workspaceRoot: root,
    projectRepository: {
      read: vi.fn(async () => project)
    },
    preflight: createPreflight(),
    mp4Renderer: renderer,
    thumbnailRenderer: renderer,
    createId: () => ids[idIndex++] ?? `run-${idIndex}`
  });
}

async function writeQueuedLog(
  store: RenderRunLogStore,
  runId: string,
  kind: "mp4" | "thumbnail" = "mp4"
): Promise<void> {
  await store.write(projectId, {
    runId,
    projectId,
    kind,
    projectRevision: project.revision,
    queuedAt: "2026-08-11T00:00:00.000Z",
    status: "queued",
    startedAt: null,
    completedAt: null
  });
}

describe("RenderJobWorker and RenderJobService", () => {
  afterEach(removeRoot);

  it("persists a failed run when preflight rejects an otherwise valid request", async () => {
    const root = await createRoot();
    const service = new RenderJobService({
      workspaceRoot: root,
      projectRepository: { read: vi.fn(async () => project) },
      preflight: {
        validate: vi.fn(async () => {
          throw new RenderJobError(
            RENDER_JOB_ERROR_CODE.sourceAssetMissing,
            422,
            "the asset is missing"
          );
        })
      },
      worker: {
        enqueue: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(async () => undefined)
      },
      createId: () => "preflight-failed"
    });

    await expect(service.enqueueMp4(projectId)).rejects.toMatchObject({
      code: RENDER_JOB_ERROR_CODE.sourceAssetMissing
    });
    await expect(
      new RunLogStore({ workspaceRoot: root }).read(
        projectId,
        "preflight-failed"
      )
    ).resolves.toMatchObject({
      kind: "render",
      status: "failed",
      errorCode: RENDER_JOB_ERROR_CODE.sourceAssetMissing,
      outputs: []
    });
  });

  it("exposes queued before starting the worker, then records running and succeeded", async () => {
    const root = await createRoot();
    const started = deferred<void>();
    const release = deferred<void>();
    const renderer = createRenderer(async (input) => {
      started.resolve();
      await release.promise;
      await fs.writeFile(input.outputPath, "rendered mp4");
    });
    const service = createService(root, renderer, ["run-1"]);

    const accepted = await service.enqueueMp4(projectId);
    expect(accepted).toEqual({
      runId: "run-1",
      status: "queued",
      kind: "mp4"
    });
    await expect(service.getStatus(projectId, "run-1")).resolves.toMatchObject({
      status: "queued",
      projectRevision: project.revision
    });

    service.start();
    await started.promise;
    await expect(service.getStatus(projectId, "run-1")).resolves.toMatchObject({
      status: "running"
    });

    release.resolve();
    const terminal = await waitFor(
      () => service.getStatus(projectId, "run-1"),
      (status) => status.status === "succeeded" || status.status === "failed"
    );
    expect(terminal).toMatchObject({ status: "succeeded" });
    const succeeded = terminal;
    expect(succeeded).toMatchObject({
      status: "succeeded",
      outputPath: "output/render-run-1.mp4"
    });
    if (succeeded.status !== "succeeded") {
      throw new Error("expected a succeeded render run");
    }
    expect(succeeded.outputChecksum).toBe(
      createHash("sha256").update("rendered mp4").digest("hex")
    );
    const persisted = runLogSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(root, "projects", projectId, "runs", "run-1.json"),
          "utf8"
        )
      )
    );
    expect(persisted).toMatchObject({
      kind: "render",
      renderKind: "mp4",
      engine: "Remotion",
      status: "succeeded",
      outputs: [
        {
          path: "projects/manual-video-project/output/render-run-1.mp4",
          checksum: succeeded.outputChecksum
        }
      ]
    });
    await expect(
      fs.readFile(
        path.join(root, "projects", projectId, succeeded.outputPath),
        "utf8"
      )
    ).resolves.toBe("rendered mp4");
    await service.stop();
  });

  it("normalizes renderer failures and preserves an earlier successful output", async () => {
    const root = await createRoot();
    const outputRoot = path.join(root, "projects", projectId, "output");
    await fs.mkdir(outputRoot, { recursive: true });
    const previousPath = path.join(outputRoot, "render-previous-run.mp4");
    await fs.writeFile(previousPath, "previous successful output");
    const previousChecksum = createHash("sha256")
      .update("previous successful output")
      .digest("hex");
    const renderer = createRenderer(async (input) => {
      await fs.writeFile(input.outputPath, "partial failed output");
      throw new Error("renderer details stay out of the API");
    });
    const service = createService(root, renderer, ["failed-run"]);

    service.start();
    await service.enqueueMp4(projectId);
    const failed = await waitFor(
      () => service.getStatus(projectId, "failed-run"),
      (status) => status.status === "failed"
    );
    expect(failed).toMatchObject({
      status: "failed",
      errorCode: "MP4_RENDER_FAILED"
    });
    expect(failed).not.toHaveProperty("outputPath");
    expect(failed).not.toHaveProperty("outputChecksum");
    await expect(fs.readFile(previousPath, "utf8")).resolves.toBe(
      "previous successful output"
    );
    expect(
      createHash("sha256")
        .update(await fs.readFile(previousPath))
        .digest("hex")
    ).toBe(previousChecksum);
    await expect(fs.readdir(outputRoot)).resolves.toEqual([
      "render-previous-run.mp4"
    ]);
    await service.stop();
  });

  it("runs thumbnail jobs through the thumbnail port and normalizes its failure", async () => {
    const root = await createRoot();
    const renderer = createRenderer(async () => {
      throw new Error("not used for thumbnail");
    });
    const thumbnailRenderer: ThumbnailRendererPort = {
      render: async () => {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.thumbnailRenderFailed,
          500,
          "thumbnail renderer is not installed"
        );
      }
    };
    const service = new RenderJobService({
      workspaceRoot: root,
      projectRepository: { read: vi.fn(async () => project) },
      preflight: createPreflight(),
      mp4Renderer: renderer,
      thumbnailRenderer,
      createId: () => "thumbnail-run"
    });

    service.start();
    await service.enqueueThumbnail(projectId);
    await expect(
      waitFor(
        () => service.getStatus(projectId, "thumbnail-run"),
        (status) => status.status === "failed"
      )
    ).resolves.toMatchObject({
      status: "failed",
      errorCode: "THUMBNAIL_RENDER_FAILED"
    });
    await service.stop();
  });

  it("processes multiple jobs FIFO and does not execute a duplicate queue item", async () => {
    const root = await createRoot();
    const runLogStore = new RenderRunLogStore({ workspaceRoot: root });
    await writeQueuedLog(runLogStore, "run-a");
    await writeQueuedLog(runLogStore, "run-b");
    const calls: string[] = [];
    const renderer = createRenderer(async (input) => {
      calls.push(input.runId);
      await fs.writeFile(input.outputPath, input.runId);
    });
    const worker = new RenderJobWorker({
      runLogStore,
      preflight: createPreflight(),
      outputStore: new RenderOutputStore({ workspaceRoot: root }),
      mp4Renderer: renderer,
      thumbnailRenderer: renderer
    });

    worker.enqueue({ projectId, runId: "run-a", kind: "mp4" });
    worker.enqueue({ projectId, runId: "run-a", kind: "mp4" });
    worker.enqueue({ projectId, runId: "run-b", kind: "mp4" });
    worker.start();
    const terminal = await waitFor(
      () => runLogStore.read(projectId, "run-b"),
      (status) => status.status === "succeeded" || status.status === "failed"
    );
    expect(terminal).toMatchObject({ status: "succeeded" });

    expect(calls).toEqual(["run-a", "run-b"]);
    await worker.stop();
  });

  it("marks queued and running jobs failed during stop without succeeding either", async () => {
    const root = await createRoot();
    const runLogStore = new RenderRunLogStore({ workspaceRoot: root });
    await writeQueuedLog(runLogStore, "run-a");
    await writeQueuedLog(runLogStore, "run-b");
    const started = deferred<void>();
    const release = deferred<void>();
    const calls: string[] = [];
    const renderer = createRenderer(async (input) => {
      calls.push(input.runId);
      started.resolve();
      await release.promise;
      await fs.writeFile(input.outputPath, "should be cleaned");
    });
    const worker = new RenderJobWorker({
      runLogStore,
      preflight: createPreflight(),
      outputStore: new RenderOutputStore({ workspaceRoot: root }),
      mp4Renderer: renderer,
      thumbnailRenderer: renderer
    });

    worker.enqueue({ projectId, runId: "run-a", kind: "mp4" });
    worker.enqueue({ projectId, runId: "run-b", kind: "mp4" });
    worker.start();
    await started.promise;
    const stopping = worker.stop();
    release.resolve();
    await stopping;

    await expect(runLogStore.read(projectId, "run-a")).resolves.toMatchObject({
      status: "failed",
      errorCode: "RENDER_WORKER_STOPPED"
    });
    await expect(runLogStore.read(projectId, "run-b")).resolves.toMatchObject({
      status: "failed",
      errorCode: "RENDER_WORKER_STOPPED"
    });
    expect(calls).toEqual(["run-a"]);
  });
});
