import { z } from "zod";

import { assetListItemSchema } from "./asset.js";
import { visualAssetKindSchema } from "./common.js";
import {
  idSchema,
  nonNegativeIntegerSchema,
  strictObject
} from "./primitives.js";

export const visualSearchIntentSchema = strictObject({
  requiredTags: z.array(z.string().trim().min(1)).max(32),
  optionalTags: z.array(z.string().trim().min(1)).max(32),
  excludedTags: z.array(z.string().trim().min(1)).max(32),
  mediaKinds: z.array(visualAssetKindSchema).min(1).max(3),
  freeTextQuery: z.string().max(500),
  reason: z.string().trim().min(1).max(2000)
});

export const visualSearchIntentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "requiredTags",
    "optionalTags",
    "excludedTags",
    "mediaKinds",
    "freeTextQuery",
    "reason"
  ],
  properties: {
    requiredTags: {
      type: "array",
      maxItems: 32,
      items: { type: "string", minLength: 1 }
    },
    optionalTags: {
      type: "array",
      maxItems: 32,
      items: { type: "string", minLength: 1 }
    },
    excludedTags: {
      type: "array",
      maxItems: 32,
      items: { type: "string", minLength: 1 }
    },
    mediaKinds: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "string",
        enum: ["video", "photo", "document_scan"]
      }
    },
    freeTextQuery: { type: "string", maxLength: 500 },
    reason: { type: "string", minLength: 1, maxLength: 2000 }
  }
} as const;

export const visualSuggestionRequestSchema = strictObject({
  startLineId: idSchema,
  endLineId: idSchema,
  expectedRevision: nonNegativeIntegerSchema,
  modelId: z.string().min(1).optional()
});

const resolvedTagSchema = strictObject({
  tagId: idSchema,
  axis: z.string().min(1),
  canonicalName: z.string().min(1)
});

export const visualSuggestionCandidateSchema = strictObject({
  asset: assetListItemSchema,
  matchedRequiredTags: z.array(resolvedTagSchema),
  matchedOptionalTags: z.array(resolvedTagSchema),
  matchReasons: z.array(z.string().min(1))
});

export const visualSuggestionResultSchema = strictObject({
  runId: idSchema,
  target: strictObject({
    startLineId: idSchema,
    endLineId: idSchema,
    sectionId: idSchema,
    lineIds: z.array(idSchema).min(1)
  }),
  aiIntent: visualSearchIntentSchema,
  resolvedSearch: strictObject({
    requiredTags: z.array(resolvedTagSchema),
    optionalTags: z.array(resolvedTagSchema),
    excludedTags: z.array(resolvedTagSchema),
    mediaKinds: z.array(visualAssetKindSchema).min(1),
    freeTextQuery: z.string()
  }),
  diagnostics: strictObject({
    unresolvedTags: z.array(
      strictObject({
        group: z.enum(["requiredTags", "optionalTags", "excludedTags"]),
        value: z.string().min(1),
        reason: z.enum(["unknown", "ambiguous"])
      })
    ),
    requiredTagResolutionFailed: z.boolean(),
    candidateCount: nonNegativeIntegerSchema
  }),
  candidates: z.array(visualSuggestionCandidateSchema)
});

export const visualSuggestionResponseSchema = strictObject({
  data: visualSuggestionResultSchema,
  revision: nonNegativeIntegerSchema
});

export type VisualAssetKind = z.infer<typeof visualAssetKindSchema>;
export type VisualSearchIntent = z.infer<typeof visualSearchIntentSchema>;
export type VisualSuggestionRequest = z.infer<
  typeof visualSuggestionRequestSchema
>;
export type VisualSuggestionCandidate = z.infer<
  typeof visualSuggestionCandidateSchema
>;
export type VisualSuggestionResult = z.infer<
  typeof visualSuggestionResultSchema
>;
export type VisualSuggestionResponse = z.infer<
  typeof visualSuggestionResponseSchema
>;
