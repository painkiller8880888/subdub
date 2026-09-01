import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import { createScriptSection } from "../../src/app/projects/starter-script-sections.js";
import {
  apiErrorResponseSchema,
  projectDetailResponseSchema,
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

  it("supports section create, reorder, deactivate, reactivate, and persistence", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-script-section-lifecycle-")
    );
    roots.push(workspaceRoot);
    const server = await initializeServer({ workspaceRoot });
    servers.push(server);

    const createdResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "Script section lifecycle project" }
    });
    const created = projectCreateResponseSchema.parse(
      createdResponse.json()
    ).data;
    const originalSectionIds = created.script.sections.map(
      (section) => section.id
    );
    const addedSection = createScriptSection(
      "client-provided-section",
      "追加セクション"
    );
    const reorderedCandidate = {
      ...created.script,
      sections: [
        created.script.sections[2]!,
        created.script.sections[0]!,
        created.script.sections[1]!,
        addedSection
      ]
    };

    const createResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/script`,
      payload: {
        script: reorderedCandidate,
        expectedRevision: created.revision
      }
    });
    expect(createResponse.statusCode).toBe(200);
    const createdSection = projectMutationResponseSchema.parse(
      createResponse.json()
    ).data;
    expect(createdSection.revision).toBe(1);
    expect(createdSection.script.sections.map((section) => section.id)).toEqual(
      [
        originalSectionIds[2],
        originalSectionIds[0],
        originalSectionIds[1],
        expect.stringMatching(/^script-section-/)
      ]
    );
    const addedSectionId = createdSection.script.sections.at(-1)!.id;
    expect(addedSectionId).not.toBe(addedSection.id);
    expect(createdSection.script.sections.at(-1)).toEqual(
      createScriptSection(addedSectionId, "追加セクション")
    );

    const deactivatedCandidate = {
      ...createdSection.script,
      sections: createdSection.script.sections.map((section) => ({
        ...section,
        enabled: false,
        ...(section.id === addedSectionId
          ? { screenTemplateId: "missing-while-disabled" }
          : {})
      }))
    };
    const deactivationResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/script`,
      payload: {
        script: deactivatedCandidate,
        expectedRevision: createdSection.revision
      }
    });
    expect(deactivationResponse.statusCode).toBe(200);
    const deactivated = projectMutationResponseSchema.parse(
      deactivationResponse.json()
    ).data;
    expect(deactivated.revision).toBe(2);
    expect(
      deactivated.script.sections.every((section) => !section.enabled)
    ).toBe(true);
    expect(deactivated.script.sections.at(-1)?.screenTemplateId).toBe(
      "missing-while-disabled"
    );

    const reorderedDisabledCandidate = {
      ...deactivated.script,
      sections: [...deactivated.script.sections]
        .reverse()
        .map((section, index) =>
          index === 0 ? { ...section, name: "無効中に変更した名前" } : section
        )
    };
    const disabledReorderResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/script`,
      payload: {
        script: reorderedDisabledCandidate,
        expectedRevision: deactivated.revision
      }
    });
    expect(disabledReorderResponse.statusCode).toBe(200);
    const reorderedDisabled = projectMutationResponseSchema.parse(
      disabledReorderResponse.json()
    ).data;
    expect(reorderedDisabled.revision).toBe(3);
    expect(
      reorderedDisabled.script.sections.map((section) => section.id)
    ).toEqual(
      [...deactivated.script.sections].reverse().map((section) => section.id)
    );

    const reactivatedCandidate = {
      ...reorderedDisabled.script,
      sections: reorderedDisabled.script.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              name: "再有効化したセクション",
              enabled: true,
              screenTemplateId: "screen-template-standard"
            }
          : section
      )
    };
    const reactivateResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/script`,
      payload: {
        script: reactivatedCandidate,
        expectedRevision: reorderedDisabled.revision
      }
    });
    expect(reactivateResponse.statusCode).toBe(200);
    const reactivated = projectMutationResponseSchema.parse(
      reactivateResponse.json()
    ).data;
    expect(reactivated.revision).toBe(4);
    expect(reactivated.script.sections[0]).toMatchObject({
      id: addedSectionId,
      name: "再有効化したセクション",
      enabled: true
    });

    await server.app.close();
    servers.splice(servers.indexOf(server), 1);
    const reloadedServer = await initializeServer({ workspaceRoot });
    servers.push(reloadedServer);
    const reloadedResponse = await reloadedServer.app.inject({
      method: "GET",
      url: `/api/projects/${created.metadata.id}`
    });
    const reloaded = projectDetailResponseSchema.parse(
      reloadedResponse.json()
    ).data;
    expect(reloaded).toEqual(reactivated);

    const staleResponse = await reloadedServer.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/script`,
      payload: {
        script: reloaded.script,
        expectedRevision: 0
      }
    });
    expect(staleResponse.statusCode).toBe(409);
    expect(apiErrorResponseSchema.parse(staleResponse.json()).error.code).toBe(
      "PROJECT_REVISION_CONFLICT"
    );

    const projectFilePath = path.join(
      workspaceRoot,
      "projects",
      created.metadata.id,
      "project.json"
    );
    const beforeHardDelete = await fs.readFile(projectFilePath);
    const hardDeleteResponse = await reloadedServer.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/script`,
      payload: {
        script: {
          ...reloaded.script,
          sections: reloaded.script.sections.slice(1)
        },
        expectedRevision: reloaded.revision
      }
    });
    expect(hardDeleteResponse.statusCode).toBe(422);
    const hardDeleteError = apiErrorResponseSchema.parse(
      hardDeleteResponse.json()
    ).error;
    expect(hardDeleteError.code).toBe("SCRIPT_VALIDATION_FAILED");
    expect(hardDeleteError.details[0]?.message).toContain(
      "cannot be hard-deleted"
    );
    expect(await fs.readFile(projectFilePath)).toEqual(beforeHardDelete);

    const deleteResponse = await reloadedServer.app.inject({
      method: "DELETE",
      url: `/api/projects/${created.metadata.id}/script`
    });
    expect(deleteResponse.statusCode).toBe(404);
  });
});
