import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  projectCreateResponseSchema,
  projectDetailResponseSchema,
  projectListResponseSchema
} from "../../src/schema/api.js";

describe("project API", () => {
  let workspaceRoot: string;
  let server: Awaited<ReturnType<typeof initializeServer>>;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-api-")
    );
    server = await initializeServer({ workspaceRoot });
  });

  afterEach(async () => {
    await server.app.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  function expectApiError(
    response: {
      statusCode: number;
      json(): unknown;
    },
    statusCode: number
  ) {
    expect(response.statusCode).toBe(statusCode);
    const parsed = apiErrorResponseSchema.parse(response.json());
    expect(parsed.error.requestId).not.toBe("");
    return parsed.error;
  }

  it("returns an empty list for an empty workspace", async () => {
    const response = await server.app.inject({
      method: "GET",
      url: "/api/projects"
    });

    expect(response.statusCode).toBe(200);
    expect(projectListResponseSchema.parse(response.json())).toEqual({
      data: []
    });
  });

  it("creates a project file and reads it through list and detail APIs", async () => {
    const createResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        title: "申請手順の基本",
        department: "総務部",
        manualVersion: "2026.08"
      }
    });
    const created = projectCreateResponseSchema.parse(createResponse.json());

    expect(createResponse.statusCode).toBe(200);
    expect(created.revision).toBe(0);
    expect(created.data.revision).toBe(0);
    expect(created.data.metadata.title).toBe("申請手順の基本");
    expect(created.data.metadata.department).toBe("総務部");
    expect(created.data.metadata.manualVersion).toBe("2026.08");

    const projectFile = path.join(
      workspaceRoot,
      "projects",
      created.data.metadata.id,
      "project.json"
    );
    await expect(fs.access(projectFile)).resolves.toBeUndefined();
    const savedProject = JSON.parse(await fs.readFile(projectFile, "utf8"));
    expect(savedProject).toEqual(created.data);

    const listResponse = await server.app.inject({
      method: "GET",
      url: "/api/projects"
    });
    const listed = projectListResponseSchema.parse(listResponse.json());
    expect(listed.data).toEqual([
      {
        id: created.data.metadata.id,
        title: created.data.metadata.title,
        department: created.data.metadata.department,
        manualVersion: created.data.metadata.manualVersion,
        revision: 0,
        createdAt: created.data.metadata.createdAt,
        updatedAt: created.data.metadata.updatedAt
      }
    ]);

    const detailResponse = await server.app.inject({
      method: "GET",
      url: `/api/projects/${created.data.metadata.id}`
    });
    const detail = projectDetailResponseSchema.parse(detailResponse.json());
    expect(detail).toEqual({ data: created.data });
  });

  it("rejects unknown and invalid create input with the common error shape", async () => {
    const unknownKeyResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "入力テスト", unknown: true }
    });
    const unknownKeyError = expectApiError(unknownKeyResponse, 422);
    expect(unknownKeyError.code).toBe("REQUEST_VALIDATION_FAILED");

    const invalidValueResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "   " }
    });
    const invalidValueError = expectApiError(invalidValueResponse, 422);
    expect(invalidValueError.code).toBe("REQUEST_VALIDATION_FAILED");

    const listResponse = await server.app.inject({
      method: "GET",
      url: "/api/projects"
    });
    expect(projectListResponseSchema.parse(listResponse.json()).data).toEqual(
      []
    );
  });

  it("maps invalid, missing, malformed, and schema-invalid projects safely", async () => {
    const invalidIdResponse = await server.app.inject({
      method: "GET",
      url: "/api/projects/invalid_id"
    });
    expect(expectApiError(invalidIdResponse, 400).code).toBe(
      "PROJECT_ID_INVALID"
    );

    const missingResponse = await server.app.inject({
      method: "GET",
      url: "/api/projects/missing-project"
    });
    expectApiError(missingResponse, 404);

    const projectDirectory = path.join(
      workspaceRoot,
      "projects",
      "broken-project"
    );
    await fs.mkdir(projectDirectory, { recursive: true });
    const projectFile = path.join(projectDirectory, "project.json");
    await fs.writeFile(projectFile, '{"schemaVersion":', "utf8");

    const malformedResponse = await server.app.inject({
      method: "GET",
      url: "/api/projects/broken-project"
    });
    const malformedError = expectApiError(malformedResponse, 422);
    expect(malformedError.code).toBe("PROJECT_JSON_PARSE_FAILED");
    expect(JSON.stringify(malformedError)).not.toContain(workspaceRoot);

    await fs.writeFile(projectFile, '{"schemaVersion":"1.0.0"}', "utf8");
    const schemaInvalidResponse = await server.app.inject({
      method: "GET",
      url: "/api/projects/broken-project"
    });
    const schemaInvalidError = expectApiError(schemaInvalidResponse, 422);
    expect(schemaInvalidError.code).toBe("PROJECT_CURRENT_VALIDATION_FAILED");
    expect(JSON.stringify(schemaInvalidError)).not.toContain(workspaceRoot);
  });

  it("sorts summaries deterministically and excludes create temp directories", async () => {
    const repository = new ProjectRepository(workspaceRoot);
    await repository.create(
      createEmptyVideoProject({
        projectId: "same-time-zeta",
        title: "同時刻Z",
        createdAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-04T01:00:00.000Z"
      })
    );
    await repository.create(
      createEmptyVideoProject({
        projectId: "same-time-alpha",
        title: "同時刻A",
        createdAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-04T01:00:00.000Z"
      })
    );
    await repository.create(
      createEmptyVideoProject({
        projectId: "newer-project",
        title: "新しいプロジェクト",
        createdAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-04T02:00:00.000Z"
      })
    );
    await fs.mkdir(
      path.join(workspaceRoot, "projects", ".subdub-project-temporary.123.tmp")
    );

    const response = await server.app.inject({
      method: "GET",
      url: "/api/projects"
    });
    const listed = projectListResponseSchema.parse(response.json());

    expect(listed.data.map((project) => project.id)).toEqual([
      "newer-project",
      "same-time-alpha",
      "same-time-zeta"
    ]);
  });

  it("rejects a project symlink that escapes the workspace during listing", async () => {
    const outsideRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-api-outside-")
    );
    try {
      const outsideProject = createEmptyVideoProject({
        projectId: "escaped-project",
        createdAt: "2026-08-04T00:00:00.000Z"
      });
      const outsideProjectFile = path.join(outsideRoot, "project.json");
      await fs.writeFile(
        outsideProjectFile,
        `${JSON.stringify(outsideProject, null, 2)}\n`,
        "utf8"
      );

      try {
        await fs.symlink(
          outsideRoot,
          path.join(workspaceRoot, "projects", "escaped-project"),
          process.platform === "win32" ? "junction" : "dir"
        );
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

      const response = await server.app.inject({
        method: "GET",
        url: "/api/projects"
      });
      const apiError = expectApiError(response, 400);
      expect(apiError.code).toBe("PROJECT_PATH_INVALID");
      expect(JSON.stringify(apiError)).not.toContain(outsideRoot);
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
