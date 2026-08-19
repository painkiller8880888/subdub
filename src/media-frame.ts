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

/** Preserve the fractional source position used by Remotion playback. */
export function presentationFramesToMediaPosition(
  presentationFrames: number,
  playbackRate: number
): number {
  return presentationFrames * playbackRate;
}
