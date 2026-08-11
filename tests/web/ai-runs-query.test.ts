import { describe, expect, it } from "vitest";

import {
  buildAiRunExportQuery,
  buildAiRunSearchQuery,
  localDateToUtcBoundary,
  type AiRunFilterDraft
} from "../../src/web/ai-runs-query.js";

const draft: AiRunFilterDraft = {
  from: "2026-08-11",
  to: "2026-08-12",
  taskKind: "visual_search_intent",
  modelId: "  google/gemma-4-31b-it  ",
  status: "failed",
  decision: "rejected",
  errorCode: " OPENROUTER_TIMEOUT "
};

describe("AI run search query conversion", () => {
  it("converts local date boundaries to UTC ISO values", () => {
    expect(localDateToUtcBoundary("2026-08-11")).toBe(
      new Date(2026, 7, 11).toISOString()
    );
    expect(localDateToUtcBoundary("2026-08-11", true)).toBe(
      new Date(2026, 7, 12).toISOString()
    );
    expect(localDateToUtcBoundary("")).toBeUndefined();
  });

  it("normalizes draft filters and resets pagination through the query builder", () => {
    expect(buildAiRunSearchQuery(draft, 0)).toMatchObject({
      from: new Date(2026, 7, 11).toISOString(),
      to: new Date(2026, 7, 13).toISOString(),
      taskKind: "visual_search_intent",
      modelId: "google/gemma-4-31b-it",
      status: "failed",
      decision: "rejected",
      errorCode: "OPENROUTER_TIMEOUT",
      limit: 50,
      offset: 0
    });
  });

  it("rejects a non-existent local calendar date", () => {
    expect(() => localDateToUtcBoundary("2026-02-30")).toThrow();
  });

  it("builds export filters from the applied search without pagination", () => {
    const searchQuery = buildAiRunSearchQuery(draft, 50);

    expect(buildAiRunExportQuery(searchQuery)).toEqual({
      from: new Date(2026, 7, 11).toISOString(),
      to: new Date(2026, 7, 13).toISOString(),
      taskKind: "visual_search_intent",
      modelId: "google/gemma-4-31b-it",
      status: "failed",
      decision: "rejected",
      errorCode: "OPENROUTER_TIMEOUT"
    });
  });
});
