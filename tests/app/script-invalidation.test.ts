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
  return {
    ...script,
    sections: script.sections.map((section, sectionIndex) =>
      sectionIndex === 0
        ? {
            ...section,
            lines: [
              ...section.lines,
              {
                id: "added-line",
                screenTemplateId: null,
                speakerId: "character-mentor",
                spokenText: "追加されたセリフ",
                subtitleText: "追加された字幕",
                expression: "neutral",
                characterVariantId: null,
                pauseBeforeMs: 0,
                pauseAfterMs: 250,
                voiceOverrides: {},
                pronunciation: { mode: "dictionary", excludedTermIds: [] }
              }
            ]
          }
        : section
    )
  };
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

  it("marks the manifest stale when a section or line template changes", () => {
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

    const lineTemplateCandidate: Script = {
      ...current,
      sections: current.sections.map((section, sectionIndex) =>
        sectionIndex === 0
          ? {
              ...section,
              lines: section.lines.map((line, lineIndex) =>
                lineIndex === 0
                  ? { ...line, screenTemplateId: "screen-template-custom" }
                  : line
              )
            }
          : section
      )
    };
    expect(
      classifyScriptChange(current, lineTemplateCandidate).staleTargets
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
      project.visuals.assignments
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
      project.visuals.assignments
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
