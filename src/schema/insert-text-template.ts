import { z } from "zod";

import {
  canvasContainedRectSchema,
  screenTemplateStatusSchema
} from "./screen-template.js";
import {
  finiteNumberSchema,
  hexColorSchema,
  idSchema,
  isoUtcDateTimeSchema,
  positiveIntegerSchema,
  positiveNumberSchema,
  strictObject
} from "./primitives.js";

export const INSERT_TEXT_TEMPLATE_CANVAS_WIDTH = 1920 as const;
export const INSERT_TEXT_TEMPLATE_CANVAS_HEIGHT = 1080 as const;

export const insertTextTemplateTextAlignSchema = z.enum([
  "left",
  "center",
  "right"
]);
export const insertTextTemplateVerticalAlignSchema = z.enum([
  "top",
  "center",
  "bottom"
]);

export const insertTextTemplateSchema = strictObject({
  templateId: idSchema,
  name: z.string().min(1),
  description: z.string(),
  status: screenTemplateStatusSchema,
  revision: positiveIntegerSchema,
  createdAt: isoUtcDateTimeSchema,
  updatedAt: isoUtcDateTimeSchema,
  canvasWidth: z.literal(INSERT_TEXT_TEMPLATE_CANVAS_WIDTH),
  canvasHeight: z.literal(INSERT_TEXT_TEMPLATE_CANVAS_HEIGHT),
  textRect: canvasContainedRectSchema,
  rotationDeg: finiteNumberSchema,
  fontSize: positiveNumberSchema,
  fontWeight: positiveIntegerSchema,
  textColor: hexColorSchema,
  textAlign: insertTextTemplateTextAlignSchema,
  verticalAlign: insertTextTemplateVerticalAlignSchema
});

export const insertTextTemplateCatalogSnapshotSchema = z.array(
  insertTextTemplateSchema
);

export type InsertTextTemplateStatus = z.infer<
  typeof screenTemplateStatusSchema
>;
export type InsertTextTemplateTextAlign = z.infer<
  typeof insertTextTemplateTextAlignSchema
>;
export type InsertTextTemplateVerticalAlign = z.infer<
  typeof insertTextTemplateVerticalAlignSchema
>;
export type InsertTextTemplate = z.infer<typeof insertTextTemplateSchema>;
export type InsertTextTemplateCatalogSnapshot = z.infer<
  typeof insertTextTemplateCatalogSnapshotSchema
>;
