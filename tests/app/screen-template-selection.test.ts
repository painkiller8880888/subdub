import { describe, expect, it } from "vitest";

import {
  resolveScreenTemplateId,
  validateVideoProjectScreenTemplateReferences
} from "../../src/app/projects/screen-template-selection.js";
import type { VideoProject } from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function projectFixture(): VideoProject {
  return structuredClone(videoProjectFixture) as VideoProject;
}

describe("screen template selection", () => {
  it("uses a line override and otherwise inherits the section template", () => {
    expect(
      resolveScreenTemplateId(
        { screenTemplateId: "section-template" },
        { screenTemplateId: null }
      )
    ).toBe("section-template");
    expect(
      resolveScreenTemplateId(
        { screenTemplateId: "section-template" },
        { screenTemplateId: "line-template" }
      )
    ).toBe("line-template");
  });

  it("reports missing and inactive references without rewriting their IDs", () => {
    const project = projectFixture();
    const section = project.script.sections[0]!;
    const line = section.lines[0]!;
    section.screenTemplateId = "missing-template";
    line.screenTemplateId = "inactive-template";

    const issues = validateVideoProjectScreenTemplateReferences(project, {
      findById: (templateId) =>
        templateId === "inactive-template"
          ? { status: "inactive" }
          : templateId === "screen-template-standard"
            ? { status: "active" }
            : undefined
    });

    expect(issues).toEqual([
      expect.objectContaining({
        reason: "missing",
        templateId: "missing-template",
        path: ["script", "sections", 0, "screenTemplateId"]
      }),
      expect.objectContaining({
        reason: "inactive",
        templateId: "inactive-template",
        path: ["script", "sections", 0, "lines", 0, "screenTemplateId"]
      })
    ]);
    expect(section.screenTemplateId).toBe("missing-template");
    expect(line.screenTemplateId).toBe("inactive-template");
  });
});
