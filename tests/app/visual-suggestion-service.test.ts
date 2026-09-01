import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetRepository } from "../../src/app/assets/asset-repository.js";
import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { VisualSuggestionService } from "../../src/app/projects/visual-suggestion-service.js";
import { ImprovementLogRepository } from "../../src/app/projects/improvement-log-repository.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import {
  assetTags,
  assetVersions,
  assets,
  tagAliases,
  tags
} from "../../src/db/schema.js";
import { aiRunLogSchema, type VideoProject } from "../../src/schema/index.js";
import { OpenRouterAdapterError } from "../../src/openrouter/errors.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const NOW = new Date("2026-08-10T02:00:00.000Z");
const SOURCE =
  "# Visual source\n\nThe approved script describes a visual search.\n";

type TestSetup = {
  readonly workspaceRoot: string;
  readonly repository: ProjectRepository;
  readonly assetRepository: AssetRepository;
  readonly project: VideoProject;
  readonly database: Awaited<ReturnType<typeof initializeWorkspaceDatabase>>;
};

function model(
  id: string,
  options: { structuredOutputs?: boolean; zdrAvailable?: boolean } = {}
) {
  return {
    id,
    displayName: id,
    contextLength: 131072,
    inputPrice: "0",
    outputPrice: "0",
    outputModalities: ["text"],
    supportedParameters:
      options.structuredOutputs === false ? [] : ["structured_outputs"],
    expirationDate: null,
    structuredOutputs: options.structuredOutputs ?? true,
    zdrAvailable: options.zdrAvailable ?? true
  } as const;
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    requiredTags: ["task:must-have"],
    optionalTags: ["task:optional"],
    excludedTags: ["task:excluded"],
    mediaKinds: ["photo", "video"],
    freeTextQuery: "unique visual",
    reason: "The selected lines explain the visual workflow.",
    ...overrides
  };
}

async function setupProject(
  aiSettings: Partial<VideoProject["aiSettings"]> = {}
): Promise<TestSetup> {
  const workspaceRoot = await fs.mkdtemp(
    path.join(tmpdir(), "subdub-visual-suggestion-")
  );
  const database = await initializeWorkspaceDatabase({ workspaceRoot });
  const repository = new ProjectRepository({ workspaceRoot, now: () => NOW });
  const created = await repository.create(
    createEmptyVideoProject({
      projectId: "visual-suggestion-project",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    })
  );
  const sourceProject = await repository.saveSource(
    created.metadata.id,
    SOURCE,
    created.revision
  );
  const project = await repository.save(
    created.metadata.id,
    {
      ...sourceProject,
      script: structuredClone(videoProjectFixture.script),
      aiSettings: {
        ...sourceProject.aiSettings,
        defaultModelId: "default-model",
        taskModelOverrides: { visual_search_intent: "task-model" },
        ...aiSettings
      }
    },
    sourceProject.revision
  );
  const assetRepository = new AssetRepository(database.database);
  return {
    workspaceRoot,
    repository,
    assetRepository,
    project,
    database
  };
}

function insertDatabaseTag(
  database: Awaited<ReturnType<typeof initializeWorkspaceDatabase>>,
  tagId: string,
  canonicalName: string,
  status: "active" | "inactive" = "active"
): void {
  database.database
    .insert(tags)
    .values({
      tagId,
      axis: "task",
      canonicalName,
      normalizedName: canonicalName,
      status,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    })
    .run();
}

function insertDatabaseAsset(
  database: Awaited<ReturnType<typeof initializeWorkspaceDatabase>>,
  assetId: string,
  values: Partial<{
    kind: "video" | "photo" | "document_scan" | "sound_effect";
    title: string;
    status: "processing" | "active" | "inactive" | "error";
  }> = {}
): void {
  database.database
    .insert(assets)
    .values({
      assetId,
      kind: values.kind ?? "photo",
      title: values.title ?? assetId,
      description: "",
      confidentiality: "internal",
      department: null,
      system: null,
      status: values.status ?? "active",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    })
    .run();
  database.database
    .insert(assetVersions)
    .values({
      assetId,
      version: 1,
      libraryMediaPath: `media/${assetId}/v1`,
      mimeType: "image/png",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    })
    .run();
}

function linkDatabaseAsset(
  database: Awaited<ReturnType<typeof initializeWorkspaceDatabase>>,
  assetId: string,
  tagId: string
): void {
  database.database
    .insert(assetTags)
    .values({ assetId, tagId, createdAt: NOW.toISOString() })
    .run();
}

function createService(
  setup: TestSetup,
  candidate: unknown,
  options: {
    readonly modelIds?: readonly string[];
    readonly createId?: () => string;
    readonly chatError?: unknown;
    readonly withImprovementLog?: boolean;
    readonly modelOptions?: Record<
      string,
      { structuredOutputs?: boolean; zdrAvailable?: boolean }
    >;
  } = {}
) {
  const requests: unknown[] = [];
  const modelIds = options.modelIds ?? [
    "default-model",
    "task-model",
    "run-model"
  ];
  const modelService = {
    listModels: vi.fn(async () => ({
      models: modelIds.map((id) => model(id, options.modelOptions?.[id])),
      fetchedAt: NOW.toISOString(),
      cached: false
    }))
  };
  const chatAdapter = {
    complete: vi.fn(async (request: unknown) => {
      requests.push(request);
      if (options.chatError !== undefined) {
        throw options.chatError;
      }
      return {
        candidate,
        responseModel: "provider/model",
        provider: "Fixture Provider",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        attempts: 2
      };
    })
  };
  const service = new VisualSuggestionService({
    repository: setup.repository,
    assetRepository: setup.assetRepository,
    modelService,
    chatAdapter,
    now: () => NOW,
    createId: options.createId ?? (() => "visual-suggestion-run"),
    ...(options.withImprovementLog
      ? {
          improvementLogRepository: new ImprovementLogRepository(
            setup.database.database
          )
        }
      : {})
  });
  return { service, modelService, chatAdapter, requests };
}

describe("VisualSuggestionService", () => {
  const roots: string[] = [];
  const databases: Array<() => void> = [];

  afterEach(async () => {
    for (const close of databases.splice(0)) close();
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  async function readySetup(
    aiSettings: Partial<VideoProject["aiSettings"]> = {}
  ): Promise<TestSetup> {
    const setup = await setupProject(aiSettings);
    databases.push(() => setup.database.close());
    roots.push(setup.workspaceRoot);
    return setup;
  }

  it("generates intent, resolves aliases, searches only backend assets, and records a run without assignments", async () => {
    const setup = await readySetup();
    const database = setup.database;
    insertDatabaseTag(database, "tag-required", "required");
    insertDatabaseTag(database, "tag-optional", "optional");
    insertDatabaseTag(database, "tag-excluded", "excluded");
    database.database
      .insert(tagAliases)
      .values({
        aliasId: "alias-required",
        tagId: "tag-required",
        alias: "must-have",
        normalizedAlias: "must-have",
        createdAt: NOW.toISOString()
      })
      .run();
    insertDatabaseAsset(database, "asset-best", {
      title: "unique visual",
      kind: "photo"
    });
    insertDatabaseAsset(database, "asset-video", { kind: "video" });
    insertDatabaseAsset(database, "asset-sound", { kind: "sound_effect" });
    insertDatabaseAsset(database, "asset-excluded");
    insertDatabaseAsset(database, "asset-inactive", { status: "inactive" });
    insertDatabaseAsset(database, "asset-error", { status: "error" });
    for (const assetId of [
      "asset-best",
      "asset-video",
      "asset-sound",
      "asset-excluded",
      "asset-inactive",
      "asset-error"
    ]) {
      linkDatabaseAsset(database, assetId, "tag-required");
    }
    linkDatabaseAsset(database, "asset-best", "tag-optional");
    linkDatabaseAsset(database, "asset-excluded", "tag-excluded");

    const chat = createService(setup, intent());
    const result = await chat.service.generate(setup.project.metadata.id, {
      startLineId: "main-mentor-1",
      endLineId: "main-learner-1",
      expectedRevision: setup.project.revision
    });

    expect(result.data.aiIntent.requiredTags).toEqual(["task:must-have"]);
    expect(result.data.resolvedSearch.requiredTags).toMatchObject([
      { tagId: "tag-required", canonicalName: "required" }
    ]);
    expect(result.data.resolvedSearch.optionalTags).toMatchObject([
      { tagId: "tag-optional" }
    ]);
    expect(result.data.resolvedSearch.excludedTags).toMatchObject([
      { tagId: "tag-excluded" }
    ]);
    expect(
      result.data.candidates.map((candidate) => candidate.asset.assetId)
    ).toEqual(["asset-best"]);
    expect(result.data.target.lineIds).toEqual([
      "main-mentor-1",
      "main-learner-1"
    ]);
    expect(result.data.diagnostics.unresolvedTags).toEqual([]);
    expect(result.revision).toBe(setup.project.revision + 1);
    expect(chat.requests).toHaveLength(1);
    const request = chat.requests[0] as {
      modelId: string;
      schemaName?: string;
      messages: Array<{ content: string }>;
    };
    expect(request.modelId).toBe("task-model");
    expect(request.schemaName).toBe("subdub_visual_search_intent");
    expect(JSON.stringify(request.messages)).not.toContain("asset-best");
    expect(JSON.stringify(request.messages)).not.toContain("tag-required");

    const saved = await setup.repository.read(setup.project.metadata.id);
    expect(saved.visuals.assignments).toEqual([]);
    expect(saved.visuals.suggestionRunIds).toEqual(["visual-suggestion-run"]);
    const projectJson = await fs.readFile(
      path.join(
        setup.workspaceRoot,
        "projects",
        setup.project.metadata.id,
        "project.json"
      ),
      "utf8"
    );
    expect(projectJson).not.toContain("asset-best");
    const runJson = await fs.readFile(
      path.join(
        setup.workspaceRoot,
        "projects",
        setup.project.metadata.id,
        "runs",
        "visual-suggestion-run.json"
      ),
      "utf8"
    );
    const runLog = aiRunLogSchema.parse(JSON.parse(runJson));
    expect(runLog).toMatchObject({
      taskKind: "visual_search_intent",
      sourceHash: null,
      status: "succeeded",
      modelId: "task-model",
      modelSelectionSource: "task_override",
      responseModel: "provider/model",
      provider: "Fixture Provider",
      zdr: true,
      dataCollection: "deny",
      providerFallbacks: true,
      httpAttemptCount: 2,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      schemaValidation: "passed"
    });
    expect(runJson).not.toContain("unique visual");
  });

  it("generates current visual suggestions without requiring source.md", async () => {
    const setup = await readySetup();
    await fs.rm(
      path.join(
        setup.workspaceRoot,
        "projects",
        setup.project.metadata.id,
        "source"
      ),
      { recursive: true, force: true }
    );
    const chat = createService(setup, intent());

    await expect(
      chat.service.generate(setup.project.metadata.id, {
        startLineId: "main-mentor-1",
        endLineId: "main-learner-1",
        expectedRevision: setup.project.revision
      })
    ).resolves.toMatchObject({
      revision: setup.project.revision + 1,
      data: { runId: "visual-suggestion-run" }
    });
    expect(chat.chatAdapter.complete).toHaveBeenCalledTimes(1);
  });

  it("stores each successful backend candidate with its run, model, and prompt version", async () => {
    const setup = await readySetup();
    insertDatabaseAsset(setup.database, "asset-candidate", {
      title: "unique visual"
    });
    insertDatabaseTag(setup.database, "tag-candidate", "must-have");
    linkDatabaseAsset(setup.database, "asset-candidate", "tag-candidate");
    const chat = createService(setup, intent(), { withImprovementLog: true });

    const result = await chat.service.generate(setup.project.metadata.id, {
      startLineId: "main-mentor-1",
      endLineId: "main-learner-1",
      expectedRevision: setup.project.revision
    });
    const candidates = await new ImprovementLogRepository(
      setup.database.database
    ).listGenerationCandidates(setup.project.metadata.id);

    expect(result.data.candidates).toHaveLength(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      generationRunId: result.data.runId,
      projectRevision: result.revision,
      taskKind: "visual_search_intent",
      targetKind: "visual_line_range",
      targetId: "main-mentor-1:main-learner-1",
      candidateKey: "asset:asset-candidate",
      modelId: "task-model",
      responseModel: "provider/model",
      promptVersion: "1.0.0"
    });
  });

  it("records an explicit visual candidate rejection without changing the project", async () => {
    const setup = await readySetup();
    insertDatabaseAsset(setup.database, "asset-rejected", {
      title: "unique visual"
    });
    insertDatabaseTag(setup.database, "tag-rejected", "must-have");
    linkDatabaseAsset(setup.database, "asset-rejected", "tag-rejected");
    setup.database.connection
      .prepare(
        "UPDATE asset_versions SET checksum = ? WHERE asset_id = ? AND version = 1"
      )
      .run("c".repeat(64), "asset-rejected");
    const chat = createService(setup, intent(), { withImprovementLog: true });
    const generated = await chat.service.generate(setup.project.metadata.id, {
      startLineId: "main-mentor-1",
      endLineId: "main-learner-1",
      expectedRevision: setup.project.revision
    });
    expect(generated.data.candidates).toHaveLength(1);

    const rejected = await chat.service.rejectCandidate(
      setup.project.metadata.id,
      generated.data.runId,
      "asset-rejected",
      { expectedRevision: generated.revision, reason: "   " }
    );
    const decisions = await new ImprovementLogRepository(
      setup.database.database
    ).listDecisions(setup.project.metadata.id);

    expect(rejected.revision).toBe(generated.revision);
    expect(rejected.data).toMatchObject({ decision: "rejected" });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toBeNull();
    expect(
      (await setup.repository.read(setup.project.metadata.id)).revision
    ).toBe(generated.revision);

    await expect(
      chat.service.rejectCandidate(
        setup.project.metadata.id,
        generated.data.runId,
        "asset-rejected",
        { expectedRevision: generated.revision, reason: "再送" }
      )
    ).resolves.toMatchObject({ data: { decision: "rejected" } });
    expect(
      await new ImprovementLogRepository(setup.database.database).listDecisions(
        setup.project.metadata.id
      )
    ).toHaveLength(1);
  });

  it("keeps run override, task override, and default model priority", async () => {
    const setup = await readySetup();
    const chat = createService(setup, intent(), {
      createId: (() => {
        let index = 0;
        return () => `priority-run-${++index}`;
      })()
    });
    const first = await chat.service.generate(setup.project.metadata.id, {
      startLineId: "main-mentor-1",
      endLineId: "main-mentor-1",
      expectedRevision: setup.project.revision,
      modelId: "run-model"
    });
    const second = await chat.service.generate(setup.project.metadata.id, {
      startLineId: "main-mentor-1",
      endLineId: "main-mentor-1",
      expectedRevision: first.revision
    });
    const taskOverrideRemoved = await setup.repository.save(
      setup.project.metadata.id,
      {
        ...(await setup.repository.read(setup.project.metadata.id)),
        aiSettings: {
          ...(await setup.repository.read(setup.project.metadata.id))
            .aiSettings,
          taskModelOverrides: {}
        }
      },
      second.revision
    );
    await chat.service.generate(setup.project.metadata.id, {
      startLineId: "main-mentor-1",
      endLineId: "main-mentor-1",
      expectedRevision: taskOverrideRemoved.revision,
      modelId: undefined
    });
    expect(
      (chat.requests as Array<{ modelId: string }>).map(
        (request) => request.modelId
      )
    ).toEqual(["run-model", "task-model", "default-model"]);
  });

  it("returns unresolved required tags as no candidates and never treats an asset id as a tag", async () => {
    const setup = await readySetup();
    const database = setup.database;
    insertDatabaseTag(database, "tag-required", "required");
    insertDatabaseAsset(database, "asset-best", { title: "asset-best" });
    linkDatabaseAsset(database, "asset-best", "tag-required");
    const chat = createService(
      setup,
      intent({
        requiredTags: ["asset-best"],
        optionalTags: ["unknown-optional"],
        excludedTags: []
      }),
      { withImprovementLog: true }
    );

    const result = await chat.service.generate(setup.project.metadata.id, {
      startLineId: "main-mentor-1",
      endLineId: "main-mentor-1",
      expectedRevision: setup.project.revision
    });

    expect(result.data.candidates).toEqual([]);
    expect(result.data.diagnostics.requiredTagResolutionFailed).toBe(true);
    expect(result.data.diagnostics.unresolvedTags).toEqual([
      { group: "requiredTags", value: "asset-best", reason: "unknown" },
      { group: "optionalTags", value: "unknown-optional", reason: "unknown" }
    ]);
    expect(
      await new ImprovementLogRepository(
        setup.database.database
      ).listGenerationCandidates(setup.project.metadata.id)
    ).toHaveLength(0);
  });

  it("does not change project state on malformed intent and normal asset search remains available", async () => {
    const setup = await readySetup();
    const database = setup.database;
    insertDatabaseTag(database, "tag-required", "required");
    insertDatabaseAsset(database, "asset-normal", { title: "normal search" });
    linkDatabaseAsset(database, "asset-normal", "tag-required");
    const before = await setup.repository.read(setup.project.metadata.id);
    const chat = createService(setup, { requiredTags: [] });

    await expect(
      chat.service.generate(setup.project.metadata.id, {
        startLineId: "main-mentor-1",
        endLineId: "main-mentor-1",
        expectedRevision: before.revision
      })
    ).rejects.toMatchObject({ code: "VISUAL_SEARCH_INTENT_SCHEMA_INVALID" });

    expect(await setup.repository.read(setup.project.metadata.id)).toEqual(
      before
    );
    expect(
      setup.assetRepository
        .list({ status: "active", tagIds: [], page: 1, pageSize: 20 })
        .items.map((asset) => asset.assetId)
    ).toEqual(["asset-normal"]);
  });

  it("rejects invalid ranges, unsupported models, and OpenRouter failures", async () => {
    const setup = await readySetup();
    const chat = createService(setup, intent());
    await expect(
      chat.service.generate("../invalid", {
        startLineId: "main-mentor-1",
        endLineId: "main-mentor-1",
        expectedRevision: setup.project.revision
      })
    ).rejects.toMatchObject({ code: "PROJECT_ID_INVALID" });
    await expect(
      chat.service.generate(setup.project.metadata.id, {
        startLineId: "missing-line",
        endLineId: "main-mentor-1",
        expectedRevision: setup.project.revision
      })
    ).rejects.toMatchObject({ code: "VISUAL_SUGGESTION_LINE_RANGE_INVALID" });
    await expect(
      chat.service.generate(setup.project.metadata.id, {
        startLineId: "main-learner-1",
        endLineId: "main-mentor-1",
        expectedRevision: setup.project.revision
      })
    ).rejects.toMatchObject({ code: "VISUAL_SUGGESTION_LINE_RANGE_INVALID" });
    await expect(
      chat.service.generate(setup.project.metadata.id, {
        startLineId: "intro-mentor-1",
        endLineId: "main-mentor-1",
        expectedRevision: setup.project.revision
      })
    ).rejects.toMatchObject({ code: "VISUAL_SUGGESTION_SECTION_MISMATCH" });

    const draftSetup = await readySetup();
    const draftProject = await draftSetup.repository.read(
      draftSetup.project.metadata.id
    );
    const draftSaved = await draftSetup.repository.save(
      draftSetup.project.metadata.id,
      {
        ...draftProject,
        metadata: {
          ...draftProject.metadata,
          title: "Draft suggestion project"
        }
      },
      draftProject.revision
    );
    const draftSuggestion = await createService(
      draftSetup,
      intent()
    ).service.generate(draftSetup.project.metadata.id, {
      startLineId: "main-mentor-1",
      endLineId: "main-mentor-1",
      expectedRevision: draftSaved.revision
    });
    expect(draftSuggestion.data.target.lineIds).toEqual(["main-mentor-1"]);

    const noModel = await readySetup({
      defaultModelId: null,
      taskModelOverrides: {}
    });
    await expect(
      createService(noModel, intent()).service.generate(
        noModel.project.metadata.id,
        {
          startLineId: "main-mentor-1",
          endLineId: "main-mentor-1",
          expectedRevision: noModel.project.revision
        }
      )
    ).rejects.toMatchObject({ code: "MODEL_NOT_SELECTED" });

    const missingModel = await readySetup({
      defaultModelId: "missing-model",
      taskModelOverrides: {}
    });
    await expect(
      createService(missingModel, intent(), { modelIds: [] }).service.generate(
        missingModel.project.metadata.id,
        {
          startLineId: "main-mentor-1",
          endLineId: "main-mentor-1",
          expectedRevision: missingModel.project.revision
        }
      )
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });

    const unsupported = await readySetup({
      defaultModelId: "unsupported-model",
      taskModelOverrides: {}
    });
    await expect(
      createService(unsupported, intent(), {
        modelIds: ["unsupported-model"],
        modelOptions: { "unsupported-model": { structuredOutputs: false } }
      }).service.generate(unsupported.project.metadata.id, {
        startLineId: "main-mentor-1",
        endLineId: "main-mentor-1",
        expectedRevision: unsupported.project.revision
      })
    ).rejects.toMatchObject({ code: "MODEL_STRUCTURED_OUTPUT_UNSUPPORTED" });

    const zdr = await readySetup({
      defaultModelId: "zdr-model",
      taskModelOverrides: {}
    });
    await expect(
      createService(zdr, intent(), {
        modelIds: ["zdr-model"],
        modelOptions: { "zdr-model": { zdrAvailable: false } }
      }).service.generate(zdr.project.metadata.id, {
        startLineId: "main-mentor-1",
        endLineId: "main-mentor-1",
        expectedRevision: zdr.project.revision
      })
    ).rejects.toMatchObject({ code: "MODEL_ZDR_ENDPOINT_UNAVAILABLE" });

    const failed = await readySetup();
    await expect(
      createService(failed, intent(), {
        chatError: new OpenRouterAdapterError("OPENROUTER_UNAVAILABLE", {
          attempts: 3
        })
      }).service.generate(failed.project.metadata.id, {
        startLineId: "main-mentor-1",
        endLineId: "main-mentor-1",
        expectedRevision: failed.project.revision
      })
    ).rejects.toMatchObject({ code: "OPENROUTER_UNAVAILABLE" });
  });
});
