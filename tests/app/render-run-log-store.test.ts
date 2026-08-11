import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RenderRunLogStore,
  RenderRunLogStoreError
} from "../../src/app/rendering/render-run-log-store.js";
import { renderRunLogSchema } from "../../src/schema/index.js";

const projectId = "project-1";
const runId = "run-1";
const queuedLog = {
  runId,
  projectId,
  kind: "mp4" as const,
  projectRevision: 3,
  queuedAt: "2026-08-11T00:00:00.000Z",
  status: "queued" as const,
  startedAt: null,
  completedAt: null
};

let temporaryRoot: string | undefined;

async function createRoot(): Promise<string> {
  temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "subdub-render-run-log-")
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

describe("RenderRunLogStore", () => {
  afterEach(removeRoot);

  it("persists schema-valid state transitions with atomic temporary files", async () => {
    const root = await createRoot();
    const store = new RenderRunLogStore({
      workspaceRoot: root,
      createId: () => "tmp-1"
    });

    await store.write(projectId, queuedLog);
    await store.write(projectId, {
      ...queuedLog,
      status: "running",
      startedAt: "2026-08-11T00:00:01.000Z"
    });
    await store.write(projectId, {
      ...queuedLog,
      status: "succeeded",
      startedAt: "2026-08-11T00:00:01.000Z",
      completedAt: "2026-08-11T00:00:02.000Z",
      outputPath: "output/render-run-1.mp4",
      outputChecksum: "a".repeat(64)
    });

    const logPath = path.join(
      root,
      "projects",
      projectId,
      "runs",
      `${runId}.json`
    );
    const parsed = renderRunLogSchema.parse(
      JSON.parse(await fs.readFile(logPath, "utf8"))
    );
    expect(parsed.status).toBe("succeeded");
    expect(
      await fs.readdir(path.dirname(logPath), { withFileTypes: true })
    ).toEqual([expect.objectContaining({ name: `${runId}.json` })]);
    await expect(store.read(projectId, runId)).resolves.toEqual(parsed);
  });

  it("rejects invalid ids and missing runs without exposing filesystem paths", async () => {
    const root = await createRoot();
    const store = new RenderRunLogStore({ workspaceRoot: root });

    await expect(store.read("bad/id", runId)).rejects.toMatchObject({
      code: "RENDER_PROJECT_ID_INVALID",
      status: 400
    });
    await expect(store.read(projectId, "bad/id")).rejects.toMatchObject({
      code: "RENDER_RUN_ID_INVALID",
      status: 400
    });
    await expect(store.read(projectId, "missing-run")).rejects.toBeInstanceOf(
      RenderRunLogStoreError
    );
    await expect(store.read(projectId, "missing-run")).rejects.toMatchObject({
      code: "RENDER_RUN_NOT_FOUND",
      status: 404
    });
  });
});
