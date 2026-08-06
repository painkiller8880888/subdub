import { z } from "zod";

import {
  finiteNumberSchema,
  idSchema,
  isoUtcDateTimeSchema,
  strictObject
} from "./primitives.js";

export const assetKindSchema = z.enum([
  "video",
  "photo",
  "document_scan",
  "sound_effect"
]);

export const assetStatusSchema = z.enum([
  "processing",
  "active",
  "inactive",
  "error"
]);

export const assetTagStatusSchema = z.enum(["active", "inactive"]);

export const assetTagAxisSchema = z.enum([
  "department",
  "system",
  "task",
  "action",
  "object",
  "location",
  "documentType",
  "status"
]);

export const assetTagSchema = strictObject({
  tagId: idSchema,
  axis: assetTagAxisSchema,
  canonicalName: z.string().min(1),
  normalizedName: z.string().min(1),
  status: assetTagStatusSchema,
  createdAt: isoUtcDateTimeSchema,
  updatedAt: isoUtcDateTimeSchema
});

export const assetTagAliasSchema = strictObject({
  aliasId: idSchema,
  tagId: idSchema,
  alias: z.string().min(1),
  normalizedAlias: z.string().min(1),
  createdAt: isoUtcDateTimeSchema
});

export const assetUploadReceiptSchema = strictObject({
  assetId: idSchema,
  version: finiteNumberSchema.int().positive(),
  kind: assetKindSchema,
  title: z.string().min(1),
  description: z.string(),
  mimeType: z.string().min(1),
  confidentiality: z.string().min(1),
  department: z.string().min(1).nullable(),
  system: z.string().min(1).nullable(),
  tagIds: z.array(idSchema),
  status: z.literal("processing"),
  createdAt: isoUtcDateTimeSchema,
  updatedAt: isoUtcDateTimeSchema
});

export function normalizeAssetTextField(value: string): string {
  return value.normalize("NFC").trim();
}

export function normalizeAssetOptionalField(value: string): string | undefined {
  const normalized = value.normalize("NFC").trim();
  return normalized.length === 0 ? undefined : normalized;
}

export type AssetKind = z.infer<typeof assetKindSchema>;
export type AssetStatus = z.infer<typeof assetStatusSchema>;
export type AssetTagStatus = z.infer<typeof assetTagStatusSchema>;
export type AssetTagAxis = z.infer<typeof assetTagAxisSchema>;
export type AssetTag = z.infer<typeof assetTagSchema>;
export type AssetTagAlias = z.infer<typeof assetTagAliasSchema>;
export type AssetUploadReceipt = z.infer<typeof assetUploadReceiptSchema>;
