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
  visualAssignmentResponseSchema,
  visualAssignmentSplitRequestSchema
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

function videoAssignmentPayload(volume = 0.25) {
  const source = videoProjectFixture.visuals.assignments[0];
  if (source?.display.kind !== "video") {
    throw new Error("fixture must contain a video assignment");
  }
  return {
    id: "api-video-assignment",
    startLineId: source.startLineId,
    endLineId: source.endLineId,
    assetId: source.assetId,
    display: { ...structuredClone(source.display), volume }
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

  it("accepts the line-boundary split request and preserves the exact asset version", async () => {
    let receivedProjectId: unknown;
    let receivedAssignmentId: unknown;
    let receivedInput: unknown;
    const app = buildApp({
      visualAssignmentService: {
        assign: async () => ({ data: videoProjectFixture, revision: 1 }),
        split: async (projectId, assignmentId, input) => {
          receivedProjectId = projectId;
          receivedAssignmentId = assignmentId;
          receivedInput = input;
          return { data: videoProjectFixture, revision: 5 };
        }
      }
    });
    apps.push(app);

    const payload = {
      expectedRevision: 4,
      selectedLineId: "main-learner-1",
      assetVersion: 2,
      assignment: {
        id: "api-split-replacement",
        assetId: "asset-photo"
      }
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/projects/api-project/visual-assignments/api-visual-assignment/split",
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(visualAssignmentResponseSchema.parse(response.json()).revision).toBe(
      5
    );
    expect(receivedProjectId).toBe("api-project");
    expect(receivedAssignmentId).toBe("api-visual-assignment");
    expect(receivedInput).toEqual({
      ...payload,
      removeOutsidePlaybackCues: false
    });
    expect(visualAssignmentSplitRequestSchema.parse(payload)).toEqual({
      ...payload,
      removeOutsidePlaybackCues: false
    });
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

  it("passes an arbitrary generic video volume through the API contract", async () => {
    let receivedInput: unknown;
    const app = buildApp({
      visualAssignmentService: {
        assign: async (_projectId, input) => {
          receivedInput = input;
          return { data: videoProjectFixture, revision: 1 };
        }
      }
    });
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/projects/api-project/visual-assignments",
      payload: {
        expectedRevision: 0,
        assignment: videoAssignmentPayload(0.25)
      }
    });

    expect(response.statusCode).toBe(200);
    expect(receivedInput).toEqual({
      expectedRevision: 0,
      assignment: videoAssignmentPayload(0.25)
    });
  });

  it.each([-0.01, 1.01])(
    "rejects generic video volume %s outside the 0..1 range",
    async (volume) => {
      const app = buildApp({
        visualAssignmentService: {
          assign: async () => ({ data: videoProjectFixture, revision: 1 })
        }
      });
      apps.push(app);

      const response = await app.inject({
        method: "PUT",
        url: "/api/projects/api-project/visual-assignments",
        payload: {
          expectedRevision: 0,
          assignment: videoAssignmentPayload(volume)
        }
      });

      expect(response.statusCode).toBe(422);
      expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
        "REQUEST_VALIDATION_FAILED"
      );
    }
  );

  it("does not accept legacy muted as a generic video API field", async () => {
    const app = buildApp({
      visualAssignmentService: {
        assign: async () => ({ data: videoProjectFixture, revision: 1 })
      }
    });
    apps.push(app);
    const assignment = videoAssignmentPayload(0.25) as {
      display: Record<string, unknown>;
    };
    assignment.display.muted = false;

    const response = await app.inject({
      method: "PUT",
      url: "/api/projects/api-project/visual-assignments",
      payload: {
        expectedRevision: 0,
        assignment
      }
    });

    expect(response.statusCode).toBe(422);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
      "REQUEST_VALIDATION_FAILED"
    );
  });

  it.each([
    [VISUAL_ASSIGNMENT_ERROR_CODE.assetNotFound, 404],
    [VISUAL_ASSIGNMENT_ERROR_CODE.displayKindMismatch, 422],
    [VISUAL_ASSIGNMENT_ERROR_CODE.assignmentRangeInvalid, 422],
    [VISUAL_ASSIGNMENT_ERROR_CODE.assignmentOverlap, 422],
    [VISUAL_ASSIGNMENT_ERROR_CODE.rangeShorteningConfirmationRequired, 409],
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

  it("supports assignment update, removal, and explicit visual approval", async () => {
    const calls: string[] = [];
    const app = buildApp({
      visualAssignmentService: {
        assign: async () => ({ data: videoProjectFixture, revision: 1 }),
        update: async (_projectId, assignmentId, input) => {
          calls.push(
            `update:${assignmentId}:${(input as { expectedRevision: number }).expectedRevision}`
          );
          return { data: videoProjectFixture, revision: 2 };
        },
        remove: async (_projectId, assignmentId, input) => {
          calls.push(
            `remove:${assignmentId}:${(input as { expectedRevision: number }).expectedRevision}`
          );
          return { data: videoProjectFixture, revision: 3 };
        },
        approve: async (_projectId, input) => {
          calls.push(
            `approve:${(input as { expectedRevision: number }).expectedRevision}`
          );
          return { data: videoProjectFixture, revision: 4 };
        }
      }
    });
    apps.push(app);

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/projects/api-project/visual-assignments/api-visual-assignment",
      payload: {
        expectedRevision: 1,
        assignment: assignmentPayload()
      }
    });
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/projects/api-project/visual-assignments/api-visual-assignment",
      payload: { expectedRevision: 2 }
    });
    const approveResponse = await app.inject({
      method: "POST",
      url: "/api/projects/api-project/visuals/approve",
      payload: { expectedRevision: 3 }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(deleteResponse.statusCode).toBe(200);
    expect(approveResponse.statusCode).toBe(200);
    expect(
      visualAssignmentResponseSchema.parse(updateResponse.json()).revision
    ).toBe(2);
    expect(
      visualAssignmentResponseSchema.parse(deleteResponse.json()).revision
    ).toBe(3);
    expect(
      visualAssignmentResponseSchema.parse(approveResponse.json()).revision
    ).toBe(4);
    expect(calls).toEqual([
      "update:api-visual-assignment:1",
      "remove:api-visual-assignment:2",
      "approve:3"
    ]);
  });

  it("passes an explicit asset version through the update contract", async () => {
    let receivedInput: unknown;
    const app = buildApp({
      visualAssignmentService: {
        assign: async () => ({ data: videoProjectFixture, revision: 1 }),
        update: async (_projectId, _assignmentId, input) => {
          receivedInput = input;
          return { data: videoProjectFixture, revision: 2 };
        },
        remove: async () => ({ data: videoProjectFixture, revision: 3 }),
        approve: async () => ({ data: videoProjectFixture, revision: 4 })
      }
    });
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/projects/api-project/visual-assignments/api-visual-assignment",
      payload: {
        expectedRevision: 1,
        assetVersion: 2,
        assignment: assignmentPayload()
      }
    });

    expect(response.statusCode).toBe(200);
    expect(receivedInput).toEqual({
      expectedRevision: 1,
      assetVersion: 2,
      assignment: assignmentPayload()
    });
  });

  it("returns 422 for an update with an URL/body assignment ID mismatch", async () => {
    const app = buildApp({
      visualAssignmentService: {
        assign: async () => ({ data: videoProjectFixture, revision: 1 }),
        update: async () => {
          throw new VisualAssignmentError(
            VISUAL_ASSIGNMENT_ERROR_CODE.assignmentIdMismatch,
            422,
            "safe mismatch message"
          );
        },
        remove: async () => ({ data: videoProjectFixture, revision: 2 }),
        approve: async () => ({ data: videoProjectFixture, revision: 2 })
      }
    });
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/api/projects/api-project/visual-assignments/other-assignment",
      payload: {
        expectedRevision: 1,
        assignment: assignmentPayload()
      }
    });
    expect(response.statusCode).toBe(422);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
      VISUAL_ASSIGNMENT_ERROR_CODE.assignmentIdMismatch
    );
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
