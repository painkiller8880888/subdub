/**
 * Convert a manifest media time to the source frame used by Remotion.
 *
 * Manifest video ranges are persisted in milliseconds, but video trimming is
 * ultimately frame based. This preserves the existing Remotion trim rule for
 * arbitrary millisecond values.
 */
export function mediaMillisecondsToFrames(
  milliseconds: number,
  fps: number
): number {
  return Math.ceil((milliseconds / 1000) * fps);
}

/**
 * Convert a source media frame to milliseconds that the existing ceil-based
 * Remotion trim conversion maps back to that same frame.
 */
export function mediaFramesToMilliseconds(frames: number, fps: number): number {
  return Math.floor((frames * 1000) / fps);
}

/** Resolve an inserted video's presentation duration from its source range. */
export function effectiveMediaDurationMs(
  sourceDurationMs: number,
  startMs: number | null,
  playbackRate: number
): number {
  return (sourceDurationMs - (startMs ?? 0)) / playbackRate;
}

/** Resolve an inserted video's presentation duration using the timeline ceil rule. */
export function effectiveMediaDurationInFrames(
  sourceDurationMs: number,
  startMs: number | null,
  playbackRate: number,
  fps: number
): number {
  return Math.ceil(
    (effectiveMediaDurationMs(sourceDurationMs, startMs, playbackRate) / 1000) *
      fps
  );
}

/** Preserve the fractional source position used by Remotion playback. */
export function presentationFramesToMediaPosition(
  presentationFrames: number,
  playbackRate: number
): number {
  return presentationFrames * playbackRate;
}
