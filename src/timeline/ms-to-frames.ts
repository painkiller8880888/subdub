/**
 * Convert milliseconds to frames using the timeline specification's rounding
 * rule. Inputs are expected to be non-negative milliseconds and a positive
 * frame rate.
 */
export function msToFrames(ms: number, fps: number): number {
  return Math.ceil((ms / 1000) * fps);
}
