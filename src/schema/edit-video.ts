import { z } from "zod";

export const EDIT_VIDEO_PLAYBACK_RATE_OPTIONS = [
  { value: 1 / 3, label: "x1/3" },
  { value: 1 / 2.5, label: "x1/2.5" },
  { value: 1 / 2, label: "x1/2" },
  { value: 1 / 1.5, label: "x1/1.5" },
  { value: 1, label: "x1.0" },
  { value: 1.5, label: "x1.5" },
  { value: 2, label: "x2.0" },
  { value: 2.5, label: "x2.5" },
  { value: 3, label: "x3.0" }
] as const;

export type EditVideoPlaybackRate =
  (typeof EDIT_VIDEO_PLAYBACK_RATE_OPTIONS)[number]["value"];

const editVideoPlaybackRateValues = EDIT_VIDEO_PLAYBACK_RATE_OPTIONS.map(
  ({ value }) => value
);

export const editVideoPlaybackRateSchema = z
  .number()
  .finite()
  .refine(
    (value): value is EditVideoPlaybackRate =>
      editVideoPlaybackRateValues.includes(value as EditVideoPlaybackRate),
    "playbackRate must be one of the supported edit video playback rates"
  );

export const DEFAULT_EDIT_VIDEO_PLAYBACK_RATE = 1 as const;
export const DEFAULT_EDIT_VIDEO_VOLUME = 1 as const;
