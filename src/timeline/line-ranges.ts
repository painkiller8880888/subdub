import type { VoicevoxAudioIndexEntry } from "../app/voicevox/audio-index.js";
import type { ScriptLine, ScriptSection } from "../schema/index.js";
import { createFrameRange } from "./frame-range.js";
import { msToFrames } from "./ms-to-frames.js";
import type { FrameRange } from "./frame-range.js";

export type TimelineLineInput = Readonly<
  Pick<ScriptLine, "id" | "pauseBeforeMs" | "pauseAfterMs">
> & {
  readonly sectionId: ScriptSection["id"];
  readonly durationMs: VoicevoxAudioIndexEntry["durationMs"];
};

export type TimelineLineRange = FrameRange & {
  readonly id: ScriptLine["id"];
  readonly sectionId: ScriptSection["id"];
  /** The speech start relative to this line, not the whole timeline. */
  readonly speechFrom: number;
  readonly speechDurationInFrames: number;
};

export function calculateLineRanges(
  lines: readonly TimelineLineInput[],
  fps: number
): TimelineLineRange[] {
  let nextFrom = 0;

  return lines.map((line) => {
    const pauseBeforeInFrames = msToFrames(line.pauseBeforeMs, fps);
    const speechDurationInFrames = msToFrames(line.durationMs, fps);
    const pauseAfterInFrames = msToFrames(line.pauseAfterMs, fps);
    const durationInFrames =
      pauseBeforeInFrames + speechDurationInFrames + pauseAfterInFrames;
    const range = createFrameRange(nextFrom, nextFrom + durationInFrames);

    nextFrom = range.from + range.durationInFrames;

    return {
      id: line.id,
      sectionId: line.sectionId,
      ...range,
      speechFrom: pauseBeforeInFrames,
      speechDurationInFrames
    };
  });
}
