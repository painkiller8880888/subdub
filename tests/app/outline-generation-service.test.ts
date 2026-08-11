import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { OutlineGenerationService } from "../../src/app/projects/outline-generation-service.js";
import { ImprovementLogRepository } from "../../src/app/projects/improvement-log-repository.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import { OpenRouterAdapterError } from "../../src/openrouter/errors.js";
import { OpenRouterChatAdapter } from "../../src/openrouter/chat-adapter.js";
import { aiRunLogSchema } from "../../src/schema/index.js";

const NOW = new Date("2026-08-04T02:00:00.000Z");

function model(contextLength = 131072, id = "google/gemma-4-31b-it") {
  return {
    id,
    displayName: "Fixture Model",
    contextLength,
    inputPrice: "0",
    outputPrice: "0",
    outputModalities: ["text"],
    supportedParameters: ["structured_outputs"],
    expirationDate: null,
    structuredOutputs: true,
    zdrAvailable: true
  } as const;
}

function candidate() {
  return {
    openQuestions: [{ question: "未確認の前提は何か。" }],
    sections: [
      {
        role: "intro",
        title: "前提",
        overview: "前提を説明する。",
        keyPoints: ["前提"],
        targetDurationSec: 10,
        sourceRefs: [{ headingPath: ["概要"] }],
        openQuestions: []
      },
      {
        role: "main",
        title: "手順",
        overview: "手順を説明する。",
        keyPoints: ["手順"],
        targetDurationSec: 20,
        sourceRefs: [{ headingPath: ["概要", "手順"] }],
        openQuestions: [{ question: "例外条件を確認する。" }]
      },
      {
        role: "outro",
        title: "確認",
        overview: "確認方法を説明する。",
        keyPoints: ["確認"],
        targetDurationSec: 10,
        sourceRefs: [{ headingPath: ["確認"] }],
        openQuestions: []
      }
    ]
  };
}

async function setupProject() {
  const workspaceRoot = await fs.mkdtemp(
    path.join(tmpdir(), "subdub-outline-generation-")
  );
  await fs.mkdir(path.join(workspaceRoot, "projects"));
  const repository = new ProjectRepository({
    workspaceRoot,
    now: () => NOW
  });
  const created = await repository.create(
    createEmptyVideoProject({
      projectId: "outline-generation-project",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    })
  );
  await repository.saveSource(
    created.metadata.id,
    "# 概要\n\n## 手順\n本文\n\n# 確認\n確認本文",
    0
  );
  const saved = await repository.saveBrief(
    created.metadata.id,
    { ...created.brief, audience: "担当者" },
    1
  );
  return { workspaceRoot, repository, project: saved };
}

function fakeChat(candidateValue: unknown, costCredits?: number) {
  return {
    complete: vi.fn(async () => ({
      candidate: candidateValue,
      responseModel: "provider/model",
      provider: "Fixture Provider",
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        ...(costCredits === undefined ? {} : { costCredits })
      },
      attempts: 1
    }))
  };
}

describe("OutlineGenerationService", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("saves a backend-owned needs_review outline and an AI run log", async () => {
    const { workspaceRoot, repository, project } = await setupProject();
    roots.push(workspaceRoot);
    const chat = fakeChat(candidate(), 0.125);
    const modelService = {
      listModels: vi.fn(async () => ({
        models: [model()],
        fetchedAt: NOW.toISOString(),
        cached: false
      }))
    };
    const service = new OutlineGenerationService({
      repository,
      modelService,
      chatAdapter: chat,
      now: () => NOW,
      createId: () => "run-outline-success"
    });

    const result = await service.generate(project.metadata.id, {
      expectedRevision: project.revision
    });

    expect(result.revision).toBe(project.revision + 1);
    expect(result.outline.status).toBe("needs_review");
    expect(result.outline.sourceHash).toBe(result.source.sha256);
    expect(result.outline.generationRunId).toBe("run-outline-success");
    expect(result.outline.sections.map((section) => section.role)).toEqual([
      "intro",
      "main",
      "outro"
    ]);
    expect(result.outline.sections.map((section) => section.order)).toEqual([
      1, 2, 3
    ]);
    expect(result.outline.sections[0]?.sourceRefs[0]?.sourceId).toBe(
      result.source.id
    );
    expect(result.outline.sections[0]?.humanDirectives).toEqual({
      requiredItems: [],
      prohibitedItems: [],
      scriptConstraints: []
    });
    expect(result.outline.openQuestions[0]).toMatchObject({
      status: "open",
      resolution: null
    });

    const rawRunLog = await fs.readFile(
      path.join(
        workspaceRoot,
        "projects",
        project.metadata.id,
        "runs",
        "run-outline-success.json"
      ),
      "utf8"
    );
    const runLog = aiRunLogSchema.parse(JSON.parse(rawRunLog));
    expect(runLog).toMatchObject({
      status: "succeeded",
      modelId: "google/gemma-4-31b-it",
      modelSelectionSource: "default",
      responseModel: "provider/model",
      provider: "Fixture Provider",
      schemaValidation: "passed",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      costCredits: 0.125,
      imageInput: false,
      tools: false
    });
    expect(rawRunLog).not.toContain("本文");
    expect(rawRunLog).not.toContain("OPENROUTER_API_KEY");
  });

  it("stores a successful outline candidate only after the project save", async () => {
    const { workspaceRoot, repository, project } = await setupProject();
    roots.push(workspaceRoot);
    await fs.mkdir(path.join(workspaceRoot, "library"), { recursive: true });
    const database = await initializeWorkspaceDatabase({ workspaceRoot });
    const improvementLogRepository = new ImprovementLogRepository(
      database.database
    );
    const service = new OutlineGenerationService({
      repository,
      modelService: {
        listModels: async () => ({
          models: [model()],
          fetchedAt: NOW.toISOString(),
          cached: false
        })
      },
      chatAdapter: fakeChat(candidate()),
      now: () => NOW,
      createId: () => "run-outline-candidate",
      improvementLogRepository
    });

    try {
      const saved = await service.generate(project.metadata.id, {
        expectedRevision: project.revision
      });
      const candidates =
        await improvementLogRepository.listGenerationCandidates(
          project.metadata.id
        );
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        generationRunId: "run-outline-candidate",
        projectRevision: saved.revision,
        taskKind: "outline_generation",
        targetKind: "outline",
        candidateKey: "outline",
        modelId: "google/gemma-4-31b-it",
        responseModel: "provider/model",
        promptVersion: "1.0.0"
      });
    } finally {
      database.close();
    }
  });

  it("does not change outline or revision for invalid order and preserves a failed log", async () => {
    const { workspaceRoot, repository, project } = await setupProject();
    roots.push(workspaceRoot);
    const before = await fs.readFile(
      path.join(workspaceRoot, "projects", project.metadata.id, "project.json")
    );
    const invalid = candidate();
    invalid.sections[0].role = "main";
    const service = new OutlineGenerationService({
      repository,
      modelService: {
        listModels: async () => ({
          models: [model()],
          fetchedAt: NOW.toISOString(),
          cached: false
        })
      },
      chatAdapter: fakeChat(invalid),
      now: () => NOW,
      createId: () => "run-outline-invalid"
    });

    await expect(
      service.generate(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).rejects.toMatchObject({ code: "OUTLINE_GENERATION_ORDER_INVALID" });
    const after = await fs.readFile(
      path.join(workspaceRoot, "projects", project.metadata.id, "project.json")
    );
    expect(after).toEqual(before);
    const runLog = aiRunLogSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(
            workspaceRoot,
            "projects",
            project.metadata.id,
            "runs",
            "run-outline-invalid.json"
          ),
          "utf8"
        )
      )
    );
    expect(runLog).toMatchObject({
      status: "failed",
      errorCode: "OUTLINE_GENERATION_ORDER_INVALID",
      schemaValidation: "failed"
    });
  });

  it("writes a running log before chat and finalizes it after a successful save", async () => {
    const { workspaceRoot, repository, project } = await setupProject();
    roots.push(workspaceRoot);
    const chat = {
      complete: vi.fn(async () => {
        const running = aiRunLogSchema.parse(
          JSON.parse(
            await fs.readFile(
              path.join(
                workspaceRoot,
                "projects",
                project.metadata.id,
                "runs",
                "run-outline-running.json"
              ),
              "utf8"
            )
          )
        );
        expect(running.status).toBe("running");
        expect(running.completedAt).toBeNull();
        return {
          candidate: candidate(),
          responseModel: "provider/model",
          provider: "Provider",
          usage: {
            promptTokens: null,
            completionTokens: null,
            totalTokens: null
          },
          attempts: 1
        };
      })
    };
    const service = new OutlineGenerationService({
      repository,
      modelService: {
        listModels: async () => ({
          models: [model()],
          fetchedAt: NOW.toISOString(),
          cached: false
        })
      },
      chatAdapter: chat,
      now: () => NOW,
      createId: () => "run-outline-running"
    });

    await service.generate(project.metadata.id, {
      expectedRevision: project.revision
    });
    const final = aiRunLogSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(
            workspaceRoot,
            "projects",
            project.metadata.id,
            "runs",
            "run-outline-running.json"
          ),
          "utf8"
        )
      )
    );
    expect(final.status).toBe("succeeded");
    expect(final.completedAt).toBe(NOW.toISOString());
  });

  it("records retry attempts when the OpenRouter call fails", async () => {
    const { workspaceRoot, repository, project } = await setupProject();
    roots.push(workspaceRoot);
    const service = new OutlineGenerationService({
      repository,
      modelService: {
        listModels: async () => ({
          models: [model()],
          fetchedAt: NOW.toISOString(),
          cached: false
        })
      },
      chatAdapter: {
        complete: async () => {
          throw new OpenRouterAdapterError("OPENROUTER_UNAVAILABLE", {
            upstreamStatus: 503,
            attempts: 3
          });
        }
      },
      now: () => NOW,
      createId: () => "run-outline-retries"
    });

    await expect(
      service.generate(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).rejects.toMatchObject({ attempts: 3 });
    const runLog = aiRunLogSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(
            workspaceRoot,
            "projects",
            project.metadata.id,
            "runs",
            "run-outline-retries.json"
          ),
          "utf8"
        )
      )
    );
    expect(runLog).toMatchObject({
      status: "failed",
      errorCode: "OPENROUTER_UNAVAILABLE",
      httpAttemptCount: 3
    });
  });

  it("does not save partial content from an embedded provider error", async () => {
    const { workspaceRoot, repository, project } = await setupProject();
    roots.push(workspaceRoot);
    const before = await fs.readFile(
      path.join(workspaceRoot, "projects", project.metadata.id, "project.json")
    );
    const chatAdapter = new OpenRouterChatAdapter({
      apiKey: "fixture-key",
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              model: "provider/model",
              choices: [
                {
                  finish_reason: "error",
                  message: { content: '{"sections":[]}' },
                  error: {
                    code: 502,
                    metadata: { error_type: "provider_unavailable" }
                  }
                }
              ]
            }),
            { status: 200 }
          )
      ) as unknown as typeof globalThis.fetch,
      sleep: async () => undefined
    });
    const service = new OutlineGenerationService({
      repository,
      modelService: {
        listModels: async () => ({
          models: [model()],
          fetchedAt: NOW.toISOString(),
          cached: false
        })
      },
      chatAdapter,
      now: () => NOW,
      createId: () => "run-outline-partial-error"
    });

    await expect(
      service.generate(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).rejects.toMatchObject({
      code: "OPENROUTER_UNAVAILABLE",
      upstreamStatus: 502,
      attempts: 3
    });
    expect(
      await fs.readFile(
        path.join(
          workspaceRoot,
          "projects",
          project.metadata.id,
          "project.json"
        )
      )
    ).toEqual(before);
  });

  it("keeps the running log when finalization fails after project save", async () => {
    const { workspaceRoot, repository, project } = await setupProject();
    roots.push(workspaceRoot);
    const originalWriteRunLog = repository.writeRunLog.bind(repository);
    let writeCount = 0;
    vi.spyOn(repository, "writeRunLog").mockImplementation(
      async (projectId, runId, runLog) => {
        writeCount += 1;
        if (writeCount === 2) {
          throw new Error("injected finalization failure");
        }
        await originalWriteRunLog(projectId, runId, runLog);
      }
    );
    const service = new OutlineGenerationService({
      repository,
      modelService: {
        listModels: async () => ({
          models: [model()],
          fetchedAt: NOW.toISOString(),
          cached: false
        })
      },
      chatAdapter: fakeChat(candidate()),
      now: () => NOW,
      createId: () => "run-outline-finalization-failure"
    });

    const saved = await service.generate(project.metadata.id, {
      expectedRevision: project.revision
    });
    expect(saved.revision).toBe(project.revision + 1);
    const runLog = aiRunLogSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(
            workspaceRoot,
            "projects",
            project.metadata.id,
            "runs",
            "run-outline-finalization-failure.json"
          ),
          "utf8"
        )
      )
    );
    expect(runLog).toMatchObject({
      status: "running",
      completedAt: null,
      schemaValidation: "not_run"
    });
  });

  it("rejects generation when an existing outline could be overwritten", async () => {
    const { workspaceRoot, repository, project } = await setupProject();
    roots.push(workspaceRoot);
    const chat = fakeChat(candidate());
    const createId = vi
      .fn()
      .mockReturnValueOnce("run-outline-first")
      .mockReturnValueOnce("run-outline-second");
    const service = new OutlineGenerationService({
      repository,
      modelService: {
        listModels: async () => ({
          models: [model()],
          fetchedAt: NOW.toISOString(),
          cached: false
        })
      },
      chatAdapter: chat,
      now: () => NOW,
      createId
    });

    const first = await service.generate(project.metadata.id, {
      expectedRevision: project.revision
    });
    await expect(
      service.generate(project.metadata.id, {
        expectedRevision: first.revision
      })
    ).rejects.toMatchObject({
      code: "OUTLINE_ALREADY_EXISTS",
      status: 409
    });
    expect(chat.complete).toHaveBeenCalledTimes(1);
    const unchanged = await repository.read(project.metadata.id);
    expect(unchanged.revision).toBe(first.revision);
    expect(unchanged.outline.generationRunId).toBe("run-outline-first");
  });

  it("rejects context overflow before chat and revision conflict before model resolution", async () => {
    const first = await setupProject();
    roots.push(first.workspaceRoot);
    const chat = fakeChat(candidate());
    const listModels = vi.fn(async () => ({
      models: [model(1)],
      fetchedAt: NOW.toISOString(),
      cached: false
    }));
    const service = new OutlineGenerationService({
      repository: first.repository,
      modelService: { listModels },
      chatAdapter: chat,
      now: () => NOW,
      createId: () => "run-outline-context"
    });
    await expect(
      service.generate(first.project.metadata.id, {
        expectedRevision: first.project.revision
      })
    ).rejects.toMatchObject({ code: "OPENROUTER_CONTEXT_LENGTH_EXCEEDED" });
    expect(chat.complete).not.toHaveBeenCalled();

    const second = await setupProject();
    roots.push(second.workspaceRoot);
    const conflictListModels = vi.fn();
    const conflictChat = fakeChat(candidate());
    const conflictService = new OutlineGenerationService({
      repository: second.repository,
      modelService: { listModels: conflictListModels },
      chatAdapter: conflictChat,
      now: () => NOW,
      createId: () => "run-outline-conflict"
    });
    await expect(
      conflictService.generate(second.project.metadata.id, {
        expectedRevision: second.project.revision - 1
      })
    ).rejects.toMatchObject({ code: "PROJECT_REVISION_CONFLICT" });
    expect(conflictListModels).not.toHaveBeenCalled();
    expect(conflictChat.complete).not.toHaveBeenCalled();
  });

  it("records task and run model overrides in their respective run logs", async () => {
    const { workspaceRoot, repository, project } = await setupProject();
    roots.push(workspaceRoot);
    const withTaskOverride = await repository.save(
      project.metadata.id,
      {
        ...project,
        aiSettings: {
          ...project.aiSettings,
          taskModelOverrides: { outline_generation: "task/model" }
        }
      },
      project.revision
    );
    const models = {
      listModels: async () => ({
        models: [
          model(),
          model(131072, "task/model"),
          model(131072, "run/model")
        ],
        fetchedAt: NOW.toISOString(),
        cached: false
      })
    };
    const taskService = new OutlineGenerationService({
      repository,
      modelService: models,
      chatAdapter: fakeChat(candidate()),
      now: () => NOW,
      createId: () => "run-task-override"
    });
    const taskResult = await taskService.generate(
      withTaskOverride.metadata.id,
      {
        expectedRevision: withTaskOverride.revision
      }
    );
    expect(taskResult.revision).toBe(withTaskOverride.revision + 1);

    const runSetup = await setupProject();
    roots.push(runSetup.workspaceRoot);
    const runService = new OutlineGenerationService({
      repository: runSetup.repository,
      modelService: models,
      chatAdapter: fakeChat(candidate()),
      now: () => NOW,
      createId: () => "run-run-override"
    });
    const runResult = await runService.generate(runSetup.project.metadata.id, {
      expectedRevision: runSetup.project.revision,
      modelId: "run/model"
    });
    expect(runResult.revision).toBe(runSetup.project.revision + 1);

    const readLog = async (root: string, projectId: string, runId: string) =>
      aiRunLogSchema.parse(
        JSON.parse(
          await fs.readFile(
            path.join(root, "projects", projectId, "runs", `${runId}.json`),
            "utf8"
          )
        )
      );
    expect(
      await readLog(workspaceRoot, project.metadata.id, "run-task-override")
    ).toMatchObject({
      modelId: "task/model",
      modelSelectionSource: "task_override"
    });
    expect(
      await readLog(
        runSetup.workspaceRoot,
        runSetup.project.metadata.id,
        "run-run-override"
      )
    ).toMatchObject({
      modelId: "run/model",
      modelSelectionSource: "run_override"
    });
  });

  it("does not overwrite a project changed while OpenRouter was running", async () => {
    const { workspaceRoot, repository, project } = await setupProject();
    roots.push(workspaceRoot);
    const chat = {
      complete: vi.fn(async () => {
        await repository.saveBrief(
          project.metadata.id,
          { ...project.brief, audience: "別の保存" },
          project.revision
        );
        return {
          candidate: candidate(),
          responseModel: "provider/model",
          provider: "Provider",
          usage: {
            promptTokens: null,
            completionTokens: null,
            totalTokens: null
          },
          attempts: 1
        };
      })
    };
    const service = new OutlineGenerationService({
      repository,
      modelService: {
        listModels: async () => ({
          models: [model()],
          fetchedAt: NOW.toISOString(),
          cached: false
        })
      },
      chatAdapter: chat,
      now: () => NOW,
      createId: () => "run-outline-race"
    });

    await expect(
      service.generate(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).rejects.toMatchObject({ code: "PROJECT_REVISION_CONFLICT" });
    const finalProject = await repository.read(project.metadata.id);
    expect(finalProject.revision).toBe(project.revision + 1);
    expect(finalProject.brief.audience).toBe("別の保存");
    expect(finalProject.outline.sections).toEqual([]);
  });

  it("keeps project.json unchanged when the outline rename fails", async () => {
    const { workspaceRoot, project } = await setupProject();
    roots.push(workspaceRoot);
    const before = await fs.readFile(
      path.join(workspaceRoot, "projects", project.metadata.id, "project.json")
    );
    const failingRepository = new ProjectRepository({
      workspaceRoot,
      now: () => NOW,
      fileSystem: {
        rename: async (sourcePath, destinationPath) => {
          if (path.basename(destinationPath) === "project.json") {
            throw new Error("injected rename failure");
          }
          await fs.rename(sourcePath, destinationPath);
        }
      }
    });
    const service = new OutlineGenerationService({
      repository: failingRepository,
      modelService: {
        listModels: async () => ({
          models: [model()],
          fetchedAt: NOW.toISOString(),
          cached: false
        })
      },
      chatAdapter: fakeChat(candidate()),
      now: () => NOW,
      createId: () => "run-outline-save-failure"
    });

    await expect(
      service.generate(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).rejects.toMatchObject({ code: "PROJECT_RENAME_FAILED" });
    expect(
      await fs.readFile(
        path.join(
          workspaceRoot,
          "projects",
          project.metadata.id,
          "project.json"
        )
      )
    ).toEqual(before);
  });
});
