import { describe, expect, it } from "vitest";

import {
  calculateLineRanges,
  calculateSectionRanges,
  calculateVisualRanges,
  containsFrame,
  createFrameRange,
  getEndExclusive,
  msToFrames,
  rangesOverlap,
  type TimelineLineInput,
  type TimelineVisualAssignment
} from "../../src/timeline/index.js";

describe("timeline pure calculations", () => {
  it("converts milliseconds with the specified ceil formula", () => {
    expect(msToFrames(0, 30)).toBe(0);
    expect(msToFrames(1, 30)).toBe(1);
    expect(msToFrames(1000, 30)).toBe(30);
    expect(msToFrames(2000, 30)).toBe(60);

    const frameBoundaryMs = 1000 / 30;
    expect(msToFrames(frameBoundaryMs - 0.001, 30)).toBe(1);
    expect(msToFrames(frameBoundaryMs, 30)).toBe(1);
    expect(msToFrames(frameBoundaryMs + 0.001, 30)).toBe(2);
    expect(msToFrames(1500, 29.97)).toBe(Math.ceil((1500 / 1000) * 29.97));
  });

  it("represents ranges as half-open intervals", () => {
    const range = createFrameRange(10, 20);

    expect(range).toEqual({ from: 10, durationInFrames: 10 });
    expect(getEndExclusive(range)).toBe(20);
    expect(containsFrame(range, 10)).toBe(true);
    expect(containsFrame(range, 19)).toBe(true);
    expect(containsFrame(range, 20)).toBe(false);
    expect(
      rangesOverlap(createFrameRange(0, 10), createFrameRange(10, 20))
    ).toBe(false);
    expect(
      rangesOverlap(createFrameRange(0, 10), createFrameRange(9, 20))
    ).toBe(true);
  });

  it("converts each pause and audio component before adding them", () => {
    const lines: TimelineLineInput[] = [
      {
        id: "line-one",
        sectionId: "section-one",
        pauseBeforeMs: 1,
        durationMs: 1001,
        pauseAfterMs: 1
      }
    ];

    expect(calculateLineRanges(lines, 30)).toEqual([
      {
        id: "line-one",
        sectionId: "section-one",
        from: 0,
        durationInFrames: 33,
        speechFrom: 1,
        speechDurationInFrames: 31
      }
    ]);
  });

  const lines: TimelineLineInput[] = [
    {
      id: "line-one",
      sectionId: "section-one",
      pauseBeforeMs: 1,
      durationMs: 1001,
      pauseAfterMs: 1
    },
    {
      id: "line-two",
      sectionId: "section-one",
      pauseBeforeMs: 0,
      durationMs: 1000,
      pauseAfterMs: 0
    },
    {
      id: "line-three",
      sectionId: "section-two",
      pauseBeforeMs: 0,
      durationMs: 2000,
      pauseAfterMs: 0
    }
  ];

  it("accumulates lines in input order across section boundaries", () => {
    expect(calculateLineRanges(lines, 30)).toEqual([
      {
        id: "line-one",
        sectionId: "section-one",
        from: 0,
        durationInFrames: 33,
        speechFrom: 1,
        speechDurationInFrames: 31
      },
      {
        id: "line-two",
        sectionId: "section-one",
        from: 33,
        durationInFrames: 30,
        speechFrom: 0,
        speechDurationInFrames: 30
      },
      {
        id: "line-three",
        sectionId: "section-two",
        from: 63,
        durationInFrames: 60,
        speechFrom: 0,
        speechDurationInFrames: 60
      }
    ]);
  });

  it("derives section ranges from the first and last line", () => {
    const lineRanges = calculateLineRanges(lines, 30);

    expect(calculateSectionRanges(lineRanges)).toEqual([
      { sectionId: "section-one", from: 0, durationInFrames: 63 },
      { sectionId: "section-two", from: 63, durationInFrames: 60 }
    ]);
    expect(calculateSectionRanges([])).toEqual([]);
  });

  it("resolves a single-line visual range inclusively at the line level", () => {
    const lineRanges = calculateLineRanges(lines, 30);
    const assignments: TimelineVisualAssignment[] = [
      { id: "visual-one", startLineId: "line-two", endLineId: "line-two" }
    ];

    expect(calculateVisualRanges(assignments, lineRanges)).toEqual([
      { id: "visual-one", from: 33, durationInFrames: 30 }
    ]);
  });

  it("resolves a multi-line visual range through the end of the last line", () => {
    const lineRanges = calculateLineRanges(lines, 30);
    const assignments: TimelineVisualAssignment[] = [
      { id: "visual-one", startLineId: "line-one", endLineId: "line-two" }
    ];

    expect(calculateVisualRanges(assignments, lineRanges)).toEqual([
      { id: "visual-one", from: 0, durationInFrames: 63 }
    ]);
  });

  it("stable-sorts visual ranges by from without changing equal-start input order", () => {
    const lineRanges = calculateLineRanges(lines, 30);
    const assignments: TimelineVisualAssignment[] = [
      { id: "visual-second", startLineId: "line-one", endLineId: "line-one" },
      { id: "visual-later", startLineId: "line-two", endLineId: "line-two" },
      { id: "visual-first", startLineId: "line-one", endLineId: "line-two" }
    ];

    expect(
      calculateVisualRanges(assignments, lineRanges).map(({ id }) => id)
    ).toEqual(["visual-second", "visual-first", "visual-later"]);
  });

  it("does not mutate inputs and is deterministic for repeated equivalent inputs", () => {
    const inputLines = lines.map((line) => ({ ...line }));
    const inputAssignments: TimelineVisualAssignment[] = [
      { id: "visual-two", startLineId: "line-two", endLineId: "line-two" },
      { id: "visual-one", startLineId: "line-one", endLineId: "line-one" }
    ];
    const linesBefore = structuredClone(inputLines);
    const assignmentsBefore = structuredClone(inputAssignments);

    const firstLineRanges = calculateLineRanges(inputLines, 30);
    const secondLineRanges = calculateLineRanges(inputLines, 30);
    const firstVisualRanges = calculateVisualRanges(
      inputAssignments,
      firstLineRanges
    );
    const secondVisualRanges = calculateVisualRanges(
      inputAssignments,
      secondLineRanges
    );

    expect(firstLineRanges).toEqual(secondLineRanges);
    expect(firstVisualRanges).toEqual(secondVisualRanges);
    expect(inputLines).toEqual(linesBefore);
    expect(inputAssignments).toEqual(assignmentsBefore);
  });

  it("rejects visual ranges that cannot be resolved within one section", () => {
    const lineRanges = calculateLineRanges(lines, 30);

    expect(() =>
      calculateVisualRanges(
        [{ id: "missing", startLineId: "unknown", endLineId: "line-one" }],
        lineRanges
      )
    ).toThrow("unknown start line");
    expect(() =>
      calculateVisualRanges(
        [
          {
            id: "cross-section",
            startLineId: "line-one",
            endLineId: "line-three"
          }
        ],
        lineRanges
      )
    ).toThrow("one section");
    expect(() =>
      calculateVisualRanges(
        [{ id: "reversed", startLineId: "line-two", endLineId: "line-one" }],
        lineRanges
      )
    ).toThrow("must not follow");
  });
});
