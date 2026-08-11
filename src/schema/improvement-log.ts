import { z } from "zod";

import {
  characterSchema,
  outlineSchema,
  scriptSchema
} from "./video-project.js";
import { visualSuggestionCandidateSchema } from "./visual-search-intent.js";
import {
  idSchema,
  isoUtcDateTimeSchema,
  nonNegativeIntegerSchema,
  sha256Schema,
  strictObject
} from "./primitives.js";

export const improvementTaskKindSchema = z.enum([
  "outline_generation",
  "visual_search_intent"
]);

export const improvementTargetKindSchema = z.enum([
  "outline",
  "visual_line_range"
]);

export const improvementDecisionSchema = z.enum(["accepted", "rejected"]);

export const goldenExampleKindSchema = z.enum([
  "approved_outline",
  "approved_script_bundle"
]);

export const improvementReasonSchema = z.string().max(2000);

export const approvedScriptBundleSchema = strictObject({
  outline: outlineSchema,
  script: scriptSchema,
  characters: z.array(characterSchema).length(2)
});

export const improvementCandidatePayloadSchema = z.union([
  outlineSchema,
  visualSuggestionCandidateSchema
]);

export const aiGenerationCandidateRecordSchema = strictObject({
  candidateId: idSchema,
  generationRunId: idSchema,
  projectId: idSchema,
  projectRevision: nonNegativeIntegerSchema,
  taskKind: improvementTaskKindSchema,
  targetKind: improvementTargetKindSchema,
  targetId: z.string().min(1).max(512),
  candidateKey: z.string().min(1).max(512),
  candidateJson: z.unknown(),
  candidateChecksum: sha256Schema,
  modelId: z.string().min(1),
  responseModel: z.string().min(1).nullable(),
  promptVersion: z.string().min(1).max(100),
  createdAt: isoUtcDateTimeSchema
});

export const improvementDecisionRecordSchema = strictObject({
  decisionId: idSchema,
  candidateId: idSchema,
  projectId: idSchema,
  projectRevisionBefore: nonNegativeIntegerSchema,
  projectRevisionAfter: nonNegativeIntegerSchema,
  taskKind: improvementTaskKindSchema,
  targetKind: improvementTargetKindSchema,
  targetId: z.string().min(1).max(512),
  decision: improvementDecisionSchema,
  beforeJson: z.unknown(),
  afterJson: z.unknown().nullable(),
  reason: improvementReasonSchema.nullable(),
  modelId: z.string().min(1),
  promptVersion: z.string().min(1).max(100),
  createdAt: isoUtcDateTimeSchema
});

export const goldenExampleRecordSchema = strictObject({
  exampleId: idSchema,
  exampleKind: goldenExampleKindSchema,
  projectId: idSchema,
  projectRevision: nonNegativeIntegerSchema,
  targetId: idSchema,
  sourceHash: sha256Schema,
  outlineHash: sha256Schema.nullable(),
  payloadJson: z.unknown(),
  payloadChecksum: sha256Schema,
  generationRunId: idSchema.nullable(),
  modelId: z.string().min(1).nullable(),
  promptVersion: z.string().min(1).max(100).nullable(),
  createdAt: isoUtcDateTimeSchema
});

export const improvementDecisionSummarySchema = strictObject({
  decisionId: idSchema,
  candidateId: idSchema,
  decision: improvementDecisionSchema,
  createdAt: isoUtcDateTimeSchema
});

export type ImprovementTaskKind = z.infer<typeof improvementTaskKindSchema>;
export type ImprovementTargetKind = z.infer<typeof improvementTargetKindSchema>;
export type ImprovementDecision = z.infer<typeof improvementDecisionSchema>;
export type GoldenExampleKind = z.infer<typeof goldenExampleKindSchema>;
export type ApprovedScriptBundle = z.infer<typeof approvedScriptBundleSchema>;
export type ImprovementCandidatePayload = z.infer<
  typeof improvementCandidatePayloadSchema
>;
export type AiGenerationCandidateRecord = z.infer<
  typeof aiGenerationCandidateRecordSchema
>;
export type ImprovementDecisionRecord = z.infer<
  typeof improvementDecisionRecordSchema
>;
export type GoldenExampleRecord = z.infer<typeof goldenExampleRecordSchema>;
export type ImprovementDecisionSummary = z.infer<
  typeof improvementDecisionSummarySchema
>;

export function normalizeImprovementReason(
  value: string | null | undefined
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
