/**
 * Convert a manifest media time to the source frame used by Remotion.
 *
 * Manifest video ranges are persisted in milliseconds, but video trimming is
 * ultimately frame based. Keep this conversion in one place so the compiler
 * and renderer agree on the frame at every segment boundary.
 */
export function mediaMillisecondsToFrames(
  milliseconds: number,
  fps: number
): number {
  return Math.round((milliseconds / 1000) * fps);
}

/** Convert a source media frame back to the canonical manifest millisecond. */
export function mediaFramesToMilliseconds(frames: number, fps: number): number {
  return Math.round((frames * 1000) / fps);
}

/**
 * Resolve the source media frame at a presentation-frame offset.
 *
 * The compiler uses the same nearest-frame rule as the renderer's millisecond
 * conversion. This makes a playback-rate-adjusted segment boundary stable
 * after the manifest millisecond round trip.
 */
export function presentationFramesToMediaFrames(
  presentationFrames: number,
  playbackRate: number
): number {
  return Math.round(presentationFrames * playbackRate);
}
