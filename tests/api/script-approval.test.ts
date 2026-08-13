import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  projectCreateResponseSchema,
  projectDetailResponseSchema,
  projectMutationResponseSchema
} from "../../src/schema/api.js";
import type { Outline, VideoProject } from "../../src/schema/index.js";

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
    generationRunId: "script-approval-outline-run",
    openQuestions: [],
    sections: [
      makeSection("outline-intro", 1, "intro", "はじめに"),
      makeSection("outline-main", 2, "main", "操作手順"),
      makeSection("outline-outro", 3, "outro", "完了確認")
    ]
  };
}

describe("script approval API", () => {
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
      path.join(tmpdir(), "subdub-script-approval-api-")
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
      return { server, project: outlined };
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

  async function readProject(
    server: (typeof servers)[number],
    project: VideoProject
  ): Promise<VideoProject> {
    return projectDetailResponseSchema.parse(
      (
        await server.app.inject({
          method: "GET",
          url: `/api/projects/${project.metadata.id}`
        })
      ).json()
    ).data;
  }

  it("approves an initialized script and bumps the revision", async () => {
    const { server, project } = await setup();
    const initialized = await initialize(server, project);
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/script/approve`,
      payload: { expectedRevision: initialized.revision }
    });

    expect(response.statusCode).toBe(200);
    const result = projectMutationResponseSchema.parse(response.json());
    expect(result.revision).toBe(initialized.revision + 1);
    expect(result.data.script.status).toBe("approved");
    expect(result.data.script.sections).toEqual(initialized.script.sections);
    expect(result.data.visuals.assignments).toEqual(
      initialized.visuals.assignments
    );
  });

  it("rejects approval when the script is not initialized without changing the project", async () => {
    const { server, project } = await setup();
    const before = await readProject(server, project);
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/script/approve`,
      payload: { expectedRevision: project.revision }
    });

    expect(response.statusCode).toBe(422);
    expect(parseError(response).code).toBe("SCRIPT_APPROVAL_VALIDATION_FAILED");
    expect(await readProject(server, project)).toEqual(before);
  });

  it("rejects approval when the outline is not approved", async () => {
    const { server, project } = await setup(false);
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/script/approve`,
      payload: { expectedRevision: project.revision }
    });

    expect(response.statusCode).toBe(422);
    const error = parseError(response);
    expect(error.code).toBe("SCRIPT_APPROVAL_VALIDATION_FAILED");
    expect(
      error.details.some((detail) => detail.path.join(".") === "outline.status")
    ).toBe(true);
  });

  it("rejects approval when the outline is stale after a source change", async () => {
    const { server, project } = await setup();
    const initialized = await initialize(server, project);
    const changedSource = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/source`,
      payload: { markdown: "# changed", expectedRevision: initialized.revision }
    });
    const stale = projectMutationResponseSchema.parse(
      changedSource.json()
    ).data;
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/script/approve`,
      payload: { expectedRevision: stale.revision }
    });

    expect(response.statusCode).toBe(422);
    const error = parseError(response);
    expect(error.code).toBe("SCRIPT_APPROVAL_VALIDATION_FAILED");
    expect(
      error.details.some(
        (detail) => detail.path.join(".") === "outline.sourceHash"
      )
    ).toBe(true);
  });

  it("rejects approval when the outlineHash no longer matches the outline", async () => {
    const { server, project } = await setup();
    const initialized = await initialize(server, project);
    const outlineResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/outline`,
      payload: {
        outline: {
          ...initialized.outline,
          sections: initialized.outline.sections.map((section, index) =>
            index === 0 ? { ...section, title: "変更されたタイトル" } : section
          )
        },
        expectedRevision: initialized.revision
      }
    });
    const changedOutline = projectMutationResponseSchema.parse(
      outlineResponse.json()
    ).data;
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/script/approve`,
      payload: { expectedRevision: changedOutline.revision }
    });

    expect(response.statusCode).toBe(422);
    const error = parseError(response);
    expect(error.code).toBe("SCRIPT_APPROVAL_VALIDATION_FAILED");
    expect(
      error.details.some(
        (detail) => detail.path.join(".") === "script.outlineHash"
      )
    ).toBe(true);
  });

  it("returns a revision conflict for a stale expectedRevision without changing the project", async () => {
    const { server, project } = await setup();
    const initialized = await initialize(server, project);
    const before = await readProject(server, initialized);
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/script/approve`,
      payload: { expectedRevision: initialized.revision - 1 }
    });

    expect(response.statusCode).toBe(409);
    expect(parseError(response).code).toBe("PROJECT_REVISION_CONFLICT");
    expect(await readProject(server, initialized)).toEqual(before);
  });

  it("returns a revision conflict before approval condition errors when both apply", async () => {
    const { server, project } = await setup();
    const initialized = await initialize(server, project);
    const changedSource = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/source`,
      payload: { markdown: "# changed", expectedRevision: initialized.revision }
    });
    const stale = projectMutationResponseSchema.parse(
      changedSource.json()
    ).data;
    expect(stale.outline.status).not.toBe("approved");
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/script/approve`,
      payload: { expectedRevision: stale.revision - 1 }
    });

    expect(response.statusCode).toBe(409);
    expect(parseError(response).code).toBe("PROJECT_REVISION_CONFLICT");
  });

  it("rejects unknown fields in the approve request", async () => {
    const { server, project } = await setup();
    const initialized = await initialize(server, project);
    const response = await server.app.inject({
      method: "POST",
      url: `/api/projects/${project.metadata.id}/script/approve`,
      payload: {
        expectedRevision: initialized.revision,
        unknown: true
      }
    });

    expect(response.statusCode).toBe(422);
    expect(parseError(response).code).toBe("REQUEST_VALIDATION_FAILED");
  });

  it("allows script saves to preserve a legacy approved status", async () => {
    const { server, project } = await setup();
    const initialized = await initialize(server, project);
    const saveResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${project.metadata.id}/script`,
      payload: {
        script: { ...initialized.script, status: "approved" },
        expectedRevision: initialized.revision
      }
    });

    expect(saveResponse.statusCode).toBe(200);
    const saved = projectMutationResponseSchema.parse(saveResponse.json());
    expect(saved.data.script.status).toBe("approved");
  });
});
