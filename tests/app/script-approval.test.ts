import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { ProjectRepositoryError } from "../../src/app/projects/project-repository.js";
import { ProjectService } from "../../src/app/projects/project-service.js";
import { ScriptApprovalError } from "../../src/app/projects/script-errors.js";
import type { Outline, Script, VideoProject } from "../../src/schema/index.js";

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
    generationRunId: "script-approval-outline-run",
    openQuestions: [],
    sections: [
      section("intro", 1, "intro"),
      section("main", 2, "main"),
      section("outro", 3, "outro")
    ]
  };
}

function editFirstSpokenText(script: Script): Script {
  return {
    ...script,
    sections: script.sections.map((section, sectionIndex) =>
      sectionIndex === 0
        ? {
            ...section,
            lines: section.lines.map((line, lineIndex) =>
              lineIndex === 0
                ? { ...line, spokenText: "変更後の読み上げ" }
                : line
            )
          }
        : section
    )
  };
}

function addLine(script: Script): Script {
  const defaultLine: Script["sections"][number]["lines"][number] = {
    id: "draft-added-line",
    speakerId: "character-mentor",
    spokenText: "追加されたセリフ",
    subtitleText: "追加された字幕",
    expression: "neutral",
    pauseBeforeMs: 0,
    pauseAfterMs: 250,
    voiceOverrides: {},
    pronunciation: { mode: "dictionary", excludedTermIds: [] }
  };
  return {
    ...script,
    sections: script.sections.map((section, sectionIndex) =>
      sectionIndex === 0
        ? { ...section, lines: [...section.lines, defaultLine] }
        : section
    )
  };
}

function withMeaningfulVisuals(
  project: VideoProject,
  lineId: string
): VideoProject {
  return {
    ...project,
    visuals: {
      status: "approved",
      suggestionRunIds: ["visual-search-run"],
      assignments: [
        {
          id: "visual-assignment-1",
          startLineId: lineId,
          endLineId: lineId,
          assetId: "asset-demo",
          assetChecksum:
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          projectMediaPath: "media/demo.png",
          display: {
            kind: "photo",
            fit: "contain",
            crop: { x: 0, y: 0, width: 1, height: 1 },
            scale: 1,
            position: { x: 0.5, y: 0.5 },
            prioritizeVisual: false,
            annotations: []
          }
        }
      ]
    }
  };
}

describe("ProjectService script approval and stale invalidation", () => {
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
      path.join(tmpdir(), "subdub-script-approval-")
    );
    roots.push(workspaceRoot);
    const repository = new ProjectRepository(workspaceRoot);
    const service = new ProjectService({ repository });
    const created = await repository.create(
      createEmptyVideoProject({
        projectId: "script-approval-project",
        createdAt: "2026-08-06T00:00:00.000Z"
      })
    );
    const withSource = await repository.saveSource(
      created.metadata.id,
      "# source",
      0
    );
    const withBrief = await repository.saveBrief(
      created.metadata.id,
      { ...withSource.brief, audience: "利用者" },
      withSource.revision
    );
    const outlined = await repository.saveOutline(
      created.metadata.id,
      makeOutline(withBrief, "approved"),
      withBrief.revision
    );
    const initialized = await service.initializeScript(created.metadata.id, {
      expectedRevision: outlined.revision
    });
    return { repository, service, project: initialized };
  }

  async function setupUninitialized(): Promise<{
    service: ProjectService;
    project: VideoProject;
  }> {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-script-approval-")
    );
    roots.push(workspaceRoot);
    const repository = new ProjectRepository(workspaceRoot);
    const service = new ProjectService({ repository });
    const created = await repository.create(
      createEmptyVideoProject({
        projectId: "script-approval-empty",
        createdAt: "2026-08-06T00:00:00.000Z"
      })
    );
    const withSource = await repository.saveSource(
      created.metadata.id,
      "# source",
      0
    );
    const withBrief = await repository.saveBrief(
      created.metadata.id,
      { ...withSource.brief, audience: "利用者" },
      withSource.revision
    );
    const outlined = await repository.saveOutline(
      created.metadata.id,
      makeOutline(withBrief, "approved"),
      withBrief.revision
    );
    return { service, project: outlined };
  }

  it("approves an initialized script backed by the current outline", async () => {
    const { repository, service, project } = await setup();
    const approved = await service.approveScript(project.metadata.id, {
      expectedRevision: project.revision
    });

    expect(approved.script.status).toBe("approved");
    expect(approved.revision).toBe(project.revision + 1);
    expect(approved.script.sections).toEqual(project.script.sections);
    expect(approved.visuals.assignments).toEqual(project.visuals.assignments);
    const reloaded = await repository.read(project.metadata.id);
    expect(reloaded.script.status).toBe("approved");
  });

  it("rejects approval when the script is not initialized", async () => {
    const { service, project } = await setupUninitialized();

    await expect(
      service.approveScript(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).rejects.toBeInstanceOf(ScriptApprovalError);
  });

  it("rejects approval when the outline is not approved", async () => {
    const { repository, service, project } = await setup();
    const unapproved = await repository.saveOutline(
      project.metadata.id,
      { ...project.outline, status: "needs_review" },
      project.revision
    );

    await expect(
      service.approveScript(project.metadata.id, {
        expectedRevision: unapproved.revision
      })
    ).rejects.toBeInstanceOf(ScriptApprovalError);
  });

  it("rejects approval when the outline is stale after a source change", async () => {
    const { repository, service, project } = await setup();
    const stale = await repository.saveSource(
      project.metadata.id,
      "# changed source",
      project.revision
    );

    await expect(
      service.approveScript(project.metadata.id, {
        expectedRevision: stale.revision
      })
    ).rejects.toBeInstanceOf(ScriptApprovalError);
  });

  it("rejects approval when the outlineHash no longer matches the outline", async () => {
    const { repository, service, project } = await setup();
    const changed = await repository.saveOutline(
      project.metadata.id,
      {
        ...project.outline,
        sections: project.outline.sections.map((section, index) =>
          index === 0 ? { ...section, title: "変更されたタイトル" } : section
        )
      },
      project.revision
    );

    await expect(
      service.approveScript(project.metadata.id, {
        expectedRevision: changed.revision
      })
    ).rejects.toBeInstanceOf(ScriptApprovalError);
  });

  it("returns a revision conflict without changing the file when expectedRevision mismatches", async () => {
    const { service, project } = await setup();
    await expect(
      service.approveScript(project.metadata.id, {
        expectedRevision: project.revision - 1
      })
    ).rejects.toBeInstanceOf(ProjectRepositoryError);
    const reloaded = await service.read(project.metadata.id);
    expect(reloaded.revision).toBe(project.revision);
    expect(reloaded.script.status).toBe(project.script.status);
  });

  it("does not change project.json when approval validation fails", async () => {
    const { repository, service, project } = await setup();
    const unapproved = await repository.saveOutline(
      project.metadata.id,
      { ...project.outline, status: "draft" },
      project.revision
    );

    await expect(
      service.approveScript(project.metadata.id, {
        expectedRevision: unapproved.revision
      })
    ).rejects.toBeInstanceOf(ScriptApprovalError);
    const reloaded = await repository.read(project.metadata.id);
    expect(reloaded.script.status).toBe("draft");
  });

  it("returns an approved script to needs_review and keeps visuals on text-only edits", async () => {
    const { repository, service, project } = await setup();
    const withLine = await service.saveScript(project.metadata.id, {
      script: addLine(project.script),
      expectedRevision: project.revision
    });
    const savedLineId = withLine.script.sections[0]?.lines[0]?.id;
    if (savedLineId === undefined) {
      throw new Error("saved line is missing");
    }
    const withVisuals = await repository.save(
      project.metadata.id,
      withMeaningfulVisuals(withLine, savedLineId),
      withLine.revision
    );
    const approved = await service.approveScript(project.metadata.id, {
      expectedRevision: withVisuals.revision
    });
    const candidate: Script = {
      ...editFirstSpokenText(approved.script),
      status: "needs_review"
    };
    const edited = await service.saveScript(project.metadata.id, {
      script: candidate,
      expectedRevision: approved.revision
    });

    expect(edited.script.status).toBe("needs_review");
    expect(edited.visuals.status).toBe(approved.visuals.status);
    expect(edited.visuals.assignments).toEqual(approved.visuals.assignments);
  });

  it("keeps an approved script approved when a save matches the approved content", async () => {
    const { service, project } = await setup();
    const withLine = await service.saveScript(project.metadata.id, {
      script: addLine(project.script),
      expectedRevision: project.revision
    });
    const approved = await service.approveScript(project.metadata.id, {
      expectedRevision: withLine.revision
    });
    const candidate: Script = {
      ...approved.script,
      status: "needs_review"
    };
    const saved = await service.saveScript(project.metadata.id, {
      script: candidate,
      expectedRevision: approved.revision
    });

    expect(saved.script.status).toBe("approved");
  });

  it("returns approved visuals to needs_review on a structural script change", async () => {
    const { repository, service, project } = await setup();
    const withLine = await service.saveScript(project.metadata.id, {
      script: addLine(project.script),
      expectedRevision: project.revision
    });
    const savedLineId = withLine.script.sections[0]?.lines[0]?.id;
    if (savedLineId === undefined) {
      throw new Error("saved line is missing");
    }
    const withVisuals = await repository.save(
      project.metadata.id,
      withMeaningfulVisuals(withLine, savedLineId),
      withLine.revision
    );
    const approved = await service.approveScript(project.metadata.id, {
      expectedRevision: withVisuals.revision
    });
    const candidate: Script = {
      ...addLine(approved.script),
      status: "needs_review"
    };
    const structured = await service.saveScript(project.metadata.id, {
      script: candidate,
      expectedRevision: approved.revision
    });

    expect(structured.script.status).toBe("needs_review");
    expect(structured.visuals.status).toBe("needs_review");
    expect(structured.visuals.assignments).toEqual(
      approved.visuals.assignments
    );
  });
});
