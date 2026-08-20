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
    const section = project.script.sections[0]!;
    section.screenTemplateId = "missing-template";

    const issues = validateVideoProjectScreenTemplateReferences(project, {
      findById: (templateId) =>
        templateId === "screen-template-standard"
          ? { status: "active" }
          : templateId === "missing-template"
            ? { status: "inactive" }
            : undefined
    });

    expect(issues).toEqual([
      expect.objectContaining({
        reason: "inactive",
        templateId: "missing-template",
        path: ["script", "sections", 0, "screenTemplateId"]
      })
    ]);
    expect(section.screenTemplateId).toBe("missing-template");
  });
});
