import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { ImprovementLogRepository } from "../../src/app/projects/improvement-log-repository.js";
import {
  apiErrorResponseSchema,
  projectCreateResponseSchema,
  projectDetailResponseSchema,
  projectMutationResponseSchema
} from "../../src/schema/api.js";
import type { Outline, VideoProject } from "../../src/schema/index.js";

function outlineFor(project: VideoProject): Outline {
  const section = (
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
    status: "needs_review",
    sourceHash: project.source.sha256,
    generationRunId: "outline-edit-run",
    openQuestions: [],
    sections: [
      section("outline-intro", 1, "intro", "intro"),
      section("outline-main", 2, "main", "main"),
      section("outline-outro", 3, "outro", "outro")
    ]
  };
}

describe("outline editing and approval APIs", () => {
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

  async function setup(): Promise<{
    server: (typeof servers)[number];
    project: VideoProject;
    repository: ProjectRepository;
  }> {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-outline-edit-")
    );
    roots.push(workspaceRoot);
    const server = await initializeServer({
      workspaceRoot,
      projectService: undefined
    });
    servers.push(server);
    const createdResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "Outline editing project" }
    });
    const created = projectCreateResponseSchema.parse(
      createdResponse.json()
    ).data;
    const sourceResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/source`,
      payload: { markdown: "# intro\n\n# main\n\n# outro", expectedRevision: 0 }
    });
    const sourceProject = projectMutationResponseSchema.parse(
      sourceResponse.json()
    ).data;
    const briefResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${created.metadata.id}/brief`,
      payload: {
        brief: { ...sourceProject.brief, audience: "利用者" },
        expectedRevision: sourceProject.revision
      }
    });
    return {
      server,
      project: projectMutationResponseSchema.parse(briefResponse.json()).data,
      repository: new ProjectRepository({ workspaceRoot })
    };
  }

  async function saveOutline(
    server: (typeof servers)[number],
    project: VideoProject,
    outline: Outline
  ): Promise<VideoProject> {
    const response = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/outline`,
      payload: { outline, expectedRevision: project.revision }
    });
    expect(response.statusCode).toBe(200);
    return projectMutationResponseSchema.parse(response.json()).data;
  }

  function parseError(response: { statusCode: number; json(): unknown }) {
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    return apiErrorResponseSchema.parse(response.json()).error;
  }

  it("saves outline edits and only the approval endpoint can set approved", async () => {
    const { server, project } = await setup();
    const candidate = outlineFor(project);
    const edited = await saveOutline(server, project, {
      ...candidate,
      status: "approved",
      sections: candidate.sections.map((section) =>
        section.id === "outline-main"
          ? { ...section, title: "編集済み main" }
          : section
      )
    });

    expect(edited.outline.status).toBe("needs_review");
    expect(edited.outline.sourceHash).toBe(project.source.sha256);
    expect(edited.outline.generationRunId).toBeNull();
    expect(edited.outline.sections[1]?.id).toMatch(/^outline-section-/);
    expect(edited.outline.sections[1]?.id).not.toBe("outline-main");

    const approvedResponse = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/outline/approve`,
      payload: { expectedRevision: edited.revision }
    });
    const approved = projectMutationResponseSchema.parse(
      approvedResponse.json()
    );
    expect(approvedResponse.statusCode).toBe(200);
    expect(approved.data.outline.status).toBe("approved");
    expect(approved.revision).toBe(edited.revision + 1);
  });

  it.each([
    [
      "first section role",
      (outline: Outline) => ({
        ...outline,
        sections: outline.sections.map((section, index) =>
          index === 0 ? { ...section, role: "main" as const } : section
        )
      })
    ],
    [
      "last section role",
      (outline: Outline) => ({
        ...outline,
        sections: outline.sections.map((section, index) =>
          index === 2 ? { ...section, role: "main" as const } : section
        )
      })
    ],
    [
      "middle non-main role",
      (outline: Outline) => ({
        ...outline,
        sections: outline.sections.map((section, index) =>
          index === 1 ? { ...section, role: "outro" as const } : section
        )
      })
    ],
    [
      "missing main",
      (outline: Outline) => ({
        ...outline,
        sections: outline.sections.map((section, index) =>
          index === 1 ? { ...section, role: "outro" as const } : section
        )
      })
    ],
    [
      "duplicate order",
      (outline: Outline) => ({
        ...outline,
        sections: outline.sections.map((section, index) =>
          index === 2 ? { ...section, order: 2 } : section
        )
      })
    ],
    [
      "display order mismatch",
      (outline: Outline) => ({
        ...outline,
        sections: outline.sections.map((section, index) =>
          index === 1 ? { ...section, order: 3 } : section
        )
      })
    ]
  ])(
    "rejects %s without changing the project during approval",
    async (_name, mutate) => {
      const { server, project } = await setup();
      const saved = await saveOutline(
        server,
        project,
        mutate(outlineFor(project))
      );
      const beforeApproval = projectDetailResponseSchema.parse(
        (
          await server.app.inject({
            method: "GET",
            url: `/api/projects/${project.metadata.id}`
          })
        ).json()
      ).data;
      const response = await server.app.inject({
        method: "POST",
        url: `/api/projects/${project.metadata.id}/outline/approve`,
        payload: { expectedRevision: saved.revision }
      });
      const error = parseError(response);
      expect(response.statusCode).toBe(422);
      expect(error.code).toBe("OUTLINE_APPROVAL_VALIDATION_FAILED");
      expect(error.details.length).toBeGreaterThan(0);
      const afterApproval = projectDetailResponseSchema.parse(
        (
          await server.app.inject({
            method: "GET",
            url: `/api/projects/${project.metadata.id}`
          })
        ).json()
      ).data;
      expect(afterApproval).toEqual(beforeApproval);
    }
  );

  it.each([
    [
      "global question",
      (outline: Outline) => ({
        ...outline,
        openQuestions: [
          {
            id: "global-question",
            question: "確認",
            resolution: null,
            status: "open" as const
          }
        ]
      })
    ],
    [
      "section question",
      (outline: Outline) => ({
        ...outline,
        sections: outline.sections.map((section, index) =>
          index === 1
            ? {
                ...section,
                openQuestions: [
                  {
                    id: "section-question",
                    question: "確認",
                    resolution: null,
                    status: "open" as const
                  }
                ]
              }
            : section
        )
      })
    ],
    [
      "blank resolved resolution",
      (outline: Outline) => ({
        ...outline,
        openQuestions: [
          {
            id: "resolved-question",
            question: "確認",
            resolution: "  ",
            status: "resolved" as const
          }
        ]
      })
    ]
  ])("rejects %s questions", async (_name, mutate) => {
    const { server, project } = await setup();
    const saved = await saveOutline(
      server,
      project,
      mutate(outlineFor(project))
    );
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/outline/approve`,
      payload: { expectedRevision: saved.revision }
    });
    const error = parseError(response);
    expect(error.code).toBe("OUTLINE_APPROVAL_VALIDATION_FAILED");
    expect(
      error.details.some((detail) => detail.path.includes("openQuestions"))
    ).toBe(true);
  });

  it("assigns backend IDs to temporary questions and preserves them on later edits", async () => {
    const { server, project } = await setup();
    const saved = await saveOutline(server, project, {
      ...outlineFor(project),
      openQuestions: [
        {
          id: "tmp-outline-question",
          question: "確認事項",
          resolution: "確認済み",
          status: "resolved"
        }
      ]
    });
    const questionId = saved.outline.openQuestions[0]?.id;
    expect(questionId).toMatch(/^outline-question-/);
    expect(questionId).not.toBe("tmp-outline-question");

    const edited = await saveOutline(server, saved, {
      ...saved.outline,
      sections: saved.outline.sections.map((section) =>
        section.id === saved.outline.sections[1]?.id
          ? { ...section, title: "edited" }
          : section
      )
    });
    expect(edited.outline.openQuestions[0]?.id).toBe(questionId);
  });

  it("keeps old outline content and sourceHash when Markdown changes", async () => {
    const { server, project } = await setup();
    const saved = await saveOutline(server, project, outlineFor(project));
    const changedSource = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/source`,
      payload: { markdown: "# changed", expectedRevision: saved.revision }
    });
    const stale = projectMutationResponseSchema.parse(
      changedSource.json()
    ).data;
    expect(stale.outline.status).toBe("needs_review");
    expect(stale.outline.sourceHash).toBe(project.source.sha256);
    expect(stale.outline.sections).toEqual(saved.outline.sections);

    const approval = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/outline/approve`,
      payload: { expectedRevision: stale.revision }
    });
    const error = parseError(approval);
    expect(error.code).toBe("OUTLINE_APPROVAL_VALIDATION_FAILED");
    expect(
      error.details.some(
        (detail) => detail.path.join(".") === "outline.sourceHash"
      )
    ).toBe(true);
  });

  it("allows a stale outline to be reviewed against the current source and approved", async () => {
    const { server, project } = await setup();
    const saved = await saveOutline(server, project, outlineFor(project));
    const changedSource = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/source`,
      payload: { markdown: "# changed", expectedRevision: saved.revision }
    });
    const stale = projectMutationResponseSchema.parse(
      changedSource.json()
    ).data;

    const reviewedResponse = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/outline/review`,
      payload: { expectedRevision: stale.revision }
    });
    const reviewed = projectMutationResponseSchema.parse(
      reviewedResponse.json()
    ).data;
    expect(reviewedResponse.statusCode).toBe(200);
    expect(reviewed.outline.status).toBe("needs_review");
    expect(reviewed.outline.sourceHash).toBe(reviewed.source.sha256);
    expect(reviewed.outline.sections).toEqual(stale.outline.sections);

    const approvedResponse = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/outline/approve`,
      payload: { expectedRevision: reviewed.revision }
    });
    const approved = projectMutationResponseSchema.parse(
      approvedResponse.json()
    ).data;
    expect(approvedResponse.statusCode).toBe(200);
    expect(approved.outline.status).toBe("approved");
  });

  it("allows stale review and approval when a script already exists", async () => {
    const { server, project, repository } = await setup();
    const saved = await saveOutline(server, project, outlineFor(project));
    const prepared = await repository.save(
      project.metadata.id,
      {
        ...saved,
        script: {
          ...saved.script,
          status: "approved",
          outlineHash: saved.outline.sourceHash,
          sections: [
            {
              id: "script-main",
              outlineSectionId: saved.outline.sections[1]?.id ?? "",
              name: "main",
              background: { kind: "solid", colorToken: "background" },
              lines: [
                {
                  id: "script-line",
                  speakerId: "character-mentor",
                  spokenText: "script",
                  subtitleText: "script",
                  expression: "neutral",
                  characterVariantId: null,
                  pauseBeforeMs: 0,
                  pauseAfterMs: 0,
                  voiceOverrides: {},
                  pronunciation: {
                    mode: "dictionary",
                    excludedTermIds: []
                  }
                }
              ]
            }
          ]
        }
      },
      saved.revision
    );
    const changedSource = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/source`,
      payload: { markdown: "# changed", expectedRevision: prepared.revision }
    });
    const stale = projectMutationResponseSchema.parse(
      changedSource.json()
    ).data;

    const reviewedResponse = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/outline/review`,
      payload: { expectedRevision: stale.revision }
    });
    const reviewed = projectMutationResponseSchema.parse(
      reviewedResponse.json()
    ).data;
    const approvedResponse = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/outline/approve`,
      payload: { expectedRevision: reviewed.revision }
    });

    expect(reviewedResponse.statusCode).toBe(200);
    expect(approvedResponse.statusCode).toBe(200);
    expect(
      projectMutationResponseSchema.parse(approvedResponse.json()).data.outline
        .status
    ).toBe("approved");
    expect(
      projectMutationResponseSchema.parse(approvedResponse.json()).data.script
        .sections
    ).toHaveLength(1);
  });

  it("rejects revision conflicts and malformed mutation bodies without changing the project", async () => {
    const { server, project } = await setup();
    const before = projectDetailResponseSchema.parse(
      (
        await server.app.inject({
          method: "GET",
          url: `/api/projects/${project.metadata.id}`
        })
      ).json()
    ).data;
    const conflict = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/outline`,
      payload: {
        outline: outlineFor(project),
        expectedRevision: project.revision - 1
      }
    });
    expect(parseError(conflict).code).toBe("PROJECT_REVISION_CONFLICT");
    expect(conflict.statusCode).toBe(409);

    const malformed = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/outline/approve`,
      payload: { expectedRevision: project.revision, extra: true }
    });
    expect(parseError(malformed).code).toBe("REQUEST_VALIDATION_FAILED");
    const after = projectDetailResponseSchema.parse(
      (
        await server.app.inject({
          method: "GET",
          url: `/api/projects/${project.metadata.id}`
        })
      ).json()
    ).data;
    expect(after).toEqual(before);
  });

  it("rejects an AI outline through the API and stores a reasonless decision", async () => {
    const { server, project, repository } = await setup();
    const generated = await repository.saveOutline(
      project.metadata.id,
      outlineFor(project),
      project.revision
    );
    const log = new ImprovementLogRepository(server.database.database);
    await log.insertGenerationCandidate({
      candidateId: "outline-edit-run-candidate-outline",
      generationRunId: "outline-edit-run",
      projectId: project.metadata.id,
      projectRevision: generated.revision,
      taskKind: "outline_generation",
      targetKind: "outline",
      targetId: "outline",
      candidateKey: "outline",
      candidate: generated.outline,
      modelId: "api-outline-model",
      responseModel: null,
      promptVersion: "1.0.0",
      createdAt: "2026-08-11T03:00:00.000Z"
    });

    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/outline/reject`,
      payload: { expectedRevision: generated.revision }
    });
    const rejected = projectMutationResponseSchema.parse(response.json());
    const decisions = await log.listDecisions(project.metadata.id);

    expect(response.statusCode).toBe(200);
    expect(rejected.data.outline).toMatchObject({
      status: "draft",
      generationRunId: null,
      sections: []
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe("rejected");
    expect(decisions[0]?.reason).toBeNull();
  });
});
