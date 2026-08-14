import { describe, expect, it } from "vitest";

import {
  WORKFLOW_STEPS,
  workflowStepPath,
  workflowStepStatus
} from "../../src/web/workflow-indicator";

describe("workflow indicator", () => {
  it("keeps the production steps in order", () => {
    expect(WORKFLOW_STEPS.map((step) => step.id)).toEqual([
      "brief",
      "outline",
      "production",
      "output"
    ]);
  });

  it("links each step to the existing workflow screen", () => {
    expect(workflowStepPath("project/1", "brief")).toBe(
      "/projects/project%2F1/brief"
    );
    expect(workflowStepPath("project/1", "outline")).toBe(
      "/projects/project%2F1/outline"
    );
    expect(workflowStepPath("project/1", "production")).toBe(
      "/projects/project%2F1/script"
    );
    expect(workflowStepPath("project/1", "output")).toBe(
      "/projects/project%2F1/preview"
    );
  });

  it("marks earlier, current, and later steps distinctly", () => {
    expect(workflowStepStatus("production", "outline")).toBe("past");
    expect(workflowStepStatus("production", "production")).toBe("current");
    expect(workflowStepStatus("production", "output")).toBe("future");
  });
});
