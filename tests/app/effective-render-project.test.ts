import { describe, expect, it } from "vitest";

import { createEffectiveRenderProject } from "../../src/app/rendering/effective-render-project.js";
import type { VideoProject } from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function projectFixture(): VideoProject {
  return structuredClone(videoProjectFixture) as VideoProject;
}

describe("createEffectiveRenderProject", () => {
  it("keeps only enabled section data without mutating the saved project", () => {
    const project = projectFixture();
    const visualAssignment = project.visuals.assignments[0];
    if (visualAssignment === undefined) {
      throw new Error("the fixture visual assignment is missing");
    }
    project.edit.videoElements = [
      {
        id: "edit-disabled-cutin",
        role: "cutin",
        assetId: visualAssignment.assetId,
        assetVersion: 1,
        assetChecksum: visualAssignment.assetChecksum,
        projectMediaPath: visualAssignment.projectMediaPath,
        placement: {
          kind: "before_section",
          sectionId: "section-main",
          order: 0
        },
        startMs: null,
        playbackRate: 1,
        volume: 1,
        text: "",
        textTemplateId: null
      }
    ];
    const savedProject = structuredClone(project);
    project.script.sections[1]!.enabled = false;

    const effective = createEffectiveRenderProject(project);

    expect(effective.sections.map((section) => section.id)).toEqual([
      "section-intro",
      "section-outro"
    ]);
    expect([...effective.sectionIds]).toEqual([
      "section-intro",
      "section-outro"
    ]);
    expect([...effective.lineIds]).toEqual([
      "intro-mentor-1",
      "intro-learner-1",
      "outro-mentor-1"
    ]);
    expect(
      effective.visualAssignments.map((assignment) => assignment.id)
    ).toEqual(["visual-intro-video", "visual-outro-document"]);
    expect(effective.soundEffects.map((effect) => effect.id)).toEqual([
      "effect-attention"
    ]);
    expect(effective.sectionBgms.map((bgm) => bgm.id)).toEqual(["bgm-intro"]);
    expect(effective.videoElements).toEqual([]);
    expect(project).toEqual({
      ...savedProject,
      script: {
        ...savedProject.script,
        sections: savedProject.script.sections.map((section) =>
          section.id === "section-main"
            ? { ...section, enabled: false }
            : section
        )
      }
    });
  });

  it("does not retain boundary inserts when every section is disabled", () => {
    const project = projectFixture();
    const visualAssignment = project.visuals.assignments[0];
    if (visualAssignment === undefined) {
      throw new Error("the fixture visual assignment is missing");
    }
    project.edit.videoElements = [
      {
        id: "edit-intro",
        role: "intro",
        assetId: visualAssignment.assetId,
        assetVersion: 1,
        assetChecksum: visualAssignment.assetChecksum,
        projectMediaPath: visualAssignment.projectMediaPath,
        placement: { kind: "before_first_section" },
        startMs: null,
        playbackRate: 1,
        volume: 1,
        text: "",
        textTemplateId: null
      },
      {
        id: "edit-outro",
        role: "outro",
        assetId: visualAssignment.assetId,
        assetVersion: 1,
        assetChecksum: visualAssignment.assetChecksum,
        projectMediaPath: visualAssignment.projectMediaPath,
        placement: { kind: "after_last_section" },
        startMs: null,
        playbackRate: 1,
        volume: 1,
        text: "",
        textTemplateId: null
      }
    ];
    for (const section of project.script.sections) {
      section.enabled = false;
    }

    const effective = createEffectiveRenderProject(project);

    expect(effective.sections).toEqual([]);
    expect(effective.sectionIds.size).toBe(0);
    expect(effective.lineIds.size).toBe(0);
    expect(effective.visualAssignments).toEqual([]);
    expect(effective.soundEffects).toEqual([]);
    expect(effective.sectionBgms).toEqual([]);
    expect(effective.videoElements).toEqual([]);
  });
});
