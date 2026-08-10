import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/api/app.js";
import { initializeServer } from "../../src/api/server.js";
import { ProjectRepositoryError } from "../../src/app/projects/project-repository.js";
import {
  VISUAL_ASSIGNMENT_ERROR_CODE,
  VisualAssignmentError
} from "../../src/app/projects/visual-assignment-errors.js";
import {
  apiErrorResponseSchema,
  projectMutationResponseSchema,
  visualAssignmentResponseSchema
} from "../../src/schema/api.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function assignmentPayload() {
  return {
    id: "api-visual-assignment",
    startLineId: "main-mentor-1",
    endLineId: "main-learner-1",
    assetId: "asset-photo",
    display: structuredClone(videoProjectFixture.visuals.assignments[1].display)
  };
}

describe("visual assignments API", () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("accepts the strict request and returns the saved project with its revision", async () => {
    let receivedProjectId: unknown;
    let receivedInput: unknown;
    const app = buildApp({
      visualAssignmentService: {
        assign: async (projectId, input) => {
          receivedProjectId = projectId;
          receivedInput = input;
          return { data: videoProjectFixture, revision: 4 };
        }
      }
    });
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/projects/api-project/visual-assignments",
      payload: {
        expectedRevision: 3,
        assignment: assignmentPayload()
      }
    });

    expect(response.statusCode).toBe(200);
    expect(visualAssignmentResponseSchema.parse(response.json())).toEqual({
      data: videoProjectFixture,
      revision: 4
    });
    expect(receivedProjectId).toBe("api-project");
    expect(receivedInput).toEqual({
      expectedRevision: 3,
      assignment: assignmentPayload()
    });
    expect(projectMutationResponseSchema.parse(response.json()).revision).toBe(
      4
    );
  });

  it("rejects client-owned checksum and project paths as unknown fields", async () => {
    const app = buildApp({
      visualAssignmentService: {
        assign: async () => ({ data: videoProjectFixture, revision: 1 })
      }
    });
    apps.push(app);

    const checksumResponse = await app.inject({
      method: "PUT",
      url: "/api/projects/api-project/visual-assignments",
      payload: {
        expectedRevision: 0,
        assignment: {
          ...assignmentPayload(),
          assetChecksum: "a".repeat(64)
        }
      }
    });
    const pathResponse = await app.inject({
      method: "PUT",
      url: "/api/projects/api-project/visual-assignments",
      payload: {
        expectedRevision: 0,
        assignment: {
          ...assignmentPayload(),
          projectMediaPath: "media/unsafe.png"
        }
      }
    });

    expect(checksumResponse.statusCode).toBe(422);
    expect(pathResponse.statusCode).toBe(422);
    expect(
      apiErrorResponseSchema.parse(checksumResponse.json()).error.code
    ).toBe("REQUEST_VALIDATION_FAILED");
    expect(apiErrorResponseSchema.parse(pathResponse.json()).error.code).toBe(
      "REQUEST_VALIDATION_FAILED"
    );
  });

  it.each([
    [VISUAL_ASSIGNMENT_ERROR_CODE.assetNotFound, 404],
    [VISUAL_ASSIGNMENT_ERROR_CODE.displayKindMismatch, 422],
    [VISUAL_ASSIGNMENT_ERROR_CODE.copyFailed, 500],
    [VISUAL_ASSIGNMENT_ERROR_CODE.cleanupFailed, 500]
  ] as const)(
    "maps %s to the common API error envelope",
    async (code, status) => {
      const app = buildApp({
        visualAssignmentService: {
          assign: async () => {
            throw new VisualAssignmentError(
              code,
              status,
              "safe public message"
            );
          }
        }
      });
      apps.push(app);

      const response = await app.inject({
        method: "PUT",
        url: "/api/projects/api-project/visual-assignments",
        payload: {
          expectedRevision: 0,
          assignment: assignmentPayload()
        }
      });
      const error = apiErrorResponseSchema.parse(response.json()).error;

      expect(response.statusCode).toBe(status);
      expect(error.code).toBe(code);
      expect(error.message).toBe("safe public message");
    }
  );

  it("preserves the existing revision conflict mapping", async () => {
    const app = buildApp({
      visualAssignmentService: {
        assign: async () => {
          throw new ProjectRepositoryError(
            "PROJECT_REVISION_CONFLICT",
            409,
            "internal revision detail"
          );
        }
      }
    });
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/projects/api-project/visual-assignments",
      payload: {
        expectedRevision: 0,
        assignment: assignmentPayload()
      }
    });
    const error = apiErrorResponseSchema.parse(response.json()).error;

    expect(response.statusCode).toBe(409);
    expect(error.code).toBe("PROJECT_REVISION_CONFLICT");
    expect(error.message).toBe("プロジェクトが別の内容へ更新されています。");
    expect(JSON.stringify(error)).not.toContain("internal revision detail");
  });

  it("registers the route when initializeServer supplies the application service", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-visual-assignment-server-")
    );
    roots.push(workspaceRoot);
    const initialized = await initializeServer({
      workspaceRoot,
      visualAssignmentService: {
        assign: async () => ({ data: videoProjectFixture, revision: 2 })
      }
    });

    const response = await initialized.app.inject({
      method: "PUT",
      url: "/api/projects/api-project/visual-assignments",
      payload: {
        expectedRevision: 1,
        assignment: assignmentPayload()
      }
    });

    expect(response.statusCode).toBe(200);
    expect(visualAssignmentResponseSchema.parse(response.json()).revision).toBe(
      2
    );
    await initialized.app.close();
  });
});
