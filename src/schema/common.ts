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
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: finiteNumberSchema.nullable(),
  height: finiteNumberSchema.nullable(),
  colorToken: z.enum(["accent", "caution", "warning"])
});

export const commonDisplaySchema = strictObject({
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema)
});

export const videoDisplaySchema = strictObject({
  kind: z.literal("video"),
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema),
  startMs: z.number().finite().int().nonnegative(),
  endMs: z.number().finite().int().nonnegative(),
  playbackRate: positiveNumberSchema,
  muted: z.boolean()
}).superRefine((display, ctx) => {
  if (display.endMs <= display.startMs) {
    ctx.addIssue({
      code: "custom",
      path: ["endMs"],
      message: "endMs must be greater than startMs"
    });
  }
});

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
export type ImageDisplay = z.infer<typeof imageDisplaySchema>;
export type DocumentDisplay = z.infer<typeof documentDisplaySchema>;
export type Display = z.infer<typeof displaySchema>;
export type Voice = z.infer<typeof voiceSchema>;
