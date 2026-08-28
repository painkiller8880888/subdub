import { describe, expect, it } from "vitest";

import {
  applyEditedScript,
  classifyScriptChange,
  pruneInvalidatedDownstreamReferences
} from "../../src/app/projects/script-invalidation.js";
import type { Script, VideoProject } from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function projectFixture(): VideoProject {
  return structuredClone(videoProjectFixture) as VideoProject;
}

function appendLines(
  script: Script,
  sectionIndex: number,
  lineIds: readonly string[]
): Script {
  const section = script.sections[sectionIndex];
  const template = section?.lines.at(-1);
  if (section === undefined || template === undefined) {
    throw new Error("The test fixture must contain a non-empty section.");
  }

  return {
    ...script,
    sections: script.sections.map((candidate, index) =>
      index === sectionIndex
        ? {
            ...candidate,
            lines: [
              ...candidate.lines,
              ...lineIds.map((id, lineIndex) => ({
                ...template,
                id,
                spokenText: `追加されたセリフ${lineIndex + 1}`,
                subtitleText: `追加された字幕${lineIndex + 1}`
              }))
            ]
          }
        : candidate
    )
  };
}

function editFirstLine(
  script: Script,
  patch: Partial<Script["sections"][number]["lines"][number]>
): Script {
  return {
    ...script,
    sections: script.sections.map((section, sectionIndex) =>
      sectionIndex === 0
        ? {
            ...section,
            lines: section.lines.map((line, lineIndex) =>
              lineIndex === 0 ? { ...line, ...patch } : line
            )
          }
        : section
    )
  };
}

function addFirstLine(script: Script): Script {
  return appendLines(script, 0, ["added-line"]);
}

function changeBackground(script: Script): Script {
  return {
    ...script,
    sections: script.sections.map((section, sectionIndex) =>
      sectionIndex === 0
        ? {
            ...section,
            background: {
              kind: "image",
              src: "backgrounds/other.png",
              fit: "cover"
            }
          }
        : section
    )
  };
}

describe("classifyScriptChange", () => {
  it("marks visuals, audio, and manifest stale on a structural change", () => {
    const current = projectFixture().script;
    const candidate = addFirstLine(current);
    const impact = classifyScriptChange(current, candidate);

    expect(impact.contentChanged).toBe(true);
    expect(impact.structuralChanged).toBe(true);
    expect(impact.staleTargets).toEqual(["visuals", "audio", "manifest"]);
  });

  it("marks audio and manifest stale on a spoken text change", () => {
    const current = projectFixture().script;
    const candidate = editFirstLine(current, {
      spokenText: "読み上げ文が変わった"
    });
    const impact = classifyScriptChange(current, candidate);

    expect(impact.structuralChanged).toBe(false);
    expect(impact.staleTargets).toEqual(["audio", "manifest"]);
  });

  it("marks the manifest stale when a section template changes", () => {
    const current = projectFixture().script;
    const sectionTemplateCandidate: Script = {
      ...current,
      sections: current.sections.map((section, index) =>
        index === 0
          ? { ...section, screenTemplateId: "screen-template-custom" }
          : section
      )
    };
    expect(
      classifyScriptChange(current, sectionTemplateCandidate).staleTargets
    ).toEqual(["manifest"]);
  });

  it("marks only manifest stale on subtitle, expression, or pause changes", () => {
    const current = projectFixture().script;
    for (const patch of [
      { subtitleText: "字幕が変わった" },
      { expression: "smile" as const },
      { pauseBeforeMs: 500 },
      { pauseAfterMs: 0 }
    ]) {
      const impact = classifyScriptChange(
        current,
        editFirstLine(current, patch)
      );
      expect(impact.staleTargets).toEqual(["manifest"]);
      expect(impact.structuralChanged).toBe(false);
    }
  });

  it("marks only manifest stale on a section background change", () => {
    const current = projectFixture().script;
    const candidate = changeBackground(current);
    const impact = classifyScriptChange(current, candidate);

    expect(impact.staleTargets).toEqual(["manifest"]);
    expect(impact.structuralChanged).toBe(false);
  });

  it("returns no stale targets for an unchanged script", () => {
    const current = projectFixture().script;
    const impact = classifyScriptChange(current, structuredClone(current));

    expect(impact.contentChanged).toBe(false);
    expect(impact.structuralChanged).toBe(false);
    expect(impact.staleTargets).toEqual([]);
  });
});

describe("applyEditedScript", () => {
  it("keeps an approved script approved when content is unchanged", () => {
    const project = projectFixture();
    const result = applyEditedScript(project, structuredClone(project.script));

    expect(result.impact.contentChanged).toBe(false);
    expect(result.project.script.status).toBe("approved");
  });

  it("returns an approved script to needs_review when content changes", () => {
    const project = projectFixture();
    const candidate = editFirstLine(project.script, { spokenText: "変更後" });
    const result = applyEditedScript(project, candidate);

    expect(result.project.script.status).toBe("needs_review");
  });

  it("keeps the candidate status for an unapproved script", () => {
    const project = projectFixture();
    project.script.status = "needs_review";
    const candidate = editFirstLine(project.script, { spokenText: "変更後" });
    const result = applyEditedScript(project, candidate);

    expect(result.project.script.status).toBe("needs_review");
  });

  it("marks visuals as needs_review only on a structural change with meaningful visuals", () => {
    const project = projectFixture();
    const candidate = addFirstLine(project.script);
    const result = applyEditedScript(project, candidate);

    expect(result.impact.structuralChanged).toBe(true);
    expect(result.project.visuals.status).toBe("needs_review");
    expect(result.project.visuals.assignments).toEqual(
      project.visuals.assignments.map((assignment) =>
        assignment.id === "visual-intro-video"
          ? { ...assignment, endLineId: "added-line" }
          : assignment
      )
    );
    expect(result.project.visuals.suggestionRunIds).toEqual(
      project.visuals.suggestionRunIds
    );
  });

  it("keeps visuals status when only non-structural content changes", () => {
    const project = projectFixture();
    const candidate = editFirstLine(project.script, { spokenText: "変更後" });
    const result = applyEditedScript(project, candidate);

    expect(result.impact.structuralChanged).toBe(false);
    expect(result.project.visuals.status).toBe("approved");
  });

  it("preserves audio, edit plan, thumbnail, and revision metadata", () => {
    const project = projectFixture();
    const candidate = editFirstLine(project.script, { spokenText: "変更後" });
    const result = applyEditedScript(project, candidate);

    expect(result.project.audio).toEqual(project.audio);
    expect(result.project.edit).toEqual(project.edit);
    expect(result.project.thumbnail).toEqual(project.thumbnail);
    expect(result.project.revision).toBe(project.revision);
    expect(result.project.metadata).toEqual(project.metadata);
  });

  it("extends a static assignment through multiple appended lines", () => {
    const project = projectFixture();
    const candidate = appendLines(project.script, 1, [
      "main-added-line-1",
      "main-added-line-2"
    ]);
    const result = applyEditedScript(project, candidate);

    expect(result.project.visuals.assignments).toEqual(
      project.visuals.assignments.map((assignment) =>
        assignment.id === "visual-main-photo"
          ? { ...assignment, endLineId: "main-added-line-2" }
          : assignment
      )
    );
  });

  it("extends a single-line section-end assignment", () => {
    const project = projectFixture();
    const candidate = appendLines(project.script, 2, ["outro-added-line"]);
    const result = applyEditedScript(project, candidate);

    expect(result.project.visuals.assignments).toEqual(
      project.visuals.assignments.map((assignment) =>
        assignment.id === "visual-outro-document"
          ? { ...assignment, endLineId: "outro-added-line" }
          : assignment
      )
    );
  });

  it("does not extend an assignment with an explicit mid-section end", () => {
    const project = projectFixture();
    const firstIntroLineId = project.script.sections[0]?.lines[0]?.id;
    if (firstIntroLineId === undefined) {
      throw new Error("The test fixture must contain an intro line.");
    }
    project.visuals.assignments = project.visuals.assignments.map(
      (assignment) =>
        assignment.id === "visual-intro-video"
          ? { ...assignment, endLineId: firstIntroLineId }
          : assignment
    );

    const candidate = appendLines(project.script, 0, ["added-line"]);
    const result = applyEditedScript(project, candidate);

    expect(result.project.visuals.assignments).toEqual(
      project.visuals.assignments
    );
  });

  it("does not extend after a line reorder even when a line is appended", () => {
    const project = projectFixture();
    const mainSection = project.script.sections[1];
    if (mainSection === undefined) {
      throw new Error("The test fixture must contain a main section.");
    }
    const mainEndLineId = mainSection.lines.at(-1)?.id;
    if (mainEndLineId === undefined) {
      throw new Error("The test fixture must contain a main line.");
    }
    project.visuals.assignments = project.visuals.assignments.map(
      (assignment) =>
        assignment.id === "visual-main-photo"
          ? {
              ...assignment,
              startLineId: mainEndLineId,
              endLineId: mainEndLineId
            }
          : assignment
    );
    const candidate: Script = {
      ...project.script,
      sections: project.script.sections.map((section, sectionIndex) =>
        sectionIndex === 1
          ? {
              ...section,
              lines: [
                ...[...section.lines].reverse(),
                {
                  ...section.lines[0],
                  id: "main-added-after-reorder"
                }
              ]
            }
          : section
      )
    };
    const result = applyEditedScript(project, candidate);

    expect(
      result.project.visuals.assignments.find(
        (assignment) => assignment.id === "visual-main-photo"
      )
    ).toEqual(
      project.visuals.assignments.find(
        (assignment) => assignment.id === "visual-main-photo"
      )
    );
  });

  it("preserves video playback cues and display settings while extending", () => {
    const project = projectFixture();
    const videoAssignment = project.visuals.assignments.find(
      (assignment) => assignment.id === "visual-intro-video"
    );
    if (
      videoAssignment === undefined ||
      videoAssignment.display.kind !== "video"
    ) {
      throw new Error("The test fixture must contain a video assignment.");
    }
    videoAssignment.display.playbackCues = [
      { lineId: "intro-learner-1", edge: "after", action: "pause" }
    ];

    const candidate = appendLines(project.script, 0, ["added-line"]);
    const result = applyEditedScript(project, candidate);

    expect(
      result.project.visuals.assignments.find(
        (assignment) => assignment.id === "visual-intro-video"
      )
    ).toEqual({ ...videoAssignment, endLineId: "added-line" });
  });
});

describe("pruneInvalidatedDownstreamReferences", () => {
  it("drops a visual assignment and sound effect whose line was deleted", () => {
    const project = projectFixture();
    const candidate = {
      ...project.script,
      sections: project.script.sections.map((section, index) =>
        index === 2 ? { ...section, lines: section.lines.slice(1) } : section
      )
    };
    const result = applyEditedScript(project, candidate);

    expect(result.impact.structuralChanged).toBe(true);
    expect(
      result.project.visuals.assignments.some(
        (assignment) => assignment.id === "visual-outro-document"
      )
    ).toBe(false);
    expect(
      result.project.audio.soundEffects.some(
        (effect) => effect.id === "effect-attention"
      )
    ).toBe(false);
    expect(
      result.project.visuals.assignments.some(
        (assignment) => assignment.id === "visual-intro-video"
      )
    ).toBe(true);
    expect(
      result.project.audio.soundEffects.some(
        (effect) => effect.id === "effect-confirm"
      )
    ).toBe(true);
  });

  it("drops only the visual assignment whose range is reversed by a reorder", () => {
    const project = projectFixture();
    const candidate = {
      ...project.script,
      sections: project.script.sections.map((section, index) =>
        index === 0
          ? { ...section, lines: [...section.lines].reverse() }
          : section
      )
    };
    const result = applyEditedScript(project, candidate);

    expect(result.impact.structuralChanged).toBe(true);
    expect(
      result.project.visuals.assignments.some(
        (assignment) => assignment.id === "visual-intro-video"
      )
    ).toBe(false);
    expect(
      result.project.visuals.assignments.some(
        (assignment) => assignment.id === "visual-main-photo"
      )
    ).toBe(true);
    expect(
      result.project.visuals.assignments.some(
        (assignment) => assignment.id === "visual-outro-document"
      )
    ).toBe(true);
  });

  it("keeps assignments that still reference existing lines after an append", () => {
    const project = projectFixture();
    const candidate = addFirstLine(project.script);
    const result = applyEditedScript(project, candidate);

    expect(result.impact.structuralChanged).toBe(true);
    expect(result.project.visuals.assignments).toEqual(
      project.visuals.assignments.map((assignment) =>
        assignment.id === "visual-intro-video"
          ? { ...assignment, endLineId: "added-line" }
          : assignment
      )
    );
    expect(result.project.audio.soundEffects).toEqual(
      project.audio.soundEffects
    );
  });

  it("is a no-op for a project without script changes", () => {
    const project = projectFixture();
    const pruned = pruneInvalidatedDownstreamReferences(project);

    expect(pruned).toEqual(project);
  });
});
