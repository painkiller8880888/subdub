import { z } from "zod";

import {
  finiteNumberSchema,
  idSchema,
  positiveNumberSchema,
  strictObject
} from "./primitives.js";

export const LINE_OVERLAY_CANVAS_WIDTH = 1920 as const;
export const LINE_OVERLAY_CANVAS_HEIGHT = 1080 as const;

export const lineOverlayKindSchema = z.enum([
  "circle",
  "box",
  "arrow",
  "label"
]);

export const lineOverlayColorTokenSchema = z.enum([
  "accent",
  "caution",
  "warning"
]);

export const lineOverlayAnimationSchema = z.enum(["none", "blink", "pulse"]);

function rotatedBounds(transform: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
}): { minX: number; minY: number; maxX: number; maxY: number } {
  const centerX =
    (transform.x + transform.width / 2) * LINE_OVERLAY_CANVAS_WIDTH;
  const centerY =
    (transform.y + transform.height / 2) * LINE_OVERLAY_CANVAS_HEIGHT;
  const halfWidth = (transform.width * LINE_OVERLAY_CANVAS_WIDTH) / 2;
  const halfHeight = (transform.height * LINE_OVERLAY_CANVAS_HEIGHT) / 2;
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const boundsWidth = cosine * halfWidth + sine * halfHeight;
  const boundsHeight = sine * halfWidth + cosine * halfHeight;
  return {
    minX: centerX - boundsWidth,
    minY: centerY - boundsHeight,
    maxX: centerX + boundsWidth,
    maxY: centerY + boundsHeight
  };
}

export function lineOverlayTransformIntersectsCanvas(transform: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
}): boolean {
  if (
    !Number.isFinite(transform.x) ||
    !Number.isFinite(transform.y) ||
    !Number.isFinite(transform.width) ||
    !Number.isFinite(transform.height) ||
    !Number.isFinite(transform.rotationDeg) ||
    transform.width <= 0 ||
    transform.height <= 0
  ) {
    return false;
  }
  const bounds = rotatedBounds(transform);
  return (
    bounds.minX < LINE_OVERLAY_CANVAS_WIDTH &&
    bounds.maxX > 0 &&
    bounds.minY < LINE_OVERLAY_CANVAS_HEIGHT &&
    bounds.maxY > 0
  );
}

export const lineOverlayTransformSchema = strictObject({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: positiveNumberSchema,
  height: positiveNumberSchema,
  rotationDeg: finiteNumberSchema
}).superRefine((transform, ctx) => {
  if (!lineOverlayTransformIntersectsCanvas(transform)) {
    ctx.addIssue({
      code: "custom",
      message: "overlay must intersect the composition canvas"
    });
  }
});

const lineOverlayBaseFields = {
  id: idSchema,
  lineId: idSchema,
  transform: lineOverlayTransformSchema,
  colorToken: lineOverlayColorTokenSchema,
  animation: lineOverlayAnimationSchema
};

const lineOverlayShapeSchema = z.discriminatedUnion("kind", [
  strictObject({
    ...lineOverlayBaseFields,
    kind: z.literal("circle"),
    text: z.null()
  }),
  strictObject({
    ...lineOverlayBaseFields,
    kind: z.literal("box"),
    text: z.null()
  }),
  strictObject({
    ...lineOverlayBaseFields,
    kind: z.literal("arrow"),
    text: z.null()
  }),
  strictObject({
    ...lineOverlayBaseFields,
    kind: z.literal("label"),
    text: z.string().refine((value) => value.trim().length > 0, {
      message: "label overlay text must not be blank"
    })
  })
]);

export const lineOverlaySchema = lineOverlayShapeSchema;

export const lineOverlayPlanSchema = strictObject({
  lineOverlays: z.array(lineOverlaySchema)
});

export type LineOverlayKind = z.infer<typeof lineOverlayKindSchema>;
export type LineOverlayColorToken = z.infer<typeof lineOverlayColorTokenSchema>;
export type LineOverlayAnimation = z.infer<typeof lineOverlayAnimationSchema>;
export type LineOverlayTransform = z.infer<typeof lineOverlayTransformSchema>;
export type LineOverlay = z.infer<typeof lineOverlaySchema>;
export type LineOverlayPlan = z.infer<typeof lineOverlayPlanSchema>;
