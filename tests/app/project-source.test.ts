import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import {
  ProjectRepository,
  ProjectRepositoryError
} from "../../src/app/projects/project-repository.js";
import type { VideoProject } from "../../src/schema/index.js";

describe("ProjectRepository source handling", () => {
  const projectId = "source-project";
  let workspaceRoot: string;
  let repository: ProjectRepository;
  let project: VideoProject;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-source-")
    );
    repository = new ProjectRepository({ workspaceRoot });
    project = await repository.create(
      createEmptyVideoProject({
        projectId,
        createdAt: "2026-08-20T00:00:00.000Z"
      })
    );
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("keeps source content outside the V19 project object", async () => {
    const markdown = "# 日本語\n\n資料の本文";
    const saved = await repository.saveSource(projectId, markdown, 0);

    expect(saved.schemaVersion).toBe("1.9.0");
    expect(saved).not.toHaveProperty("source");
    await expect(repository.readSource(projectId)).resolves.toEqual({
      markdown,
      sha256: createHash("sha256").update(markdown, "utf8").digest("hex"),
      revision: 1
    });
  });

  it("returns the actual source hash without storing it in project.json", async () => {
    const sourceFile = path.join(
      workspaceRoot,
      "projects",
      projectId,
      "source",
      "source.md"
    );
    await fs.writeFile(sourceFile, "tampered markdown", "utf8");

    await expect(repository.readSource(projectId)).resolves.toMatchObject({
      markdown: "tampered markdown",
      sha256: createHash("sha256")
        .update("tampered markdown", "utf8")
        .digest("hex"),
      revision: project.revision
    });
  });

  it("rejects brief saves at the V19 boundary", async () => {
    await expect(
      repository.saveBrief(projectId, {}, project.revision)
    ).rejects.toMatchObject({
      code: "PROJECT_CANDIDATE_VALIDATION_FAILED",
      status: 422
    } satisfies Partial<ProjectRepositoryError>);
  });

  it("saves the current V19 script without requiring source.md", async () => {
    await fs.rm(
      path.join(workspaceRoot, "projects", projectId, "source", "source.md")
    );

    await expect(
      repository.saveScript(projectId, project.script, project.revision)
    ).resolves.toMatchObject({
      schemaVersion: "1.9.0",
      revision: project.revision + 1
    });
  });
});
