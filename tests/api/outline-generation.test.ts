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

describe("legacy outline generation API", () => {
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

  it("rejects outline generation for a 1.9.0 project", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-outline-api-")
    );
    roots.push(workspaceRoot);
    const server = await initializeServer({ workspaceRoot });
    servers.push(server);

    const createdResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "構成案API" }
    });
    const created = projectCreateResponseSchema.parse(
      createdResponse.json()
    ).data;

    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${created.metadata.id}/outline/generate`,
      payload: { expectedRevision: created.revision }
    });
    expect(response.statusCode).toBe(422);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
      "PROJECT_CANDIDATE_VALIDATION_FAILED"
    );

    const detail = await server.app.inject({
      method: "GET",
      url: `/api/projects/${created.metadata.id}`
    });
    const project = projectDetailResponseSchema.parse(detail.json()).data;
    expect(project.schemaVersion).toBe("1.9.0");
    expect(project).not.toHaveProperty("outline");
  });
});
