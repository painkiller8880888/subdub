import { createFrameRange, getEndExclusive } from "./frame-range.js";
import type { FrameRange } from "./frame-range.js";
import type { TimelineLineRange } from "./line-ranges.js";

export type TimelineSectionRange = FrameRange & {
  readonly sectionId: TimelineLineRange["sectionId"];
};

/**
 * Resolve ranges for the non-empty sections represented by the line ranges.
 * Empty sections have no derived time range and are therefore omitted.
 */
export function calculateSectionRanges(
  lines: readonly TimelineLineRange[]
): TimelineSectionRange[] {
  const sections: TimelineSectionRange[] = [];

  for (const line of lines) {
    const previous = sections[sections.length - 1];
    if (previous?.sectionId === line.sectionId) {
      sections[sections.length - 1] = {
        sectionId: previous.sectionId,
        ...createFrameRange(previous.from, getEndExclusive(line))
      };
      continue;
    }

    sections.push({
      sectionId: line.sectionId,
      ...createFrameRange(line.from, getEndExclusive(line))
    });
  }

  return sections;
}
