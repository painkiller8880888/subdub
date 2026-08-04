import { describe, expect, it } from "vitest";

import {
  cloneOutline,
  countOpenQuestions,
  hasStaleSource,
  normalizeOutlineOrders,
  outlineOrderErrors
} from "../../src/web/outline-draft.js";
import type { Outline } from "../../src/schema/index.js";

const outline: Outline = {
  status: "needs_review",
  sourceHash: "a".repeat(64),
  generationRunId: "outline-run",
  openQuestions: [
    { id: "global", question: "global", resolution: null, status: "open" }
  ],
  sections: [
    {
      id: "intro",
      order: 1,
      role: "intro",
      title: "intro",
      overview: "",
      keyPoints: [],
      targetDurationSec: 1,
      sourceRefs: [],
      openQuestions: [],
      humanDirectives: {
        requiredItems: [],
        prohibitedItems: [],
        scriptConstraints: []
      },
      lockedFields: []
    },
    {
      id: "main",
      order: 2,
      role: "main",
      title: "main",
      overview: "",
      keyPoints: [],
      targetDurationSec: 1,
      sourceRefs: [],
      openQuestions: [
        { id: "section", question: "section", resolution: null, status: "open" }
      ],
      humanDirectives: {
        requiredItems: [],
        prohibitedItems: [],
        scriptConstraints: []
      },
      lockedFields: []
    },
    {
      id: "outro",
      order: 3,
      role: "outro",
      title: "outro",
      overview: "",
      keyPoints: [],
      targetDurationSec: 1,
      sourceRefs: [],
      openQuestions: [],
      humanDirectives: {
        requiredItems: [],
        prohibitedItems: [],
        scriptConstraints: []
      },
      lockedFields: []
    }
  ]
};

describe("outline draft helpers", () => {
  it("keeps stable section data while normalizing order after a move", () => {
    const moved = cloneOutline(outline);
    moved.sections = [
      moved.sections[0]!,
      moved.sections[2]!,
      moved.sections[1]!
    ];
    moved.sections[0]!.order = 9;
    const normalized = normalizeOutlineOrders(moved);

    expect(normalized.sections.map((section) => section.id)).toEqual([
      "intro",
      "outro",
      "main"
    ]);
    expect(normalized.sections.map((section) => section.order)).toEqual([
      1, 2, 3
    ]);
  });

  it("counts global and section questions and reports stale source separately", () => {
    expect(countOpenQuestions(outline)).toBe(2);
    expect(hasStaleSource(outline, "b".repeat(64))).toBe(true);
    expect(hasStaleSource(outline, outline.sourceHash)).toBe(false);
  });

  it("reports order errors without deciding server approval", () => {
    expect(outlineOrderErrors(outline)).toEqual([]);
    const invalid = cloneOutline(outline);
    invalid.sections[1]!.role = "outro";
    expect(outlineOrderErrors(invalid).length).toBeGreaterThan(0);
  });
});
