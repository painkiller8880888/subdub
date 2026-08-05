import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OutlineGenerationService } from "../../src/app/projects/outline-generation-service.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  projectCreateResponseSchema,
  projectMutationResponseSchema
} from "../../src/schema/api.js";

const NOW = new Date("2026-08-04T03:00:00.000Z");

const model = {
  id: "google/gemma-4-31b-it",
  displayName: "Fixture Model",
  contextLength: 131072,
  inputPrice: "0",
  outputPrice: "0",
  outputModalities: ["text"],
  supportedParameters: ["structured_outputs"],
  expirationDate: null,
  structuredOutputs: true,
  zdrAvailable: true
} as const;

const candidate = {
  openQuestions: [],
  sections: [
    {
      role: "intro",
      title: "概要",
      overview: "概要",
      keyPoints: [],
      targetDurationSec: 10,
      sourceRefs: [{ headingPath: ["概要"] }],
      openQuestions: []
    },
    {
      role: "main",
      title: "手順",
      overview: "手順",
      keyPoints: [],
      targetDurationSec: 20,
      sourceRefs: [{ headingPath: ["概要", "手順"] }],
      openQuestions: []
    },
    {
      role: "outro",
      title: "確認",
      overview: "確認",
      keyPoints: [],
      targetDurationSec: 10,
      sourceRefs: [{ headingPath: ["確認"] }],
      openQuestions: []
    }
  ]
};

describe("outline generation API", () => {
  const roots: string[] = [];
  const servers: Array<Awaited<ReturnType<typeof initializeServer>>> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.app.close()));
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("accepts only expectedRevision/modelId and returns the common mutation response", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-outline-api-")
    );
    roots.push(workspaceRoot);
    const repository = new ProjectRepository({ workspaceRoot, now: () => NOW });
    const modelService = {
      listModels: async () => ({
        models: [model],
        fetchedAt: NOW.toISOString(),
        cached: false
      })
    };
    let runNumber = 0;
    const outlineService = new OutlineGenerationService({
      repository,
      modelService,
      chatAdapter: {
        complete: async () => ({
          candidate,
          responseModel: "provider/model",
          provider: "Provider",
          usage: {
            promptTokens: null,
            completionTokens: null,
            totalTokens: null
          },
          attempts: 1
        })
      },
      now: () => NOW,
      createId: () => `run-api-outline-${++runNumber}`
    });
    const server = await initializeServer({
      workspaceRoot,
      projectRepository: repository,
      modelService,
      outlineGenerationService: outlineService
    });
    servers.push(server);

    const createdResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "構成案API" }
    });
    const created = projectCreateResponseSchema.parse(
      createdResponse.json()
    ).data;
    await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/source`,
      payload: {
        markdown: "# 概要\n\n## 手順\n本文\n\n# 確認\n本文",
        expectedRevision: 0
      }
    });
    await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/brief`,
      payload: {
        brief: { ...created.brief, audience: "利用者" },
        expectedRevision: 1
      }
    });

    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${created.metadata.id}/outline/generate`,
      payload: { expectedRevision: 2 }
    });
    const saved = projectMutationResponseSchema.parse(response.json());
    expect(response.statusCode).toBe(200);
    expect(saved.revision).toBe(3);
    expect(saved.data.outline.status).toBe("needs_review");

    const changedSource = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/source`,
      payload: {
        markdown: "# 概要\n\n## 手順\n本文\n\n# 確認\n本文\n\n追記",
        expectedRevision: saved.revision
      }
    });
    const stale = projectMutationResponseSchema.parse(
      changedSource.json()
    ).data;
    const regeneratedResponse = await server.app.inject({
      method: "POST",
      url: `/api/projects/${created.metadata.id}/outline/regenerate`,
      payload: { expectedRevision: stale.revision }
    });
    const regenerated = projectMutationResponseSchema.parse(
      regeneratedResponse.json()
    );
    expect(regeneratedResponse.statusCode).toBe(200);
    expect(regenerated.revision).toBe(stale.revision + 1);
    expect(regenerated.data.outline.sourceHash).toBe(
      regenerated.data.source.sha256
    );
    expect(regenerated.data.outline.generationRunId).toBe("run-api-outline-2");

    const invalid = await server.app.inject({
      method: "POST",
      url: `/api/projects/${created.metadata.id}/outline/generate`,
      payload: {
        expectedRevision: regenerated.revision,
        taskKind: "script_generation"
      }
    });
    const error = apiErrorResponseSchema.parse(invalid.json()).error;
    expect(invalid.statusCode).toBe(422);
    expect(error.code).toBe("REQUEST_VALIDATION_FAILED");
  });
});
