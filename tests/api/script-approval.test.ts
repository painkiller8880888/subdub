import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  projectCreateResponseSchema
} from "../../src/schema/api.js";

describe("legacy script workflow APIs", () => {
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

  it("retires initialization and approval because V19 starts with a script", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-script-approval-")
    );
    roots.push(workspaceRoot);
    const server = await initializeServer({ workspaceRoot });
    servers.push(server);

    const createdResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "Script approval project" }
    });
    const created = projectCreateResponseSchema.parse(
      createdResponse.json()
    ).data;

    for (const pathSuffix of ["script/initialize", "script/approve"]) {
      const response = await server.app.inject({
        method: "POST",
        url: `/api/projects/${created.metadata.id}/${pathSuffix}`,
        payload: { expectedRevision: created.revision }
      });
      expect(response.statusCode).toBe(404);
      expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
        "API_NOT_FOUND"
      );
    }
  });
});
