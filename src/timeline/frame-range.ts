export type FrameRange = Readonly<{
  from: number;
  durationInFrames: number;
}>;

export function createFrameRange(
  from: number,
  endExclusive: number
): FrameRange {
  return {
    from,
    durationInFrames: endExclusive - from
  };
}

/** Return the exclusive end of a half-open frame range. */
export function getEndExclusive(range: FrameRange): number {
  return range.from + range.durationInFrames;
}

export function containsFrame(range: FrameRange, frame: number): boolean {
  return range.from <= frame && frame < getEndExclusive(range);
}

export function rangesOverlap(left: FrameRange, right: FrameRange): boolean {
  if (left.durationInFrames <= 0 || right.durationInFrames <= 0) {
    return false;
  }

  return (
    left.from < getEndExclusive(right) && right.from < getEndExclusive(left)
  );
}
