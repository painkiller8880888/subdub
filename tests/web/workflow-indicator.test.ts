import { describe, expect, it } from "vitest";

import {
  WORKFLOW_STEPS,
  workflowStepPath,
  workflowStepStatus
} from "../../src/web/workflow-indicator";

describe("workflow indicator", () => {
  it("keeps the script and edit steps in order", () => {
    expect(WORKFLOW_STEPS.map((step) => step.id)).toEqual([
      "production",
      "edit",
      "output"
    ]);
    expect(WORKFLOW_STEPS.map((step) => step.label)).toEqual([
      "台本",
      "編集",
      "出力"
    ]);
  });

  it("links each step to the existing workflow screen", () => {
    expect(workflowStepPath("project/1", "production")).toBe(
      "/projects/project%2F1/script"
    );
    expect(workflowStepPath("project/1", "edit")).toBe(
      "/projects/project%2F1/edit"
    );
    expect(workflowStepPath("project/1", "output")).toBe(
      "/projects/project%2F1/preview"
    );
  });

  it("marks earlier, current, and later steps distinctly", () => {
    expect(workflowStepStatus("edit", "production")).toBe("past");
    expect(workflowStepStatus("edit", "edit")).toBe("current");
    expect(workflowStepStatus("edit", "output")).toBe("future");
  });
});
