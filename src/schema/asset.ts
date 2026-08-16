import { z } from "zod";

import {
  finiteNumberSchema,
  idSchema,
  isoUtcDateTimeSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
  relativePosixPathSchema,
  sha256Schema,
  strictObject
} from "./primitives.js";

export const assetKindSchema = z.enum([
  "video",
  "bgm",
  "photo",
  "document_scan",
  "sound_effect"
]);

export const assetFormatSchema = z.enum([
  "mp4",
  "mp3",
  "png",
  "jpeg",
  "pdf",
  "wav"
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

export const assetProcessingErrorCodeSchema = z.enum([
  "PROCESSING_MEDIA_NOT_FOUND",
  "PROCESSING_METADATA_FAILED",
  "PROCESSING_MEDIA_CORRUPTED",
  "PROCESSING_THUMBNAIL_FAILED",
  "PROCESSING_DATABASE_FAILED",
  "PROCESSING_INTERNAL_FAILED"
]);

export const assetDetailSchema = strictObject({
  assetId: idSchema,
  version: finiteNumberSchema.int().positive(),
  kind: assetKindSchema,
  title: z.string().min(1),
  description: z.string(),
  confidentiality: z.string().min(1),
  department: z.string().min(1).nullable(),
  system: z.string().min(1).nullable(),
  mimeType: z.string().min(1),
  libraryMediaPath: relativePosixPathSchema,
  checksum: sha256Schema.nullable(),
  sizeBytes: nonNegativeIntegerSchema.nullable(),
  width: nonNegativeIntegerSchema.nullable(),
  height: nonNegativeIntegerSchema.nullable(),
  durationMs: nonNegativeIntegerSchema.nullable(),
  pageCount: nonNegativeIntegerSchema.nullable(),
  thumbnailPaths: z.array(relativePosixPathSchema),
  status: assetStatusSchema,
  errorCode: assetProcessingErrorCodeSchema.nullable(),
  errorMessage: z.string().nullable(),
  createdAt: isoUtcDateTimeSchema,
  updatedAt: isoUtcDateTimeSchema
});

export const assetListTagSchema = strictObject({
  tagId: idSchema,
  axis: assetTagAxisSchema,
  canonicalName: z.string().min(1)
});

export const assetListItemSchema = strictObject({
  assetId: idSchema,
  version: positiveIntegerSchema.nullable(),
  kind: assetKindSchema,
  title: z.string().min(1),
  description: z.string(),
  confidentiality: z.string().min(1),
  department: z.string().min(1).nullable(),
  system: z.string().min(1).nullable(),
  mimeType: z.string().min(1).nullable(),
  checksum: sha256Schema.nullable(),
  sizeBytes: nonNegativeIntegerSchema.nullable(),
  width: nonNegativeIntegerSchema.nullable(),
  height: nonNegativeIntegerSchema.nullable(),
  durationMs: nonNegativeIntegerSchema.nullable(),
  pageCount: nonNegativeIntegerSchema.nullable(),
  thumbnailPaths: z.array(relativePosixPathSchema),
  tags: z.array(assetListTagSchema),
  tagIds: z.array(idSchema),
  status: assetStatusSchema,
  errorCode: assetProcessingErrorCodeSchema.nullable(),
  errorMessage: z.string().nullable(),
  createdAt: isoUtcDateTimeSchema,
  updatedAt: isoUtcDateTimeSchema
});

export const assetListResultSchema = strictObject({
  items: z.array(assetListItemSchema),
  page: positiveIntegerSchema,
  pageSize: positiveIntegerSchema,
  total: nonNegativeIntegerSchema,
  hasNextPage: z.boolean()
});

export function normalizeAssetTextField(value: string): string {
  return value.normalize("NFC").trim();
}

export function normalizeAssetOptionalField(value: string): string | undefined {
  const normalized = value.normalize("NFC").trim();
  return normalized.length === 0 ? undefined : normalized;
}

export function normalizeAssetSearchQuery(value: string): string | undefined {
  const tokens = value.normalize("NFC").match(/[\p{L}\p{N}]+/gu);
  return tokens === null ? undefined : tokens.join(" ");
}

export type AssetKind = z.infer<typeof assetKindSchema>;
export type AssetFormat = z.infer<typeof assetFormatSchema>;
export type AssetStatus = z.infer<typeof assetStatusSchema>;
export type AssetTagStatus = z.infer<typeof assetTagStatusSchema>;
export type AssetTagAxis = z.infer<typeof assetTagAxisSchema>;
export type AssetTag = z.infer<typeof assetTagSchema>;
export type AssetTagAlias = z.infer<typeof assetTagAliasSchema>;
export type AssetUploadReceipt = z.infer<typeof assetUploadReceiptSchema>;
export type AssetProcessingErrorCode = z.infer<
  typeof assetProcessingErrorCodeSchema
>;
export type AssetDetail = z.infer<typeof assetDetailSchema>;
export type AssetListTag = z.infer<typeof assetListTagSchema>;
export type AssetListItem = z.infer<typeof assetListItemSchema>;
export type AssetListResult = z.infer<typeof assetListResultSchema>;
