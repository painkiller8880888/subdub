import { z } from "zod";

import {
  finiteNumberSchema,
  idSchema,
  isoUtcDateTimeSchema,
  positiveIntegerSchema,
  positiveNumberSchema,
  strictObject
} from "./primitives.js";

export const SCREEN_TEMPLATE_CANVAS_WIDTH = 1920 as const;
export const SCREEN_TEMPLATE_CANVAS_HEIGHT = 1080 as const;

export const screenTemplateStatusSchema = z.enum(["active", "inactive"]);

const screenRectSchema = strictObject({
  x: finiteNumberSchema.min(0).max(1),
  y: finiteNumberSchema.min(0).max(1),
  width: positiveNumberSchema.max(1),
  height: positiveNumberSchema.max(1)
}).superRefine((rect, ctx) => {
  if (rect.x + rect.width > 1) {
    ctx.addIssue({
      code: "custom",
      path: ["width"],
      message: "x + width must be at most 1"
    });
  }
  if (rect.y + rect.height > 1) {
    ctx.addIssue({
      code: "custom",
      path: ["height"],
      message: "y + height must be at most 1"
    });
  }
});

export const screenTransformSchema = strictObject({
  rect: screenRectSchema,
  rotationDeg: finiteNumberSchema
});

const screenTemplateElementBaseSchema = {
  elementId: idSchema,
  transform: screenTransformSchema
};

const dialogueWindowElementSchema = strictObject({
  ...screenTemplateElementBaseSchema,
  type: z.literal("dialogue-window"),
  fontSize: positiveNumberSchema
});

const sectionTitleElementSchema = strictObject({
  ...screenTemplateElementBaseSchema,
  type: z.literal("section-title"),
  fontSize: positiveNumberSchema
});

const characterVisualElementSchema = strictObject({
  ...screenTemplateElementBaseSchema,
  type: z.literal("character-visual"),
  slot: z.enum(["speaker-1", "speaker-2"]),
  flipX: z.boolean()
});

const contentSlotElementSchema = strictObject({
  ...screenTemplateElementBaseSchema,
  type: z.literal("content-slot"),
  slot: z.literal("primary")
});

export const screenTemplateElementSchema = z.discriminatedUnion("type", [
  dialogueWindowElementSchema,
  sectionTitleElementSchema,
  characterVisualElementSchema,
  contentSlotElementSchema
]);

export const screenTemplateSchema = strictObject({
  templateId: idSchema,
  name: z.string().min(1),
  description: z.string(),
  status: screenTemplateStatusSchema,
  canvasWidth: z.literal(SCREEN_TEMPLATE_CANVAS_WIDTH),
  canvasHeight: z.literal(SCREEN_TEMPLATE_CANVAS_HEIGHT),
  revision: positiveIntegerSchema,
  elements: z.array(screenTemplateElementSchema),
  createdAt: isoUtcDateTimeSchema,
  updatedAt: isoUtcDateTimeSchema
}).superRefine((template, ctx) => {
  const elementIds = new Set<string>();
  let dialogueWindowCount = 0;
  let sectionTitleCount = 0;
  let contentSlotCount = 0;
  const characterSlots = new Set<string>();

  for (const [index, element] of template.elements.entries()) {
    if (elementIds.has(element.elementId)) {
      ctx.addIssue({
        code: "custom",
        path: ["elements", index, "elementId"],
        message: "elementId must be unique within the template"
      });
    }
    elementIds.add(element.elementId);

    if (element.type === "dialogue-window") {
      dialogueWindowCount += 1;
    } else if (element.type === "section-title") {
      sectionTitleCount += 1;
    } else if (element.type === "content-slot") {
      contentSlotCount += 1;
    } else {
      if (characterSlots.has(element.slot)) {
        ctx.addIssue({
          code: "custom",
          path: ["elements", index, "slot"],
          message: "character visual speaker slots must be unique"
        });
      }
      characterSlots.add(element.slot);
    }
  }

  if (dialogueWindowCount !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["elements"],
      message: "template must contain exactly one dialogue-window"
    });
  }
  if (sectionTitleCount !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["elements"],
      message: "template must contain exactly one section-title"
    });
  }
  if (
    characterSlots.size !== 2 ||
    !characterSlots.has("speaker-1") ||
    !characterSlots.has("speaker-2")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["elements"],
      message: "template must contain speaker-1 and speaker-2 character visuals"
    });
  }
  if (contentSlotCount !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["elements"],
      message: "template must contain exactly one primary content-slot"
    });
  }
});

export const screenTemplateCatalogSnapshotSchema =
  z.array(screenTemplateSchema);

export type ScreenTemplateStatus = z.infer<typeof screenTemplateStatusSchema>;
export type ScreenRect = z.infer<typeof screenRectSchema>;
export type ScreenTransform = z.infer<typeof screenTransformSchema>;
export type ScreenTemplateElement = z.infer<typeof screenTemplateElementSchema>;
export type ScreenTemplate = z.infer<typeof screenTemplateSchema>;
export type ScreenTemplateCatalogSnapshot = z.infer<
  typeof screenTemplateCatalogSnapshotSchema
>;
