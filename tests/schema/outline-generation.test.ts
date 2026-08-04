import { describe, expect, it } from "vitest";

import {
  outlineGenerationCandidateSchema,
  outlineGenerationJsonSchema
} from "../../src/schema/outline-generation.js";

function validCandidate() {
  return {
    openQuestions: [],
    sections: [
      {
        role: "intro",
        title: "Introduction",
        overview: "Overview",
        keyPoints: [],
        targetDurationSec: 10,
        sourceRefs: [{ headingPath: ["Overview"] }],
        openQuestions: []
      },
      {
        role: "main",
        title: "Main",
        overview: "Overview",
        keyPoints: [],
        targetDurationSec: 20,
        sourceRefs: [{ headingPath: ["Overview", "Main"] }],
        openQuestions: []
      },
      {
        role: "outro",
        title: "Outro",
        overview: "Overview",
        keyPoints: [],
        targetDurationSec: 10,
        sourceRefs: [{ headingPath: ["Overview"] }],
        openQuestions: []
      }
    ]
  };
}

describe("outline generation schema", () => {
  it("rejects unknown keys at every generated object boundary", () => {
    const candidate = validCandidate();
    Object.assign(candidate, { unexpected: true });
    Object.assign(candidate.sections[0], { unexpected: true });
    Object.assign(candidate.sections[0].sourceRefs[0], { unexpected: true });

    expect(outlineGenerationCandidateSchema.safeParse(candidate).success).toBe(
      false
    );

    const questionCandidate = validCandidate();
    questionCandidate.sections[0].openQuestions.push({
      question: "Question",
      unexpected: true
    } as never);
    expect(
      outlineGenerationCandidateSchema.safeParse(questionCandidate).success
    ).toBe(false);
  });

  it("requires at least one source reference and one heading in each reference", () => {
    const noRefs = validCandidate();
    noRefs.sections[0].sourceRefs = [];
    expect(outlineGenerationCandidateSchema.safeParse(noRefs).success).toBe(
      false
    );

    const noHeading = validCandidate();
    noHeading.sections[0].sourceRefs = [{ headingPath: [] }];
    expect(outlineGenerationCandidateSchema.safeParse(noHeading).success).toBe(
      false
    );
  });

  it("keeps the transport JSON Schema aligned with the strict input rules", () => {
    const sections = outlineGenerationJsonSchema.properties.sections;
    const sourceRefs = sections.items.properties.sourceRefs;
    const headingPath = sourceRefs.items.properties.headingPath;

    expect(sections.minItems).toBe(3);
    expect(sourceRefs.minItems).toBe(1);
    expect(headingPath.minItems).toBe(1);
  });
});
