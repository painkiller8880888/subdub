import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { ProjectService } from "../../src/app/projects/project-service.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import type { Outline, VideoProject } from "../../src/schema/index.js";

function makeOutline(
  project: VideoProject,
  status: Outline["status"] = "needs_review"
): Outline {
  const section = (
    id: string,
    order: number,
    role: Outline["sections"][number]["role"]
  ): Outline["sections"][number] => ({
    id,
    order,
    role,
    title: id,
    overview: id,
    keyPoints: [],
    targetDurationSec: 10,
    sourceRefs: [{ sourceId: project.source.id, headingPath: [] }],
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
    generationRunId: "outline-invalidation-run",
    openQuestions: [],
    sections: [
      section("intro", 1, "intro"),
      section("main", 2, "main"),
      section("outro", 3, "outro")
    ]
  };
}

describe("outline and downstream invalidation", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  async function setup(): Promise<{
    repository: ProjectRepository;
    service: ProjectService;
    project: VideoProject;
  }> {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-outline-invalidation-")
    );
    roots.push(workspaceRoot);
    const repository = new ProjectRepository(workspaceRoot);
    const service = new ProjectService({ repository });
    const created = await repository.create(
      createEmptyVideoProject({
        projectId: "outline-invalidation-project",
        createdAt: "2026-08-05T00:00:00.000Z"
      })
    );
    const withSource = await repository.saveSource(
      created.metadata.id,
      "# source",
      0
    );
    const project = await repository.saveBrief(
      created.metadata.id,
      { ...withSource.brief, audience: "利用者" },
      withSource.revision
    );
    return { repository, service, project };
  }

  it("returns approved outlines to needs_review without deleting downstream data", async () => {
    const { repository, service, project } = await setup();
    const savedOutline = await repository.saveOutline(
      project.metadata.id,
      makeOutline(project),
      project.revision
    );
    const approved = await repository.saveOutline(
      project.metadata.id,
      { ...savedOutline.outline, status: "approved" },
      savedOutline.revision
    );
    const prepared = await repository.save(
      project.metadata.id,
      {
        ...approved,
        script: { ...approved.script, status: "approved" },
        visuals: { ...approved.visuals, status: "approved" }
      },
      approved.revision
    );

    const edited = await service.saveOutline(project.metadata.id, {
      outline: {
        ...prepared.outline,
        sections: prepared.outline.sections.map((section) =>
          section.id === "main" ? { ...section, title: "edited" } : section
        )
      },
      expectedRevision: prepared.revision
    });

    expect(edited.outline.status).toBe("needs_review");
    expect(edited.script.status).toBe("needs_review");
    expect(edited.visuals.status).toBe("needs_review");
    expect(edited.script.sections).toEqual(prepared.script.sections);
    expect(edited.visuals.assignments).toEqual(prepared.visuals.assignments);
  });

  it("marks existing outline and downstream states stale after a source change", async () => {
    const { repository, project } = await setup();
    const saved = await repository.saveOutline(
      project.metadata.id,
      makeOutline(project, "approved"),
      project.revision
    );
    const prepared = await repository.save(
      project.metadata.id,
      {
        ...saved,
        script: { ...saved.script, status: "approved" },
        visuals: { ...saved.visuals, status: "approved" }
      },
      saved.revision
    );
    const changed = await repository.saveSource(
      project.metadata.id,
      "# changed source",
      prepared.revision
    );

    expect(changed.outline.status).toBe("needs_review");
    expect(changed.outline.sourceHash).toBe(prepared.outline.sourceHash);
    expect(changed.outline.sections).toEqual(prepared.outline.sections);
    expect(changed.outline.generationRunId).toBe(
      prepared.outline.generationRunId
    );
    expect(changed.script.status).toBe("needs_review");
    expect(changed.visuals.status).toBe("needs_review");
  });
});
