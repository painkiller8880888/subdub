import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/api/app.js";
import { computeOutlineHash } from "../../src/app/projects/script-domain.js";
import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { VisualSuggestionService } from "../../src/app/projects/visual-suggestion-service.js";
import {
  apiErrorResponseSchema,
  visualSuggestionResponseSchema
} from "../../src/schema/api.js";
import type { AssetRepository } from "../../src/app/assets/asset-repository.js";
import type { VideoProject } from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const NOW = new Date("2026-08-10T03:00:00.000Z");

const model = {
  id: "api-model",
  displayName: "API model",
  contextLength: 131072,
  inputPrice: "0",
  outputPrice: "0",
  outputModalities: ["text"],
  supportedParameters: ["structured_outputs"],
  expirationDate: null,
  structuredOutputs: true,
  zdrAvailable: true
} as const;

async function setupProject(workspaceRoot: string): Promise<VideoProject> {
  const repository = new ProjectRepository({ workspaceRoot, now: () => NOW });
  const created = await repository.create(
    createEmptyVideoProject({
      projectId: "visual-suggestions-api-project",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    })
  );
  const sourceProject = await repository.saveSource(
    created.metadata.id,
    "# API visual source\n",
    created.revision
  );
  const candidate = structuredClone(videoProjectFixture) as VideoProject;
  candidate.metadata = {
    ...candidate.metadata,
    id: created.metadata.id,
    createdAt: sourceProject.metadata.createdAt,
    updatedAt: sourceProject.metadata.updatedAt
  };
  candidate.source = sourceProject.source;
  candidate.outline = {
    ...candidate.outline,
    status: "approved",
    sourceHash: sourceProject.source.sha256,
    sections: candidate.outline.sections.map((section) => ({
      ...section,
      sourceRefs: section.sourceRefs.map((sourceRef) => ({
        ...sourceRef,
        sourceId: sourceProject.source.id
      }))
    }))
  };
  candidate.script = {
    ...candidate.script,
    status: "approved",
    outlineHash: computeOutlineHash(candidate.outline)
  };
  candidate.aiSettings = {
    ...candidate.aiSettings,
    defaultModelId: "api-model",
    taskModelOverrides: {}
  };
  candidate.visuals = {
    status: "draft",
    suggestionRunIds: [],
    assignments: []
  };
  return repository.save(
    created.metadata.id,
    candidate,
    sourceProject.revision
  );
}

describe("visual suggestions API", () => {
  const roots: string[] = [];
  const apps: Array<ReturnType<typeof buildApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  async function createServer() {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-visual-suggestions-api-")
    );
    roots.push(workspaceRoot);
    const repository = new ProjectRepository({ workspaceRoot, now: () => NOW });
    const project = await setupProject(workspaceRoot);
    const assetRepository: Pick<
      AssetRepository,
      "findActiveTagDictionary" | "searchVisual"
    > = {
      findActiveTagDictionary: () => [],
      searchVisual: () => ({ items: [], total: 0 })
    };
    const service = new VisualSuggestionService({
      repository,
      assetRepository,
      modelService: {
        listModels: async () => ({
          models: [model],
          fetchedAt: NOW.toISOString(),
          cached: false
        })
      },
      chatAdapter: {
        complete: async () => ({
          candidate: {
            requiredTags: [],
            optionalTags: [],
            excludedTags: [],
            mediaKinds: ["photo"],
            freeTextQuery: "",
            reason: "The line needs a visual explanation."
          },
          responseModel: "api-model",
          provider: "API fixture provider",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          attempts: 1
        })
      },
      now: () => NOW,
      createId: () => "visual-suggestions-api-run"
    });
    const app = buildApp({ visualSuggestionService: service });
    apps.push(app);
    return { app, project };
  }

  it("returns distinct AI intent, resolved search, diagnostics, and backend candidates", async () => {
    const { app, project } = await createServer();
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/visual-suggestions`,
      payload: {
        startLineId: "main-mentor-1",
        endLineId: "main-learner-1",
        expectedRevision: project.revision
      }
    });

    expect(response.statusCode).toBe(200);
    const result = visualSuggestionResponseSchema.parse(response.json());
    expect(result.data.aiIntent).toMatchObject({
      requiredTags: [],
      mediaKinds: ["photo"]
    });
    expect(result.data.resolvedSearch).toMatchObject({
      requiredTags: [],
      mediaKinds: ["photo"]
    });
    expect(result.data.diagnostics).toMatchObject({
      unresolvedTags: [],
      candidateCount: 0
    });
    expect(result.data.candidates).toEqual([]);
    expect(result.revision).toBe(project.revision + 1);
  });

  it("uses the common validation and project error envelope before calling OpenRouter", async () => {
    const { app, project } = await createServer();
    const invalidBody = await app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/visual-suggestions`,
      payload: { expectedRevision: project.revision, unexpected: true }
    });
    expect(invalidBody.statusCode).toBe(422);
    expect(apiErrorResponseSchema.parse(invalidBody.json()).error.code).toBe(
      "REQUEST_VALIDATION_FAILED"
    );

    const invalidProject = await app.inject({
      method: "POST",
      url: "/api/projects/not-found/visual-suggestions",
      payload: {
        startLineId: "main-mentor-1",
        endLineId: "main-mentor-1",
        expectedRevision: project.revision
      }
    });
    expect(invalidProject.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(invalidProject.json()).error.code).toBe(
      "PROJECT_NOT_FOUND"
    );

    const crossSection = await app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/visual-suggestions`,
      payload: {
        startLineId: "intro-mentor-1",
        endLineId: "main-mentor-1",
        expectedRevision: project.revision
      }
    });
    expect(crossSection.statusCode).toBe(422);
    expect(apiErrorResponseSchema.parse(crossSection.json()).error.code).toBe(
      "VISUAL_SUGGESTION_SECTION_MISMATCH"
    );
  });
});
