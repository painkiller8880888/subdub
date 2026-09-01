import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  projectCharactersSaveRequestSchema,
  projectCreateResponseSchema,
  projectEditResponseSchema,
  projectEditSaveRequestSchema,
  projectMutationResponseSchema
} from "../../src/schema/api.js";
import type { VideoProject } from "../../src/schema/index.js";

describe("project and edit APIs", () => {
  let workspaceRoot: string;
  let server: Awaited<ReturnType<typeof initializeServer>>;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-editing-api-")
    );
    server = await initializeServer({ workspaceRoot });
  });

  afterEach(async () => {
    await server.app.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function createProject(): Promise<VideoProject> {
    const response = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "Editing test project" }
    });
    return projectCreateResponseSchema.parse(response.json()).data;
  }

  function parseError(response: { statusCode: number; json(): unknown }) {
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    return apiErrorResponseSchema.parse(response.json()).error;
  }

  async function projectFiles(projectId: string): Promise<{
    project: Buffer;
    source: Buffer;
  }> {
    const directory = path.join(workspaceRoot, "projects", projectId);
    return {
      project: await fs.readFile(path.join(directory, "project.json")),
      source: await fs.readFile(path.join(directory, "source", "source.md"))
    };
  }

  it("retires planning routes without mutating the project or source.md", async () => {
    const project = await createProject();
    const before = await projectFiles(project.metadata.id);
    const retiredRoutes = [
      { method: "GET" as const, suffix: "source" },
      { method: "PUT" as const, suffix: "source" },
      { method: "PUT" as const, suffix: "brief" },
      { method: "PUT" as const, suffix: "outline" },
      { method: "POST" as const, suffix: "outline/generate" },
      { method: "POST" as const, suffix: "outline/approve" },
      { method: "POST" as const, suffix: "outline/reject" },
      { method: "POST" as const, suffix: "outline/review" },
      { method: "POST" as const, suffix: "script/initialize" },
      { method: "POST" as const, suffix: "script/approve" }
    ];

    for (const route of retiredRoutes) {
      const response = await server.app.inject({
        method: route.method,
        url: `/api/projects/${project.metadata.id}/${route.suffix}`,
        payload: {}
      });
      expect(response.statusCode).toBe(404);
      expect(parseError(response).code).toBe("API_NOT_FOUND");
    }

    expect(await projectFiles(project.metadata.id)).toEqual(before);
  });

  it("saves explicit project visual bindings through the character endpoint", async () => {
    const project = await createProject();
    const request = {
      expectedRevision: project.revision,
      characters: project.characters.map((character, index) => ({
        characterId: character.id,
        characterVisual: {
          visualId: `project-visual-${index + 1}`,
          idleVariantId: `project-visual-${index + 1}-idle`
        }
      }))
    };
    expect(projectCharactersSaveRequestSchema.safeParse(request).success).toBe(
      true
    );

    const response = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/characters`,
      payload: request
    });
    const saved = projectMutationResponseSchema.parse(response.json()).data;

    expect(response.statusCode).toBe(200);
    expect(saved.revision).toBe(1);
    expect(
      saved.characters.map((character) => character.characterVisual)
    ).toEqual(request.characters.map((character) => character.characterVisual));

    const staleResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/characters`,
      payload: request
    });
    expect(staleResponse.statusCode).toBe(409);
    expect(parseError(staleResponse).code).toBe("PROJECT_REVISION_CONFLICT");
  });

  it("reads and saves the edit plan with a revision and server-owned input contract", async () => {
    const project = await createProject();
    const initialResponse = await server.app.inject({
      method: "GET",
      url: `/api/projects/${project.metadata.id}/edit`
    });
    const initial = projectEditResponseSchema.parse(initialResponse.json());

    expect(initialResponse.statusCode).toBe(200);
    expect(initial.data).toEqual({ videoElements: [], sectionBgms: [] });
    expect(initial.revision).toBe(0);

    const request = {
      edit: { videoElements: [], sectionBgms: [] },
      expectedRevision: initial.revision
    };
    expect(projectEditSaveRequestSchema.safeParse(request).success).toBe(true);
    const saveResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/edit`,
      payload: request
    });
    const saved = projectMutationResponseSchema.parse(saveResponse.json());

    expect(saveResponse.statusCode).toBe(200);
    expect(saved.data.edit).toEqual(request.edit);
    expect(saved.revision).toBe(1);

    const reloadedResponse = await server.app.inject({
      method: "GET",
      url: `/api/projects/${project.metadata.id}/edit`
    });
    const reloaded = projectEditResponseSchema.parse(reloadedResponse.json());
    expect(reloaded.data).toEqual(request.edit);
    expect(reloaded.revision).toBe(1);
  });

  it("rejects client-supplied snapshots and stale edit revisions", async () => {
    const project = await createProject();
    const snapshotInput = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/edit`,
      payload: {
        edit: {
          videoElements: [
            {
              id: "intro-video",
              role: "intro",
              assetId: "asset-video",
              assetVersion: 1,
              assetChecksum: "0".repeat(64),
              projectMediaPath: "C:/private/video.mp4",
              placement: { kind: "before_first_section" },
              volume: 0.5
            }
          ],
          sectionBgms: []
        },
        expectedRevision: 0
      }
    });
    expect(snapshotInput.statusCode).toBe(422);
    expect(parseError(snapshotInput).code).toBe("REQUEST_VALIDATION_FAILED");

    const firstSave = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/edit`,
      payload: {
        edit: { videoElements: [], sectionBgms: [] },
        expectedRevision: 0
      }
    });
    expect(firstSave.statusCode).toBe(200);

    const stale = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/edit`,
      payload: {
        edit: { videoElements: [], sectionBgms: [] },
        expectedRevision: 0
      }
    });
    expect(stale.statusCode).toBe(409);
    expect(parseError(stale).code).toBe("PROJECT_REVISION_CONFLICT");
  });

  it("keeps the API contracts strict", () => {
    expect(
      projectEditSaveRequestSchema.safeParse({
        edit: { videoElements: [], sectionBgms: [] },
        expectedRevision: 0,
        extra: true
      }).success
    ).toBe(false);
  });
});
