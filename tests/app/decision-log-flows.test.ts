import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { ProjectService } from "../../src/app/projects/project-service.js";

describe("decision log compatibility boundary", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("does not create legacy outline decisions for a V19 project", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-decision-flow-")
    );
    roots.push(workspaceRoot);
    const repository = new ProjectRepository({ workspaceRoot });
    const project = await repository.create(
      createEmptyVideoProject({
        projectId: "decision-flow-project",
        createdAt: "2026-08-20T00:00:00.000Z"
      })
    );
    const service = new ProjectService({ repository });

    await expect(
      service.approveOutline(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).rejects.toMatchObject({
      code: "PROJECT_CANDIDATE_VALIDATION_FAILED",
      status: 422
    });
  });
});
