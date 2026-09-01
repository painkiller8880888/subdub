import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  projectBriefSaveRequestSchema,
  projectCharactersSaveRequestSchema,
  projectCreateResponseSchema,
  projectEditResponseSchema,
  projectEditSaveRequestSchema,
  projectMutationResponseSchema,
  projectSourceReadResponseSchema
} from "../../src/schema/api.js";
import type { VideoProject } from "../../src/schema/index.js";

describe("project source and brief APIs", () => {
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

  it("reads empty and Japanese Markdown through the shared response schema", async () => {
    const project = await createProject();
    const emptyResponse = await server.app.inject({
      method: "GET",
      url: `/api/projects/${project.metadata.id}/source`
    });
    const empty = projectSourceReadResponseSchema.parse(emptyResponse.json());
    expect(emptyResponse.statusCode).toBe(200);
    expect(empty.data.markdown).toBe("");
    expect(empty.revision).toBe(0);

    const markdown = "# \u65e5\u672c\u8a9e\n\n\u8cc7\u6599";
    const saveResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/source`,
      payload: { markdown, expectedRevision: 0 }
    });
    expect(
      projectMutationResponseSchema.parse(saveResponse.json()).revision
    ).toBe(1);

    const japaneseResponse = await server.app.inject({
      method: "GET",
      url: `/api/projects/${project.metadata.id}/source`
    });
    const japanese = projectSourceReadResponseSchema.parse(
      japaneseResponse.json()
    );
    expect(japanese.data.markdown).toBe(markdown);
    expect(japanese.data.sha256).toBe(
      createHash("sha256").update(Buffer.from(markdown, "utf8")).digest("hex")
    );
  });

  it("saves source content, hash, revision, and persists it after restart", async () => {
    const project = await createProject();
    const markdown = "# Source\n\nUTF-8 content";
    const response = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/source`,
      payload: { markdown, expectedRevision: project.revision }
    });
    const saved = projectMutationResponseSchema.parse(response.json());
    const files = await projectFiles(project.metadata.id);
    const savedJson = JSON.parse(
      files.project.toString("utf8")
    ) as VideoProject;

    expect(response.statusCode).toBe(200);
    expect(saved.data.revision).toBe(1);
    expect(saved.data).not.toHaveProperty("source");
    expect(savedJson).not.toHaveProperty("source");
    expect(files.source.toString("utf8")).toBe(markdown);
    expect(new Date(saved.data.metadata.updatedAt).getTime()).toBeGreaterThan(
      0
    );

    await server.app.close();
    server = await initializeServer({ workspaceRoot });
    const reloaded = await server.app.inject({
      method: "GET",
      url: `/api/projects/${project.metadata.id}/source`
    });
    const source = projectSourceReadResponseSchema.parse(reloaded.json());
    expect(source.data.markdown).toBe(markdown);
    expect(source.revision).toBe(1);
  });

  it("rejects legacy brief mutations for a V19 project", async () => {
    const project = await createProject();
    const brief = {
      audience: "new audience",
      postViewingGoal: "new goal",
      prerequisites: ["one", "two"],
      targetDurationSec: 120,
      requiredItems: ["required"],
      prohibitedItems: ["prohibited"],
      globalDirectives: ["global"]
    };
    const response = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/brief`,
      payload: { brief, expectedRevision: 0 }
    });
    expect(parseError(response).code).toBe(
      "PROJECT_CANDIDATE_VALIDATION_FAILED"
    );
    expect(response.statusCode).toBe(422);
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

  it("rejects invalid expectedRevision without changing files", async () => {
    const project = await createProject();
    const before = await projectFiles(project.metadata.id);

    const invalidRevision = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/source`,
      payload: { markdown: "not saved", expectedRevision: "0" }
    });
    expect(parseError(invalidRevision).code).toBe("REQUEST_VALIDATION_FAILED");

    expect(await projectFiles(project.metadata.id)).toEqual(before);
  });

  it("rejects stale source mutations with 409 and keeps the pair unchanged", async () => {
    const project = await createProject();
    const first = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/source`,
      payload: { markdown: "first", expectedRevision: 0 }
    });
    expect(projectMutationResponseSchema.parse(first.json()).revision).toBe(1);
    const before = await projectFiles(project.metadata.id);

    const staleSource = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/source`,
      payload: { markdown: "stale source", expectedRevision: 0 }
    });
    expect(parseError(staleSource).code).toBe("PROJECT_REVISION_CONFLICT");
    expect(staleSource.statusCode).toBe(409);

    expect(await projectFiles(project.metadata.id)).toEqual(before);
  });

  it("reads the physical source without requiring a project source field", async () => {
    const project = await createProject();
    const directory = path.join(workspaceRoot, "projects", project.metadata.id);
    const tampered = "tampered private markdown";
    await fs.writeFile(
      path.join(directory, "source", "source.md"),
      tampered,
      "utf8"
    );

    const readResponse = await server.app.inject({
      method: "GET",
      url: `/api/projects/${project.metadata.id}/source`
    });
    const source = projectSourceReadResponseSchema.parse(readResponse.json());
    expect(readResponse.statusCode).toBe(200);
    expect(source.data.markdown).toBe(tampered);
    expect(source.data.sha256).toBe(
      createHash("sha256").update(tampered).digest("hex")
    );
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
      projectBriefSaveRequestSchema.safeParse({
        brief: {},
        expectedRevision: 0,
        extra: true
      }).success
    ).toBe(false);
  });
});
