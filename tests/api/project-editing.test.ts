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
  projectDetailResponseSchema,
  projectMutationResponseSchema,
  projectSourceReadResponseSchema
} from "../../src/schema/api.js";
import {
  videoProjectSchema,
  type VideoProject
} from "../../src/schema/index.js";

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
    expect(saved.data.source.sha256).toBe(
      createHash("sha256").update(files.source).digest("hex")
    );
    expect(savedJson.source.sha256).toBe(saved.data.source.sha256);
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

  it("saves every brief field without allowing other project fields to be replaced", async () => {
    const project = await createProject();
    const before = videoProjectSchema.parse(project);
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
    const saved = projectMutationResponseSchema.parse(response.json());

    expect(saved.data.brief).toEqual(brief);
    expect(saved.data.source).toEqual(before.source);
    expect(saved.data.metadata.id).toBe(before.metadata.id);
    expect(saved.data.metadata.title).toBe(before.metadata.title);
    expect(saved.data.metadata.createdAt).toBe(before.metadata.createdAt);
    expect(saved.data.characters).toEqual(before.characters);
    expect(saved.revision).toBe(1);

    const detail = await server.app.inject({
      method: "GET",
      url: `/api/projects/${project.metadata.id}`
    });
    expect(projectDetailResponseSchema.parse(detail.json()).data.brief).toEqual(
      brief
    );
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

  it("rejects invalid duration, unknown keys, and invalid expectedRevision without changing files", async () => {
    const project = await createProject();
    const before = await projectFiles(project.metadata.id);
    const validRequest = {
      brief: project.brief,
      expectedRevision: 0
    };

    const invalidDuration = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/brief`,
      payload: {
        ...validRequest,
        brief: { ...project.brief, targetDurationSec: 0 }
      }
    });
    expect(parseError(invalidDuration).code).toBe("REQUEST_VALIDATION_FAILED");

    const unknownKey = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/brief`,
      payload: { ...validRequest, unknown: true }
    });
    expect(parseError(unknownKey).code).toBe("REQUEST_VALIDATION_FAILED");

    const invalidRevision = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/source`,
      payload: { markdown: "not saved", expectedRevision: "0" }
    });
    expect(parseError(invalidRevision).code).toBe("REQUEST_VALIDATION_FAILED");

    expect(await projectFiles(project.metadata.id)).toEqual(before);
  });

  it("rejects stale source and brief mutations with 409 and keeps the pair unchanged", async () => {
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

    const staleBrief = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/brief`,
      payload: { brief: project.brief, expectedRevision: 0 }
    });
    expect(parseError(staleBrief).code).toBe("PROJECT_REVISION_CONFLICT");
    expect(staleBrief.statusCode).toBe(409);
    expect(await projectFiles(project.metadata.id)).toEqual(before);
  });

  it("returns a normalized hash mismatch error without exposing paths or Markdown", async () => {
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
    const error = parseError(readResponse);
    const serialized = JSON.stringify(error);
    expect(error.code).toBe("PROJECT_SOURCE_HASH_MISMATCH");
    expect(readResponse.statusCode).toBe(422);
    expect(serialized).not.toContain(workspaceRoot);
    expect(serialized).not.toContain(tampered);
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
