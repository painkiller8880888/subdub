import { z } from "zod";

import { idSchema, strictObject } from "./primitives.js";

export const visualPlaybackCueEdgeSchema = z.enum(["before", "after"]);
export const visualPlaybackCueActionSchema = z.enum(["pause", "resume"]);

export const visualPlaybackCueSchema = strictObject({
  lineId: idSchema,
  edge: visualPlaybackCueEdgeSchema,
  action: visualPlaybackCueActionSchema
});

export type VisualPlaybackCueEdge = z.infer<typeof visualPlaybackCueEdgeSchema>;
export type VisualPlaybackCueAction = z.infer<
  typeof visualPlaybackCueActionSchema
>;
export type VisualPlaybackCue = z.infer<typeof visualPlaybackCueSchema>;
