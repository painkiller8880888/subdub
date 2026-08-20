import type { VisualPlaybackCue } from "../schema/visual-playback.js";

export type VisualPlaybackEdge = VisualPlaybackCue["edge"];
export type VisualPlaybackAction = VisualPlaybackCue["action"];
export type VisualPlaybackState = "hidden" | "playing" | "paused";

export type VisualPlaybackBoundary = Readonly<{
  lineId: string;
  edge: VisualPlaybackEdge;
}>;

export type VisualPlaybackScript = Readonly<{
  sections: readonly Readonly<{
    id: string;
    lines: readonly Readonly<{
      id: string;
      pauseBeforeMs?: number;
      pauseAfterMs?: number;
    }>[];
  }>[];
}>;

export type VisualPlaybackAssignment = Readonly<{
  id?: string;
  startLineId: string;
  endLineId: string;
  display: Readonly<{
    kind: string;
    playbackCues?: readonly VisualPlaybackCue[];
  }>;
}>;

export type VisualPlaybackValidationCode =
  | "assignment-start-line-missing"
  | "assignment-end-line-missing"
  | "assignment-range-invalid"
  | "cue-line-missing"
  | "cue-outside-assignment-range"
  | "cue-duplicate"
  | "cue-ambiguous"
  | "cue-on-non-video-assignment"
  | "pause-while-paused"
  | "resume-while-playing";

export type VisualPlaybackValidationIssue = Readonly<{
  code: VisualPlaybackValidationCode;
  path: readonly (string | number)[];
  message: string;
}>;

export type VisualPlaybackValidationResult =
  | Readonly<{
      success: true;
      orderedCues: readonly VisualPlaybackCue[];
      finalState: Exclude<VisualPlaybackState, "hidden">;
    }>
  | Readonly<{
      success: false;
      orderedCues: readonly VisualPlaybackCue[];
      issues: readonly VisualPlaybackValidationIssue[];
    }>;

export type VisualPlaybackResolution = Readonly<{
  visible: boolean;
  playbackState: VisualPlaybackState;
  orderedCues: readonly VisualPlaybackCue[];
  issues?: readonly VisualPlaybackValidationIssue[];
}>;

type LinePosition = Readonly<{
  sectionId: string;
  lineIndex: number;
  globalIndex: number;
}>;

type OrderedCue = Readonly<{
  cue: VisualPlaybackCue;
  inputIndex: number;
  position: number;
}>;

type LinePositionMap = ReadonlyMap<string, LinePosition>;

function buildLinePositions(script: VisualPlaybackScript): LinePositionMap {
  const positions = new Map<string, LinePosition>();
  let globalIndex = 0;

  for (const section of script.sections) {
    for (const [lineIndex, line] of section.lines.entries()) {
      if (!positions.has(line.id)) {
        positions.set(line.id, {
          sectionId: section.id,
          lineIndex,
          globalIndex
        });
      }
      globalIndex += 1;
    }
  }

  return positions;
}

function edgeOffset(edge: VisualPlaybackEdge): number {
  return edge === "before" ? 0 : 1;
}

function boundaryPosition(
  lineId: string,
  edge: VisualPlaybackEdge,
  positions: LinePositionMap
): number | undefined {
  const line = positions.get(lineId);
  return line === undefined
    ? undefined
    : line.globalIndex * 2 + edgeOffset(edge);
}

function issue(
  code: VisualPlaybackValidationCode,
  path: readonly (string | number)[],
  message: string
): VisualPlaybackValidationIssue {
  return { code, path: [...path], message };
}

function cuePath(inputIndex: number, field?: string): (string | number)[] {
  return field === undefined
    ? ["display", "playbackCues", inputIndex]
    : ["display", "playbackCues", inputIndex, field];
}

function transitionState(
  state: Exclude<VisualPlaybackState, "hidden">,
  action: VisualPlaybackAction
): Exclude<VisualPlaybackState, "hidden"> {
  return action === "pause" ? "paused" : "playing";
}

function transitionIssue(
  state: Exclude<VisualPlaybackState, "hidden">,
  cue: VisualPlaybackCue,
  inputIndex: number
): VisualPlaybackValidationIssue | undefined {
  if (cue.action === "pause" && state === "paused") {
    return issue(
      "pause-while-paused",
      cuePath(inputIndex, "action"),
      "pause cue is invalid while playback is already paused"
    );
  }
  if (cue.action === "resume" && state === "playing") {
    return issue(
      "resume-while-playing",
      cuePath(inputIndex, "action"),
      "resume cue is invalid while playback is already playing"
    );
  }
  return undefined;
}

function rangeIssues(
  start: LinePosition | undefined,
  end: LinePosition | undefined
): VisualPlaybackValidationIssue[] {
  const issues: VisualPlaybackValidationIssue[] = [];
  if (start === undefined) {
    issues.push(
      issue(
        "assignment-start-line-missing",
        ["startLineId"],
        "visual assignment start line does not exist"
      )
    );
  }
  if (end === undefined) {
    issues.push(
      issue(
        "assignment-end-line-missing",
        ["endLineId"],
        "visual assignment end line does not exist"
      )
    );
  }
  if (start !== undefined && end !== undefined) {
    if (start.sectionId !== end.sectionId) {
      issues.push(
        issue(
          "assignment-range-invalid",
          ["endLineId"],
          "visual assignment range must stay within one script section"
        )
      );
    } else if (start.lineIndex > end.lineIndex) {
      issues.push(
        issue(
          "assignment-range-invalid",
          ["startLineId"],
          "visual assignment start line must not follow end line"
        )
      );
    }
  }
  return issues;
}

function canonicalCueEntries(
  cues: readonly VisualPlaybackCue[],
  positions: LinePositionMap
): {
  readonly entries: OrderedCue[];
  readonly issues: VisualPlaybackValidationIssue[];
} {
  const entries: OrderedCue[] = [];
  const issues: VisualPlaybackValidationIssue[] = [];
  const exactCues = new Set<string>();
  const boundaryCues = new Set<string>();

  for (const [inputIndex, cue] of cues.entries()) {
    const line = positions.get(cue.lineId);
    if (line === undefined) {
      issues.push(
        issue(
          "cue-line-missing",
          cuePath(inputIndex, "lineId"),
          "playback cue line does not exist"
        )
      );
      continue;
    }

    const exactKey = `${cue.lineId}:${cue.edge}:${cue.action}`;
    if (exactCues.has(exactKey)) {
      issues.push(
        issue(
          "cue-duplicate",
          cuePath(inputIndex),
          "playback cue must be unique"
        )
      );
      continue;
    }
    exactCues.add(exactKey);

    const boundaryKey = `${cue.lineId}:${cue.edge}`;
    if (boundaryCues.has(boundaryKey)) {
      issues.push(
        issue(
          "cue-ambiguous",
          cuePath(inputIndex),
          "playback cue boundary must be unambiguous"
        )
      );
      continue;
    }
    boundaryCues.add(boundaryKey);

    entries.push({
      cue,
      inputIndex,
      position: line.globalIndex * 2 + edgeOffset(cue.edge)
    });
  }

  entries.sort((left, right) => {
    const positionDifference = left.position - right.position;
    return positionDifference === 0
      ? left.inputIndex - right.inputIndex
      : positionDifference;
  });

  return { entries, issues };
}

/**
 * Validate a video assignment's cue sequence without consulting persistence
 * or any UI/rendering runtime. The returned cue order never depends on the
 * input array order.
 */
export function validateVisualPlaybackSequence(
  assignment: VisualPlaybackAssignment,
  script: VisualPlaybackScript
): VisualPlaybackValidationResult {
  const positions = buildLinePositions(script);
  const start = positions.get(assignment.startLineId);
  const end = positions.get(assignment.endLineId);
  const issues = rangeIssues(start, end);
  const cues = assignment.display.playbackCues ?? [];

  if (assignment.display.kind !== "video") {
    if (cues.length > 0) {
      issues.push(
        issue(
          "cue-on-non-video-assignment",
          ["display", "playbackCues"],
          "playback cues are only valid on video assignments"
        )
      );
    }
    return issues.length === 0
      ? { success: true, orderedCues: [], finalState: "playing" }
      : { success: false, orderedCues: [], issues };
  }

  const canonical = canonicalCueEntries(cues, positions);
  issues.push(...canonical.issues);

  if (
    start !== undefined &&
    end !== undefined &&
    start.sectionId === end.sectionId &&
    start.lineIndex <= end.lineIndex
  ) {
    for (const entry of canonical.entries) {
      const cueLine = positions.get(entry.cue.lineId);
      if (
        cueLine === undefined ||
        cueLine.sectionId !== start.sectionId ||
        cueLine.lineIndex < start.lineIndex ||
        cueLine.lineIndex > end.lineIndex
      ) {
        issues.push(
          issue(
            "cue-outside-assignment-range",
            cuePath(entry.inputIndex, "lineId"),
            "playback cue line must stay inside the visual assignment range"
          )
        );
      }
    }
  } else {
    for (const entry of canonical.entries) {
      issues.push(
        issue(
          "cue-outside-assignment-range",
          cuePath(entry.inputIndex, "lineId"),
          "playback cue cannot be resolved until the assignment range is valid"
        )
      );
    }
  }

  let state: Exclude<VisualPlaybackState, "hidden"> = "playing";
  if (issues.length === 0) {
    for (const entry of canonical.entries) {
      const transitionError = transitionIssue(
        state,
        entry.cue,
        entry.inputIndex
      );
      if (transitionError !== undefined) {
        issues.push(transitionError);
        continue;
      }
      state = transitionState(state, entry.cue.action);
    }
  }

  const orderedCues = canonical.entries.map((entry) => entry.cue);
  return issues.length === 0
    ? { success: true, orderedCues, finalState: state }
    : { success: false, orderedCues, issues };
}

export const validateVisualPlaybackCues = validateVisualPlaybackSequence;

export function orderVisualPlaybackCues(
  assignment: VisualPlaybackAssignment,
  script: VisualPlaybackScript
): readonly VisualPlaybackCue[] {
  const result = validateVisualPlaybackSequence(assignment, script);
  if (!result.success) {
    throw new Error(
      result.issues[0]?.message ?? "invalid playback cue sequence"
    );
  }
  return result.orderedCues;
}

/**
 * Resolve the state at a line edge. A cue at the requested edge is applied
 * before the state is returned. The assignment is visible from start BEFORE
 * until end AFTER, including paused intervals; end AFTER applies the final
 * cue and then the implicit hide/end boundary.
 */
export function resolveVisualPlaybackState(input: {
  assignment: VisualPlaybackAssignment;
  script: VisualPlaybackScript;
  boundary: VisualPlaybackBoundary;
}): VisualPlaybackResolution {
  const validation = validateVisualPlaybackSequence(
    input.assignment,
    input.script
  );
  if (!validation.success) {
    return {
      visible: false,
      playbackState: "hidden",
      orderedCues: validation.orderedCues,
      issues: validation.issues
    };
  }

  const positions = buildLinePositions(input.script);
  const start = boundaryPosition(
    input.assignment.startLineId,
    "before",
    positions
  );
  const end = boundaryPosition(input.assignment.endLineId, "after", positions);
  const boundary = boundaryPosition(
    input.boundary.lineId,
    input.boundary.edge,
    positions
  );

  if (
    start === undefined ||
    end === undefined ||
    boundary === undefined ||
    boundary < start ||
    boundary >= end
  ) {
    return {
      visible: false,
      playbackState: "hidden",
      orderedCues: validation.orderedCues
    };
  }

  let state: Exclude<VisualPlaybackState, "hidden"> = "playing";
  const entries = canonicalCueEntries(
    input.assignment.display.playbackCues ?? [],
    positions
  ).entries;
  for (const entry of entries) {
    if (entry.position > boundary) {
      break;
    }
    state = transitionState(state, entry.cue.action);
  }

  return {
    visible: true,
    playbackState: state,
    orderedCues: validation.orderedCues
  };
}
