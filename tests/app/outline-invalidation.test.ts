import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import {
  applyEditedOutline,
  invalidateForUpstreamChange
} from "../../src/app/projects/project-invalidation.js";
import { describe, expect, it } from "vitest";

describe("outline compatibility invalidation", () => {
  it("does not attach legacy outline state to a V19 project", () => {
    const project = createEmptyVideoProject({
      projectId: "outline-invalidation-project",
      createdAt: "2026-08-20T00:00:00.000Z"
    });

    expect(invalidateForUpstreamChange(project)).toBe(project);
    expect(applyEditedOutline(project, {} as never)).toEqual({
      project,
      contentChanged: false
    });
    expect(project).not.toHaveProperty("outline");
  });
});
