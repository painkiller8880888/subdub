import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  projectCreateResponseSchema,
  projectDetailResponseSchema
} from "../../src/schema/api.js";
import { legacyVideoProjectFixture } from "../fixtures/video-project.js";

describe("legacy outline APIs", () => {
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

  it("rejects legacy outline mutations for a 1.9.0 project", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-outline-edit-")
    );
    roots.push(workspaceRoot);
    const server = await initializeServer({ workspaceRoot });
    servers.push(server);

    const createdResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "Outline editing project" }
    });
    const created = projectCreateResponseSchema.parse(
      createdResponse.json()
    ).data;

    const responses = await Promise.all([
      server.app.inject({
        method: "PUT",
        url: `/api/projects/${created.metadata.id}/outline`,
        payload: {
          outline: legacyVideoProjectFixture.outline,
          expectedRevision: created.revision
        }
      }),
      server.app.inject({
        method: "POST",
        url: `/api/projects/${created.metadata.id}/outline/approve`,
        payload: { expectedRevision: created.revision }
      }),
      server.app.inject({
        method: "POST",
        url: `/api/projects/${created.metadata.id}/outline/reject`,
        payload: { expectedRevision: created.revision }
      }),
      server.app.inject({
        method: "POST",
        url: `/api/projects/${created.metadata.id}/outline/review`,
        payload: { expectedRevision: created.revision }
      })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(422);
      expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
        "PROJECT_CANDIDATE_VALIDATION_FAILED"
      );
    }

    const detail = await server.app.inject({
      method: "GET",
      url: `/api/projects/${created.metadata.id}`
    });
    const project = projectDetailResponseSchema.parse(detail.json()).data;
    expect(project).not.toHaveProperty("source");
    expect(project).not.toHaveProperty("brief");
    expect(project).not.toHaveProperty("outline");
  });
});
