import { z } from "zod";

import {
  finiteNumberSchema,
  idSchema,
  positiveIntegerSchema,
  positiveNumberSchema,
  positiveUnitIntervalSchema,
  relativePosixPathSchema,
  strictObject,
  unitIntervalSchema
} from "./primitives.js";
import {
  visualPlaybackCueSchema,
  type VisualPlaybackCue
} from "./visual-playback.js";

export const approvalStatusSchema = z.enum([
  "draft",
  "needs_review",
  "approved"
]);

export const sectionRoleSchema = z.enum(["intro", "main", "outro"]);

export const expressionSchema = z.enum([
  "neutral",
  "smile",
  "explain",
  "caution"
]);

export const fitSchema = z.enum(["contain", "cover"]);

export const visualAssetKindSchema = z.enum([
  "video",
  "photo",
  "document_scan"
]);

export const backgroundDefinitionSchema = z.discriminatedUnion("kind", [
  strictObject({
    kind: z.literal("solid"),
    colorToken: z.literal("background")
  }),
  strictObject({
    kind: z.literal("image"),
    src: relativePosixPathSchema,
    fit: fitSchema
  })
]);

export const cropSchema = strictObject({
  x: unitIntervalSchema,
  y: unitIntervalSchema,
  width: positiveUnitIntervalSchema,
  height: positiveUnitIntervalSchema
}).superRefine((crop, ctx) => {
  if (crop.x + crop.width > 1) {
    ctx.addIssue({
      code: "custom",
      path: ["width"],
      message: "crop must fit within the horizontal bounds"
    });
  }

  if (crop.y + crop.height > 1) {
    ctx.addIssue({
      code: "custom",
      path: ["height"],
      message: "crop must fit within the vertical bounds"
    });
  }
});

export const positionSchema = strictObject({
  x: unitIntervalSchema,
  y: unitIntervalSchema
});

export const staticAnnotationSchema = strictObject({
  id: idSchema,
  kind: z.enum(["label", "box", "arrow"]),
  text: z.string().nullable(),
  x: unitIntervalSchema,
  y: unitIntervalSchema,
  width: unitIntervalSchema.nullable(),
  height: unitIntervalSchema.nullable(),
  colorToken: z.enum(["accent", "caution", "warning"])
}).superRefine((annotation, ctx) => {
  if (annotation.width !== null && annotation.x + annotation.width > 1) {
    ctx.addIssue({
      code: "custom",
      path: ["width"],
      message: "annotation must fit within the horizontal bounds"
    });
  }

  if (annotation.height !== null && annotation.y + annotation.height > 1) {
    ctx.addIssue({
      code: "custom",
      path: ["height"],
      message: "annotation must fit within the vertical bounds"
    });
  }
});

export const commonDisplaySchema = strictObject({
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema)
});

const videoDisplayFields = {
  kind: z.literal("video"),
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema),
  startMs: z.number().finite().int().nonnegative(),
  endMs: z.number().finite().int().nonnegative(),
  playbackRate: positiveNumberSchema
};

function validateVideoDisplayRange(
  display: { startMs: number; endMs: number },
  ctx: z.RefinementCtx
): void {
  if (display.endMs <= display.startMs) {
    ctx.addIssue({
      code: "custom",
      path: ["endMs"],
      message: "endMs must be greater than startMs"
    });
  }
}

/** The project-side video display used by VideoProject 1.2.0. */
export const videoDisplaySchema = strictObject({
  ...videoDisplayFields,
  volume: unitIntervalSchema
}).superRefine(validateVideoDisplayRange);

/** Legacy VideoProject 1.0.0/1.1.0 input boundary. */
export const legacyVideoDisplaySchema = strictObject({
  ...videoDisplayFields,
  muted: z.boolean()
}).superRefine(validateVideoDisplayRange);

export const imageDisplaySchema = strictObject({
  kind: z.literal("photo"),
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema)
});

export const documentDisplaySchema = strictObject({
  kind: z.literal("document_scan"),
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema),
  page: positiveIntegerSchema
});

export const displaySchema = z.discriminatedUnion("kind", [
  videoDisplaySchema,
  imageDisplaySchema,
  documentDisplaySchema
]);

export const displayCoordinateSpaceSchema = z.enum([
  "legacy-media-frame",
  "content-slot-relative"
]);

export const videoDisplayV13Schema = strictObject({
  ...videoDisplayFields,
  volume: unitIntervalSchema,
  displayCoordinateSpace: displayCoordinateSpaceSchema
}).superRefine(validateVideoDisplayRange);

const imageDisplayV13Schema = strictObject({
  kind: z.literal("photo"),
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema),
  displayCoordinateSpace: displayCoordinateSpaceSchema
});

const documentDisplayV13Schema = strictObject({
  kind: z.literal("document_scan"),
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema),
  page: positiveIntegerSchema,
  displayCoordinateSpace: displayCoordinateSpaceSchema
});

export const displayV13Schema = z.discriminatedUnion("kind", [
  videoDisplayV13Schema,
  imageDisplayV13Schema,
  documentDisplayV13Schema
]);

function validatePlaybackCues(
  display: { playbackCues: readonly VisualPlaybackCue[] },
  ctx: z.RefinementCtx
): void {
  const exactCues = new Set<string>();
  const boundaryCues = new Set<string>();

  for (const [index, cue] of display.playbackCues.entries()) {
    const exactKey = `${cue.lineId}:${cue.edge}:${cue.action}`;
    if (exactCues.has(exactKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["playbackCues", index],
        message: "playback cue must be unique"
      });
      continue;
    }
    exactCues.add(exactKey);

    const boundaryKey = `${cue.lineId}:${cue.edge}`;
    if (boundaryCues.has(boundaryKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["playbackCues", index],
        message: "playback cue boundary must be unambiguous"
      });
    } else {
      boundaryCues.add(boundaryKey);
    }
  }
}

/** The project-side video display used by VideoProject 1.4.0. */
export const videoDisplayV14Schema = videoDisplayV13Schema;
export const displayV14Schema = displayV13Schema;

const videoDisplayV15Fields = {
  ...videoDisplayFields,
  volume: unitIntervalSchema,
  displayCoordinateSpace: displayCoordinateSpaceSchema,
  playbackCues: z.array(visualPlaybackCueSchema)
};

/** The current project-side video display used by VideoProject 1.5.0. */
export const videoDisplayV15Schema = strictObject(
  videoDisplayV15Fields
).superRefine((display, ctx) => {
  validateVideoDisplayRange(display, ctx);
  validatePlaybackCues(display, ctx);
});

export const displayV15Schema = z.discriminatedUnion("kind", [
  videoDisplayV15Schema,
  imageDisplayV13Schema,
  documentDisplayV13Schema
]);

const imageDisplayInputSchema = strictObject({
  kind: z.literal("photo"),
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema),
  displayCoordinateSpace: displayCoordinateSpaceSchema.optional()
});

const documentDisplayInputSchema = strictObject({
  kind: z.literal("document_scan"),
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema),
  page: positiveIntegerSchema,
  displayCoordinateSpace: displayCoordinateSpaceSchema.optional()
});

const videoDisplayV15InputSchema = strictObject({
  ...videoDisplayFields,
  volume: unitIntervalSchema,
  displayCoordinateSpace: displayCoordinateSpaceSchema.optional(),
  playbackCues: z.array(visualPlaybackCueSchema).optional().default([])
}).superRefine((display, ctx) => {
  validateVideoDisplayRange(display, ctx);
  validatePlaybackCues(display, ctx);
});

/** API input compatibility: new assignments default the coordinate space and cue list. */
export const displayV15InputSchema = z.discriminatedUnion("kind", [
  videoDisplayV15InputSchema,
  imageDisplayInputSchema,
  documentDisplayInputSchema
]);

export const displayInputSchema = displayV15InputSchema;

export const legacyDisplaySchema = z.discriminatedUnion("kind", [
  legacyVideoDisplaySchema,
  imageDisplaySchema,
  documentDisplaySchema
]);

export const voiceSchema = strictObject({
  speedScale: finiteNumberSchema,
  pitchScale: finiteNumberSchema,
  intonationScale: finiteNumberSchema,
  volumeScale: finiteNumberSchema,
  prePhonemeLength: finiteNumberSchema,
  postPhonemeLength: finiteNumberSchema
});

export const voiceOverridesSchema = voiceSchema.partial().strict();

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type SectionRole = z.infer<typeof sectionRoleSchema>;
export type Expression = z.infer<typeof expressionSchema>;
export type BackgroundDefinition = z.infer<typeof backgroundDefinitionSchema>;
export type Crop = z.infer<typeof cropSchema>;
export type Position = z.infer<typeof positionSchema>;
export type StaticAnnotation = z.infer<typeof staticAnnotationSchema>;
export type CommonDisplay = z.infer<typeof commonDisplaySchema>;
export type VideoDisplay = z.infer<typeof videoDisplaySchema>;
export type LegacyVideoDisplay = z.infer<typeof legacyVideoDisplaySchema>;
export type VideoDisplayV13 = z.infer<typeof videoDisplayV13Schema>;
export type VideoDisplayV14 = z.infer<typeof videoDisplayV14Schema>;
export type VideoDisplayV15 = z.infer<typeof videoDisplayV15Schema>;
export type ImageDisplay = z.infer<typeof imageDisplaySchema>;
export type DocumentDisplay = z.infer<typeof documentDisplaySchema>;
export type Display = z.infer<typeof displaySchema>;
export type LegacyDisplay = z.infer<typeof legacyDisplaySchema>;
export type DisplayCoordinateSpace = z.infer<
  typeof displayCoordinateSpaceSchema
>;
export type DisplayV13 = z.infer<typeof displayV13Schema>;
export type DisplayV14 = z.infer<typeof displayV14Schema>;
export type DisplayV15 = z.infer<typeof displayV15Schema>;
export type DisplayV15Input = z.infer<typeof displayV15InputSchema>;
export type DisplayInput = z.infer<typeof displayInputSchema>;
export type Voice = z.infer<typeof voiceSchema>;
