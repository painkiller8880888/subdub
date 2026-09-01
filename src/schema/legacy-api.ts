import { z } from "zod";

import {
  nonNegativeIntegerSchema,
  sha256Schema,
  strictObject
} from "./primitives.js";
import { outlineSchema, projectBriefSchema } from "./video-project.js";
import { improvementReasonSchema } from "./improvement-log.js";

const optionalImprovementReasonSchema = improvementReasonSchema
  .nullable()
  .optional();

/**
 * Compatibility-only request and response schemas for the retired planning
 * workflow. Keep this module out of the current schema barrel so importing
 * current API contracts cannot accidentally reintroduce the old workflow.
 */
export const projectSourceContentSchema = strictObject({
  markdown: z.string(),
  sha256: sha256Schema
});

export const projectSourceReadResponseSchema = strictObject({
  data: projectSourceContentSchema,
  revision: nonNegativeIntegerSchema
});

export const projectSourceSaveRequestSchema = strictObject({
  markdown: z.string(),
  expectedRevision: nonNegativeIntegerSchema
});

export const projectBriefSaveRequestSchema = strictObject({
  brief: projectBriefSchema,
  expectedRevision: nonNegativeIntegerSchema
});

export const outlineGenerateRequestSchema = strictObject({
  expectedRevision: nonNegativeIntegerSchema,
  modelId: z.string().min(1).optional()
});

export const outlineSaveRequestSchema = strictObject({
  outline: outlineSchema,
  expectedRevision: nonNegativeIntegerSchema
});

export const outlineApproveRequestSchema = strictObject({
  expectedRevision: nonNegativeIntegerSchema,
  reason: optionalImprovementReasonSchema
});

export const outlineRejectRequestSchema = strictObject({
  expectedRevision: nonNegativeIntegerSchema,
  reason: optionalImprovementReasonSchema
});

export const outlineReviewRequestSchema = strictObject({
  expectedRevision: nonNegativeIntegerSchema
});

export const scriptInitializeRequestSchema = strictObject({
  expectedRevision: nonNegativeIntegerSchema
});

export const scriptApproveRequestSchema = strictObject({
  expectedRevision: nonNegativeIntegerSchema
});

export type ProjectSourceContent = z.infer<typeof projectSourceContentSchema>;
export type ProjectSourceReadResponse = z.infer<
  typeof projectSourceReadResponseSchema
>;
export type ProjectSourceSaveRequest = z.infer<
  typeof projectSourceSaveRequestSchema
>;
export type ProjectBriefSaveRequest = z.infer<
  typeof projectBriefSaveRequestSchema
>;
export type OutlineGenerateRequest = z.infer<
  typeof outlineGenerateRequestSchema
>;
export type OutlineSaveRequest = z.infer<typeof outlineSaveRequestSchema>;
export type OutlineApproveRequest = z.infer<typeof outlineApproveRequestSchema>;
export type OutlineRejectRequest = z.infer<typeof outlineRejectRequestSchema>;
export type OutlineReviewRequest = z.infer<typeof outlineReviewRequestSchema>;
export type ScriptInitializeRequest = z.infer<
  typeof scriptInitializeRequestSchema
>;
export type ScriptApproveRequest = z.infer<typeof scriptApproveRequestSchema>;
