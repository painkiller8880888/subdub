import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import { computeOutlineHash } from "../../src/app/projects/script-domain.js";
import { reconcileScriptLineIds } from "../../src/web/script-editor.js";
import {
  apiErrorResponseSchema,
  projectCreateResponseSchema,
  projectDetailResponseSchema,
  projectMutationResponseSchema
} from "../../src/schema/api.js";
import type { Outline, Script, VideoProject } from "../../src/schema/index.js";

function outlineFor(
  project: VideoProject,
  status: Outline["status"] = "needs_review"
): Outline {
  const makeSection = (
    id: string,
    order: number,
    role: Outline["sections"][number]["role"],
    title: string
  ): Outline["sections"][number] => ({
    id,
    order,
    role,
    title,
    overview: `${title} overview`,
    keyPoints: [`${title} point`],
    targetDurationSec: 10,
    sourceRefs: [{ sourceId: project.source.id, headingPath: [title] }],
    openQuestions: [],
    humanDirectives: {
      requiredItems: [],
      prohibitedItems: [],
      scriptConstraints: []
    },
    lockedFields: []
  });

  return {
    status,
    sourceHash: project.source.sha256,
    generationRunId: "outline-run",
    openQuestions: [],
    sections: [
      makeSection("outline-intro", 1, "intro", "はじめに"),
      makeSection("outline-main", 2, "main", "操作手順"),
      makeSection("outline-outro", 3, "outro", "完了確認")
    ]
  };
}

describe("script editing API", () => {
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

  async function setup(approve = true): Promise<{
    server: (typeof servers)[number];
    project: VideoProject;
  }> {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-script-")
    );
    roots.push(workspaceRoot);
    const server = await initializeServer({ workspaceRoot });
    servers.push(server);
    const createdResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "Script project" }
    });
    const created = projectCreateResponseSchema.parse(
      createdResponse.json()
    ).data;
    const outlineResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/outline`,
      payload: {
        outline: outlineFor(created),
        expectedRevision: created.revision
      }
    });
    const outlined = projectMutationResponseSchema.parse(
      outlineResponse.json()
    ).data;
    if (!approve) {
      return {
        server,
        project: projectMutationResponseSchema.parse(outlineResponse.json())
          .data
      };
    }
    const approvedResponse = await server.app.inject({
      method: "POST",
      url: `/api/projects/${created.metadata.id}/outline/approve`,
      payload: { expectedRevision: outlined.revision }
    });
    expect(approvedResponse.statusCode).toBe(200);
    return {
      server,
      project: projectMutationResponseSchema.parse(approvedResponse.json()).data
    };
  }

  function parseError(response: { statusCode: number; json(): unknown }) {
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    return apiErrorResponseSchema.parse(response.json()).error;
  }

  async function initialize(
    server: (typeof servers)[number],
    project: VideoProject
  ): Promise<VideoProject> {
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/script/initialize`,
      payload: { expectedRevision: project.revision }
    });
    expect(response.statusCode).toBe(200);
    return projectMutationResponseSchema.parse(response.json()).data;
  }

  it("initializes an empty script from an approved outline in order", async () => {
    const { server, project } = await setup();
    const initialized = await initialize(server, project);

    expect(initialized.script.status).toBe("draft");
    expect(initialized.script.origin).toBe("manual");
    expect(initialized.script.outlineHash).toBe(
      computeOutlineHash(project.outline)
    );
    expect(
      initialized.script.sections.map((section) => section.outlineSectionId)
    ).toEqual(project.outline.sections.map((section) => section.id));
    expect(initialized.script.sections.map((section) => section.name)).toEqual(
      project.outline.sections.map((section) => section.title)
    );
    expect(
      initialized.script.sections.every((section) => section.lines.length === 0)
    ).toBe(true);
  });

  it("does not initialize from an unapproved outline or change the file", async () => {
    const { server, project } = await setup(false);
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/script/initialize`,
      payload: { expectedRevision: project.revision }
    });

    expect(parseError(response)).toMatchObject({
      code: "SCRIPT_INITIALIZATION_NOT_ALLOWED"
    });
    const reloaded = projectDetailResponseSchema.parse(
      (
        await server.app.inject({
          method: "GET",
          url: `/api/projects/${project.metadata.id}`
        })
      ).json()
    ).data;
    expect(reloaded.script).toEqual(project.script);
    expect(reloaded.revision).toBe(project.revision);
  });

  it("saves only script data, keeps existing IDs, and issues IDs for new and copied lines", async () => {
    const { server, project } = await setup();
    const initialized = await initialize(server, project);
    const [firstSection, secondSection] = initialized.script.sections;
    if (firstSection === undefined || secondSection === undefined) {
      throw new Error("initialized sections are missing");
    }
    const firstLine: Script["sections"][number]["lines"][number] = {
      id: "client-temp-line",
      speakerId: "character-mentor",
      spokenText: "案内します。",
      subtitleText: "案内します。",
      expression: "explain",
      characterVariantId: null,
      pauseBeforeMs: 0,
      pauseAfterMs: 250,
      voiceOverrides: {},
      pronunciation: { mode: "dictionary", excludedTermIds: [] }
    };
    const secondLine = {
      ...firstLine,
      id: "client-temp-line-2",
      speakerId: "character-learner",
      spokenText: "確認するのだ。",
      subtitleText: "確認するのだ。"
    };
    const candidate: Script = {
      ...initialized.script,
      sections: initialized.script.sections.map((section, index) =>
        index === 0 ? { ...section, lines: [firstLine, secondLine] } : section
      )
    };
    const saveResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/script`,
      payload: { script: candidate, expectedRevision: initialized.revision }
    });
    expect(saveResponse.statusCode).toBe(200);
    const saved = projectMutationResponseSchema.parse(saveResponse.json()).data;
    expect(saved.revision).toBe(initialized.revision + 1);
    expect(saved.metadata.updatedAt).not.toBe(initialized.metadata.updatedAt);
    expect(saved.script.sections[0]?.lines.map((line) => line.id)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^script-line-/),
        expect.stringMatching(/^script-line-/)
      ])
    );
    expect(saved.brief).toEqual(initialized.brief);
    expect(saved.characters).toEqual(initialized.characters);

    const reordered: Script = {
      ...saved.script,
      sections: saved.script.sections.map((section, index) =>
        index === 0
          ? { ...section, lines: [...section.lines].reverse() }
          : section
      )
    };
    const reorderedResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/script`,
      payload: { script: reordered, expectedRevision: saved.revision }
    });
    const reorderedProject = projectMutationResponseSchema.parse(
      reorderedResponse.json()
    ).data;
    expect(
      reorderedProject.script.sections[0]?.lines.map((line) => line.id)
    ).toEqual(reordered.sections[0]?.lines.map((line) => line.id));
  });

  it("rejects invalid lines, duplicate IDs, and stale revisions without changing project.json", async () => {
    const { server, project } = await setup();
    const initialized = await initialize(server, project);
    const line = {
      id: "invalid-line",
      speakerId: "missing-character",
      spokenText: " ",
      subtitleText: "字幕",
      expression: "neutral" as const,
      characterVariantId: null,
      pauseBeforeMs: 0.5,
      pauseAfterMs: -1,
      voiceOverrides: {},
      pronunciation: { mode: "dictionary" as const, excludedTermIds: [] }
    };
    const invalidScript: Script = {
      ...initialized.script,
      sections: initialized.script.sections.map((section, index) =>
        index === 0
          ? { ...section, lines: [line, { ...line, id: "invalid-line" }] }
          : section
      )
    };
    const invalidResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/script`,
      payload: { script: invalidScript, expectedRevision: initialized.revision }
    });
    expect(parseError(invalidResponse).code).toBe("REQUEST_VALIDATION_FAILED");
    const afterInvalid = projectDetailResponseSchema.parse(
      (
        await server.app.inject({
          method: "GET",
          url: `/api/projects/${project.metadata.id}`
        })
      ).json()
    ).data;
    expect(afterInvalid).toEqual(initialized);

    const validLine = {
      ...line,
      speakerId: "character-mentor",
      spokenText: "有効な本文",
      pauseBeforeMs: 0,
      pauseAfterMs: 0
    };
    const duplicateScript: Script = {
      ...initialized.script,
      sections: initialized.script.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              lines: [
                { ...validLine, id: "duplicate-line" },
                { ...validLine, id: "duplicate-line" }
              ]
            }
          : section
      )
    };
    const duplicateResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/script`,
      payload: {
        script: duplicateScript,
        expectedRevision: initialized.revision
      }
    });
    expect(parseError(duplicateResponse).code).toBe("SCRIPT_VALIDATION_FAILED");
    expect(
      projectDetailResponseSchema.parse(
        (
          await server.app.inject({
            method: "GET",
            url: `/api/projects/${project.metadata.id}`
          })
        ).json()
      ).data
    ).toEqual(initialized);

    const conflict = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/script`,
      payload: {
        script: initialized.script,
        expectedRevision: initialized.revision - 1
      }
    });
    expect(parseError(conflict).code).toBe("PROJECT_REVISION_CONFLICT");
    expect(
      projectDetailResponseSchema.parse(
        (
          await server.app.inject({
            method: "GET",
            url: `/api/projects/${project.metadata.id}`
          })
        ).json()
      ).data
    ).toEqual(initialized);
  });

  it("keeps a backend-issued line ID stable across an edited second save", async () => {
    const { server, project } = await setup();
    const initialized = await initialize(server, project);

    const firstDraft: Script = {
      ...initialized.script,
      sections: initialized.script.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              lines: [
                {
                  id: "draft-line-1",
                  speakerId: "character-mentor",
                  spokenText: "first saved text",
                  subtitleText: "first saved text",
                  expression: "neutral",
                  characterVariantId: null,
                  pauseBeforeMs: 0,
                  pauseAfterMs: 250,
                  voiceOverrides: {},
                  pronunciation: {
                    mode: "dictionary",
                    excludedTermIds: []
                  }
                }
              ]
            }
          : section
      )
    };
    const firstResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/script`,
      payload: { script: firstDraft, expectedRevision: initialized.revision }
    });
    const firstSaved = projectMutationResponseSchema.parse(
      firstResponse.json()
    ).data;
    const firstSavedLine = firstSaved.script.sections[0]?.lines[0];
    expect(firstSavedLine?.id).toMatch(/^script-line-/);

    const editedDraft: Script = {
      ...firstDraft,
      sections: firstDraft.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              lines: section.lines.map((line) => ({
                ...line,
                spokenText: "保存中に追加した編集"
              }))
            }
          : section
      )
    };
    const secondDraft = reconcileScriptLineIds(
      firstDraft,
      firstSaved.script,
      editedDraft
    );
    const secondResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/script`,
      payload: { script: secondDraft, expectedRevision: firstSaved.revision }
    });
    const secondSaved = projectMutationResponseSchema.parse(
      secondResponse.json()
    ).data;
    const secondSavedLine = secondSaved.script.sections[0]?.lines[0];

    expect(secondSavedLine?.id).toBe(firstSavedLine?.id);
    expect(secondSavedLine?.spokenText).toBe("保存中に追加した編集");
  });

  it("rejects unknown fields in script requests", async () => {
    const { server, project } = await setup();
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/script/initialize`,
      payload: { expectedRevision: project.revision, unknown: true }
    });
    expect(response.statusCode).toBe(422);
    expect(parseError(response).code).toBe("REQUEST_VALIDATION_FAILED");
  });
});
