import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { LegacyPlanningProjectService } from "../../src/app/projects/legacy-planning-project-service.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";

describe("script workflow compatibility boundary", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("rejects legacy initialization and approval for a V19 project", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-script-approval-")
    );
    roots.push(workspaceRoot);
    const repository = new ProjectRepository({ workspaceRoot });
    const project = await repository.create(
      createEmptyVideoProject({
        projectId: "script-approval-project",
        createdAt: "2026-08-20T00:00:00.000Z"
      })
    );
    const service = new LegacyPlanningProjectService({ repository });

    await expect(
      service.initializeScript(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).rejects.toMatchObject({
      code: "PROJECT_CANDIDATE_VALIDATION_FAILED",
      status: 422
    });
    await expect(
      service.approveScript(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).rejects.toMatchObject({
      code: "PROJECT_CANDIDATE_VALIDATION_FAILED",
      status: 422
    });
  });
});
