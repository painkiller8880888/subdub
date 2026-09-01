import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  projectCreateResponseSchema,
  projectMutationResponseSchema
} from "../../src/schema/api.js";
import { createDefaultScriptLine } from "../../src/web/script-editor.js";

describe("V19 script editing API", () => {
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

  it("saves a current script without legacy status or outline linkage", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-script-edit-")
    );
    roots.push(workspaceRoot);
    const server = await initializeServer({ workspaceRoot });
    servers.push(server);

    const createdResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "Script editing project" }
    });
    const created = projectCreateResponseSchema.parse(
      createdResponse.json()
    ).data;
    const script = structuredClone(created.script);
    const firstSection = script.sections[0];
    if (firstSection === undefined) {
      throw new Error("the V19 project must contain starter sections");
    }
    firstSection.lines = [
      createDefaultScriptLine("character-mentor", "script-line-1", "説明")
    ];

    const response = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/script`,
      payload: { script, expectedRevision: created.revision }
    });
    expect(response.statusCode).toBe(200);
    const saved = projectMutationResponseSchema.parse(response.json()).data;
    expect(saved.schemaVersion).toBe("1.9.0");
    expect(saved.script.sections.slice(1)).toEqual(script.sections.slice(1));
    expect(saved.script.sections[0]).toMatchObject({
      ...script.sections[0],
      lines: [
        {
          ...script.sections[0]?.lines[0],
          id: expect.stringMatching(/^script-line-/)
        }
      ]
    });
    expect(saved.script).not.toHaveProperty("status");
    expect(saved.script.sections[0]).not.toHaveProperty("outlineSectionId");
  });

  it("rejects malformed script input without changing the project", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-script-edit-invalid-")
    );
    roots.push(workspaceRoot);
    const server = await initializeServer({ workspaceRoot });
    servers.push(server);

    const createdResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "Script validation project" }
    });
    const created = projectCreateResponseSchema.parse(
      createdResponse.json()
    ).data;
    const response = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/script`,
      payload: {
        script: { sections: [{ id: "duplicate", name: "invalid" }] },
        expectedRevision: created.revision
      }
    });

    expect(response.statusCode).toBe(422);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
      "REQUEST_VALIDATION_FAILED"
    );
  });
});
