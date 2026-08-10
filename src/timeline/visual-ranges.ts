import type { VisualAssignment } from "../schema/index.js";
import { createFrameRange, getEndExclusive } from "./frame-range.js";
import type { FrameRange } from "./frame-range.js";
import type { TimelineLineRange } from "./line-ranges.js";

export type TimelineVisualAssignment = Readonly<
  Pick<VisualAssignment, "id" | "startLineId" | "endLineId">
>;

export type TimelineVisualRange = FrameRange & {
  readonly id: VisualAssignment["id"];
};

function findLineRange(
  lines: readonly TimelineLineRange[],
  lineId: string,
  assignmentId: string,
  endpoint: "start" | "end"
): TimelineLineRange {
  const line = lines.find((candidate) => candidate.id === lineId);
  if (line === undefined) {
    throw new Error(
      `visual assignment ${assignmentId} has an unknown ${endpoint} line: ${lineId}`
    );
  }
  return line;
}

function resolveVisualRange(
  assignment: TimelineVisualAssignment,
  lines: readonly TimelineLineRange[]
): TimelineVisualRange {
  const start = findLineRange(
    lines,
    assignment.startLineId,
    assignment.id,
    "start"
  );
  const end = findLineRange(lines, assignment.endLineId, assignment.id, "end");

  if (start.sectionId !== end.sectionId) {
    throw new Error(
      `visual assignment ${assignment.id} must stay within one section`
    );
  }
  if (start.from > end.from) {
    throw new Error(
      `visual assignment ${assignment.id} start line must not follow end line`
    );
  }

  return {
    id: assignment.id,
    ...createFrameRange(start.from, getEndExclusive(end))
  };
}

export function calculateVisualRanges(
  assignments: readonly TimelineVisualAssignment[],
  lines: readonly TimelineLineRange[]
): TimelineVisualRange[] {
  return assignments
    .map((assignment, inputIndex) => ({
      inputIndex,
      range: resolveVisualRange(assignment, lines)
    }))
    .sort((left, right) => {
      const fromDifference = left.range.from - right.range.from;
      return fromDifference === 0
        ? left.inputIndex - right.inputIndex
        : fromDifference;
    })
    .map(({ range }) => range);
}
