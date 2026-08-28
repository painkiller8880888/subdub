import type {
  ScriptSection,
  VisualAssignment,
  VisualPlaybackCue
} from "../../schema/index.js";

export type VisualAssignmentReplacementSnapshot = Pick<
  VisualAssignment,
  "id" | "assetId" | "assetChecksum" | "projectMediaPath" | "display"
>;

export type VisualAssignmentSplitFailureCode =
  | "assignment-range-invalid"
  | "selected-line-not-found"
  | "selected-line-outside-assignment"
  | "replacement-id-conflict"
  | "replacement-overlap";

export type VisualAssignmentSplitFailure = Readonly<{
  ok: false;
  code: VisualAssignmentSplitFailureCode;
  message: string;
  conflictingAssignmentId?: string;
}>;

export type VisualAssignmentSplitPlan = Readonly<{
  ok: true;
  mode: "replace" | "split";
  shortenedAssignment: VisualAssignment | undefined;
  replacementAssignment: VisualAssignment;
  outsidePlaybackCues: readonly VisualPlaybackCue[];
}>;

export type VisualAssignmentSplitResult =
  | VisualAssignmentSplitPlan
  | VisualAssignmentSplitFailure;

type LineRange = Readonly<{
  start: number;
  end: number;
}>;

function lineRange(
  assignment: Pick<VisualAssignment, "startLineId" | "endLineId">,
  lines: readonly ScriptSection["lines"][number][]
): LineRange | undefined {
  const start = lines.findIndex((line) => line.id === assignment.startLineId);
  const end = lines.findIndex((line) => line.id === assignment.endLineId);
  if (start < 0 || end < 0 || start > end) {
    return undefined;
  }
  return { start, end };
}

function rangesOverlap(left: LineRange, right: LineRange): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function failure(
  code: VisualAssignmentSplitFailureCode,
  message: string,
  conflictingAssignmentId?: string
): VisualAssignmentSplitFailure {
  return {
    ok: false,
    code,
    message,
    ...(conflictingAssignmentId === undefined
      ? {}
      : { conflictingAssignmentId })
  };
}

/**
 * Create the immutable range mutation for changing a generic visual from a
 * selected script line. The caller owns asset validation and persistence.
 */
export function splitVisualAssignmentAtLine(input: {
  assignment: VisualAssignment;
  selectedLineId: string;
  replacement: VisualAssignmentReplacementSnapshot;
  section: Pick<ScriptSection, "id" | "lines">;
  existingAssignments?: readonly VisualAssignment[];
}): VisualAssignmentSplitResult {
  const currentRange = lineRange(input.assignment, input.section.lines);
  if (currentRange === undefined) {
    return failure(
      "assignment-range-invalid",
      "The visual assignment range is invalid for the selected section."
    );
  }

  const selectedIndex = input.section.lines.findIndex(
    (line) => line.id === input.selectedLineId
  );
  if (selectedIndex < 0) {
    return failure(
      "selected-line-not-found",
      "The selected script line does not exist in the assignment section."
    );
  }
  if (
    selectedIndex < currentRange.start ||
    selectedIndex > currentRange.end
  ) {
    return failure(
      "selected-line-outside-assignment",
      "The selected script line is outside the visual assignment range."
    );
  }

  const existingAssignments = input.existingAssignments ?? [];
  if (
    selectedIndex > currentRange.start &&
    (input.replacement.id === input.assignment.id ||
      existingAssignments.some(
        (assignment) =>
          assignment.id !== input.assignment.id &&
          assignment.id === input.replacement.id
      ))
  ) {
    return failure(
      "replacement-id-conflict",
      "The replacement visual assignment ID is already in use.",
      input.replacement.id
    );
  }

  const selectedLine = input.section.lines[selectedIndex];
  if (selectedLine === undefined) {
    return failure(
      "selected-line-not-found",
      "The selected script line does not exist in the assignment section."
    );
  }

  const isReplacement = selectedIndex === currentRange.start;
  const replacementEndIndex = isReplacement
    ? currentRange.end
    : input.section.lines.length - 1;
  const replacementEnd = input.section.lines[replacementEndIndex];
  if (replacementEnd === undefined) {
    return failure(
      "assignment-range-invalid",
      "The selected section does not have a valid final line."
    );
  }

  const replacementRange = {
    start: selectedIndex,
    end: replacementEndIndex
  } satisfies LineRange;
  for (const existingAssignment of existingAssignments) {
    if (existingAssignment.id === input.assignment.id) {
      continue;
    }
    const existingRange = lineRange(existingAssignment, input.section.lines);
    if (
      existingRange !== undefined &&
      rangesOverlap(replacementRange, existingRange)
    ) {
      return failure(
        "replacement-overlap",
        "The replacement visual assignment would overlap another assignment.",
        existingAssignment.id
      );
    }
  }

  const replacementAssignment: VisualAssignment = {
    ...input.replacement,
    id: isReplacement ? input.assignment.id : input.replacement.id,
    startLineId: selectedLine.id,
    endLineId: replacementEnd.id
  };

  if (isReplacement) {
    return {
      ok: true,
      mode: "replace",
      shortenedAssignment: undefined,
      replacementAssignment,
      outsidePlaybackCues: []
    };
  }

  const previousLine = input.section.lines[selectedIndex - 1];
  if (previousLine === undefined) {
    return failure(
      "assignment-range-invalid",
      "The previous script line for the shortened assignment is missing."
    );
  }

  const shortenedAssignment: VisualAssignment = {
    ...input.assignment,
    endLineId: previousLine.id
  };
  const outsidePlaybackCues =
    input.assignment.display.kind === "video"
      ? input.assignment.display.playbackCues.filter((cue) => {
          const cueIndex = input.section.lines.findIndex(
            (line) => line.id === cue.lineId
          );
          return cueIndex < 0 || cueIndex > selectedIndex - 1;
        })
      : [];

  return {
    ok: true,
    mode: "split",
    shortenedAssignment,
    replacementAssignment,
    outsidePlaybackCues
  };
}

export function removeVisualPlaybackCuesOutsideRange(
  assignment: VisualAssignment,
  section: Pick<ScriptSection, "lines">,
  endLineId: string
): VisualAssignment {
  if (assignment.display.kind !== "video") {
    return assignment;
  }
  const endIndex = section.lines.findIndex((line) => line.id === endLineId);
  return {
    ...assignment,
    display: {
      ...assignment.display,
      playbackCues: assignment.display.playbackCues.filter((cue) => {
        const cueIndex = section.lines.findIndex((line) => line.id === cue.lineId);
        return endIndex >= 0 && cueIndex >= 0 && cueIndex <= endIndex;
      })
    }
  };
}
