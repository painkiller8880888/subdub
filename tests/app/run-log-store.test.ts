import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunLogStore, RunLogStoreError } from "../../src/app/run-log-store.js";
import { runLogSchema } from "../../src/schema/index.js";

const projectId = "project-1";
const hash = "b".repeat(64);
const timestamp = "2026-08-11T00:00:00.000Z";
const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "subdub-run-log-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

function aiLog(
  status: "running" | "succeeded",
  options: { readonly runId?: string; readonly projectId?: string } = {}
) {
  return {
    runId: options.runId ?? "run-1",
    kind: "ai" as const,
    projectId: options.projectId ?? projectId,
    projectRevision: 1,
    queuedAt: timestamp,
    startedAt: timestamp,
    finishedAt: status === "succeeded" ? timestamp : null,
    status,
    inputHash: hash,
    model: "fixture/model",
    engine: null,
    privacy: {
      execution: "external" as const,
      dataCollection: "deny" as const,
      zdr: true,
      providerFallbacks: true
    },
    outputs: status === "succeeded" ? [{ checksum: hash }] : [],
    errorCode: null,
    taskKind: "outline_generation" as const,
    sourceHash: hash,
    modelId: "fixture/model",
    modelSelectionSource: "default" as const,
    responseModel: "fixture/model",
    provider: "fixture",
    zdr: true,
    dataCollection: "deny" as const,
    providerFallbacks: true as const,
    responseTimeMs: 1,
    httpAttemptCount: 1,
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    costCredits: null,
    schemaValidation:
      status === "succeeded" ? ("passed" as const) : ("not_run" as const),
    imageInput: false,
    tools: false
  };
}

describe("RunLogStore", () => {
  it("returns an empty list when the runs directory is missing", async () => {
    const root = await createRoot();
    await fs.mkdir(path.join(root, "projects", projectId), {
      recursive: true
    });

    const store = new RunLogStore({ workspaceRoot: root });

    await expect(store.list(projectId)).resolves.toEqual([]);
  });

  it("lists current and legacy AI logs in stable filename order", async () => {
    const root = await createRoot();
    const runsPath = path.join(root, "projects", projectId, "runs");
    await fs.mkdir(runsPath, { recursive: true });
    await fs.writeFile(
      path.join(runsPath, "z-current.json"),
      JSON.stringify(aiLog("succeeded", { runId: "z-current" })),
      "utf8"
    );
    await fs.writeFile(
      path.join(runsPath, "a-legacy.json"),
      JSON.stringify({
        runId: "a-legacy",
        kind: "ai",
        taskKind: "outline_generation",
        projectId,
        startRevision: 1,
        sourceHash: hash,
        inputHash: hash,
        startedAt: timestamp,
        completedAt: timestamp,
        status: "succeeded",
        modelId: "fixture/model",
        modelSelectionSource: "default",
        responseModel: "fixture/model",
        provider: "fixture",
        zdr: true,
        dataCollection: "deny",
        providerFallbacks: true,
        responseTimeMs: 1,
        httpAttemptCount: 1,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        schemaValidation: "passed",
        outputChecksum: hash,
        errorCode: null,
        imageInput: false,
        tools: false
      }),
      "utf8"
    );
    await fs.writeFile(path.join(runsPath, "notes.txt"), "ignored", "utf8");
    await fs.writeFile(
      path.join(runsPath, ".z-current.token.tmp"),
      "ignored",
      "utf8"
    );

    const store = new RunLogStore({ workspaceRoot: root });

    await expect(store.list(projectId)).resolves.toMatchObject([
      { runId: "a-legacy", kind: "ai" },
      { runId: "z-current", kind: "ai" }
    ]);
  });

  it("does not silently accept invalid JSON or a filename ID mismatch", async () => {
    const invalidJsonRoot = await createRoot();
    const invalidJsonRunsPath = path.join(
      invalidJsonRoot,
      "projects",
      projectId,
      "runs"
    );
    await fs.mkdir(invalidJsonRunsPath, { recursive: true });
    await fs.writeFile(
      path.join(invalidJsonRunsPath, "broken.json"),
      "{broken",
      "utf8"
    );
    await expect(
      new RunLogStore({ workspaceRoot: invalidJsonRoot }).list(projectId)
    ).rejects.toMatchObject({ code: "RUN_LOG_INVALID" });

    const mismatchRoot = await createRoot();
    const mismatchRunsPath = path.join(
      mismatchRoot,
      "projects",
      projectId,
      "runs"
    );
    await fs.mkdir(mismatchRunsPath, { recursive: true });
    await fs.writeFile(
      path.join(mismatchRunsPath, "filename-id.json"),
      JSON.stringify(aiLog("succeeded", { runId: "json-id" })),
      "utf8"
    );
    await expect(
      new RunLogStore({ workspaceRoot: mismatchRoot }).list(projectId)
    ).rejects.toMatchObject({ code: "RUN_LOG_INVALID" });
  });

  it("rejects a run file symlink that resolves outside the workspace", async () => {
    const root = await createRoot();
    const runsPath = path.join(root, "projects", projectId, "runs");
    const outsidePath = path.join(root, "outside.json");
    await fs.mkdir(runsPath, { recursive: true });
    await fs.writeFile(
      outsidePath,
      JSON.stringify(aiLog("succeeded", { runId: "run-1" })),
      "utf8"
    );
    try {
      await fs.symlink(outsidePath, path.join(runsPath, "run-1.json"));
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
        return;
      }
      throw error;
    }

    await expect(
      new RunLogStore({ workspaceRoot: root }).list(projectId)
    ).rejects.toMatchObject({ code: "RUN_LOG_PATH_INVALID" });
  });

  it("atomically overwrites common logs and leaves no temporary file", async () => {
    const root = await createRoot();
    const store = new RunLogStore({
      workspaceRoot: root,
      createId: () => "temporary-token"
    });

    await store.write(projectId, aiLog("running"));
    await store.write(projectId, aiLog("succeeded"));

    const filePath = path.join(
      root,
      "projects",
      projectId,
      "runs",
      "run-1.json"
    );
    const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    expect(runLogSchema.parse(raw)).toMatchObject({
      status: "succeeded",
      kind: "ai",
      outputs: [{ checksum: hash }]
    });
    expect(await fs.readdir(path.dirname(filePath))).toEqual(["run-1.json"]);
  });

  it("normalizes legacy AI and render files on read", async () => {
    const root = await createRoot();
    const runsPath = path.join(root, "projects", projectId, "runs");
    await fs.mkdir(runsPath, { recursive: true });
    await fs.writeFile(
      path.join(runsPath, "legacy-ai.json"),
      JSON.stringify({
        runId: "legacy-ai",
        kind: "ai",
        taskKind: "outline_generation",
        projectId,
        startRevision: 1,
        sourceHash: hash,
        inputHash: hash,
        startedAt: timestamp,
        completedAt: timestamp,
        status: "succeeded",
        modelId: "fixture/model",
        modelSelectionSource: "default",
        responseModel: "fixture/model",
        provider: "fixture",
        zdr: true,
        dataCollection: "deny",
        providerFallbacks: true,
        responseTimeMs: 1,
        httpAttemptCount: 1,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        schemaValidation: "passed",
        outputChecksum: hash,
        errorCode: null,
        imageInput: false,
        tools: false
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(runsPath, "legacy-render.json"),
      JSON.stringify({
        runId: "legacy-render",
        projectId,
        kind: "mp4",
        projectRevision: 1,
        queuedAt: timestamp,
        status: "succeeded",
        startedAt: timestamp,
        completedAt: timestamp,
        outputPath: "output/render.mp4",
        outputChecksum: hash.toUpperCase()
      }),
      "utf8"
    );

    const store = new RunLogStore({ workspaceRoot: root });
    await expect(store.read(projectId, "legacy-render")).resolves.toMatchObject(
      {
        kind: "render",
        inputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        outputs: [
          {
            path: `projects/${projectId}/output/render.mp4`,
            checksum: hash
          }
        ]
      }
    );
    await expect(store.read(projectId, "legacy-ai")).resolves.toMatchObject({
      kind: "ai",
      projectRevision: 1,
      outputs: [{ checksum: hash }]
    });
  });

  it("rejects mismatched IDs and preserves the original write failure while cleaning up", async () => {
    const root = await createRoot();
    const cleaned: string[] = [];
    const store = new RunLogStore({
      workspaceRoot: root,
      fileSystem: {
        writeFile: async () => {
          const error = new Error("sentinel secret");
          Object.assign(error, { code: "EIO" });
          throw error;
        },
        unlink: async (filePath) => {
          cleaned.push(filePath);
        }
      }
    });
    await expect(
      store.write(projectId, aiLog("running"), "other-run")
    ).rejects.toMatchObject({ code: "RUN_LOG_INVALID" });
    await expect(
      store.write(projectId, aiLog("running"))
    ).rejects.toBeInstanceOf(RunLogStoreError);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]).not.toContain("sentinel secret");
  });
});
