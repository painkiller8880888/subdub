import { describe, expect, it } from "vitest";

import {
  assertNoRemovedScriptSections,
  normalizeEditedScriptIds
} from "../../src/app/projects/current-script-domain.js";
import { createScriptSection } from "../../src/app/projects/starter-script-sections.js";
import type { Script, VideoProject } from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function projectFixture(): VideoProject {
  return structuredClone(videoProjectFixture) as VideoProject;
}

describe("script section lifecycle domain rules", () => {
  it("keeps existing section IDs stable when the candidate is reordered", () => {
    const project = projectFixture();
    const candidate: Script = {
      ...project.script,
      sections: [...project.script.sections].reverse()
    };

    const normalized = normalizeEditedScriptIds(
      project,
      candidate,
      () => "unused-id"
    );

    expect(normalized.sections.map((section) => section.id)).toEqual(
      candidate.sections.map((section) => section.id)
    );
    expect(normalized.sections.flatMap((section) => section.lines)).toEqual(
      candidate.sections.flatMap((section) => section.lines)
    );
  });

  it("keeps section and line references stable when a section is renamed", () => {
    const project = projectFixture();
    const renamedSectionId = project.script.sections[1]!.id;
    const candidate: Script = {
      ...project.script,
      sections: project.script.sections.map((section) =>
        section.id === renamedSectionId
          ? { ...section, name: "名前変更後" }
          : section
      )
    };

    const normalized = normalizeEditedScriptIds(
      project,
      candidate,
      () => "unused-id"
    );

    expect(normalized.sections[1]?.id).toBe(renamedSectionId);
    expect(normalized.sections[1]?.lines.map((line) => line.id)).toEqual(
      project.script.sections[1]?.lines.map((line) => line.id)
    );
  });

  it("assigns a backend ID and canonical defaults to a new section", () => {
    const project = projectFixture();
    const candidate: Script = {
      ...project.script,
      sections: [
        ...project.script.sections,
        {
          ...createScriptSection("client-provided-section", "追加セクション"),
          enabled: false,
          background: {
            kind: "image",
            src: "backgrounds/client-provided.png",
            fit: "cover"
          },
          screenTemplateId: "client-provided-template"
        }
      ]
    };

    const normalized = normalizeEditedScriptIds(
      project,
      candidate,
      () => "backend-section"
    );
    const addedSection = normalized.sections.at(-1);

    expect(addedSection).toEqual(
      createScriptSection("script-section-backend-section", "追加セクション")
    );
  });

  it("rejects an existing section omitted from the candidate", () => {
    const project = projectFixture();
    const candidate: Script = {
      ...project.script,
      sections: project.script.sections.slice(1)
    };

    expect(() =>
      assertNoRemovedScriptSections(project.script, candidate)
    ).toThrow();
    try {
      assertNoRemovedScriptSections(project.script, candidate);
    } catch (error) {
      expect(error).toMatchObject({
        details: [
          {
            message: expect.stringContaining("cannot be hard-deleted")
          }
        ]
      });
    }
  });

  it("generates backend IDs for new lines while preserving IDs after section reorder", () => {
    const project = projectFixture();
    const mainSection = project.script.sections.find(
      (section) => section.id === "section-main"
    );
    const lineTemplate = mainSection?.lines[0];
    if (lineTemplate === undefined) {
      throw new Error("The test fixture must contain a main line.");
    }
    const candidate: Script = {
      ...project.script,
      sections: [
        project.script.sections[2]!,
        project.script.sections[0]!,
        {
          ...mainSection!,
          lines: [...mainSection!.lines, { ...lineTemplate, id: "client-line" }]
        }
      ]
    };

    const normalized = normalizeEditedScriptIds(
      project,
      candidate,
      () => "backend-line"
    );

    expect(normalized.sections.map((section) => section.id)).toEqual([
      "section-outro",
      "section-intro",
      "section-main"
    ]);
    expect(normalized.sections[0]?.lines[0]?.id).toBe("outro-mentor-1");
    expect(normalized.sections[1]?.lines[0]?.id).toBe("intro-mentor-1");
    expect(normalized.sections[2]?.lines.at(-1)?.id).toBe(
      "script-line-backend-line"
    );
  });
});
