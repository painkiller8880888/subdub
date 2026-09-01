import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { OutlineGenerationService } from "../../src/app/projects/outline-generation-service.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";

describe("OutlineGenerationService compatibility boundary", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("does not start an outline run for a V19 project", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-outline-generation-")
    );
    roots.push(workspaceRoot);
    const repository = new ProjectRepository({ workspaceRoot });
    const created = await repository.create(
      createEmptyVideoProject({
        projectId: "outline-generation-project",
        createdAt: "2026-08-20T00:00:00.000Z"
      })
    );
    const listModels = vi.fn();
    const complete = vi.fn();
    const service = new OutlineGenerationService({
      repository,
      modelService: { listModels },
      chatAdapter: { complete }
    });

    await expect(
      service.generate(created.metadata.id, {
        expectedRevision: created.revision
      })
    ).rejects.toMatchObject({
      code: "PROJECT_CANDIDATE_VALIDATION_FAILED",
      status: 422
    });
    expect(listModels).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});
