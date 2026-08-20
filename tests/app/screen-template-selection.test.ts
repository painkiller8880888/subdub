import { describe, expect, it } from "vitest";

import { validateVideoProjectScreenTemplateReferences } from "../../src/app/projects/screen-template-selection.js";
import type { VideoProject } from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function projectFixture(): VideoProject {
  return structuredClone(videoProjectFixture) as VideoProject;
}

describe("screen template selection", () => {
  it("reports missing and inactive references without rewriting their IDs", () => {
    const project = projectFixture();
    const missingSection = project.script.sections[0]!;
    missingSection.screenTemplateId = "missing-template";
    const inactiveSection = project.script.sections[1]!;
    inactiveSection.screenTemplateId = "inactive-template";

    const issues = validateVideoProjectScreenTemplateReferences(project, {
      findById: (templateId) =>
        templateId === "screen-template-standard"
          ? { status: "active" }
          : templateId === "inactive-template"
            ? { status: "inactive" }
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
        path: ["script", "sections", 1, "screenTemplateId"]
      })
    ]);
    expect(missingSection.screenTemplateId).toBe("missing-template");
    expect(inactiveSection.screenTemplateId).toBe("inactive-template");
  });
});
