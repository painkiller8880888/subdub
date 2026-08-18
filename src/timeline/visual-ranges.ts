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

export function sortByStartThenInputIndex<T>(
  items: readonly T[],
  getStart: (item: T) => number
): T[] {
  return items
    .map((item, inputIndex) => ({
      item,
      inputIndex,
      start: getStart(item)
    }))
    .sort((left, right) => {
      const startDifference = left.start - right.start;
      return startDifference === 0
        ? left.inputIndex - right.inputIndex
        : startDifference;
    })
    .map(({ item }) => item);
}

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
  return sortByStartThenInputIndex(
    assignments.map((assignment) => ({
      assignment,
      range: resolveVisualRange(assignment, lines)
    })),
    ({ range }) => range.from
  ).map(({ range }) => range);
}
