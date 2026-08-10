import { z } from "zod";

import {
  idSchema,
  isoUtcDateTimeSchema,
  nonNegativeIntegerSchema,
  sha256Schema,
  finiteNumberSchema,
  strictObject
} from "./primitives.js";
import {
  outlineSchema,
  projectBriefSchema,
  pronunciationSchema,
  scriptSchema,
  videoProjectSchema
} from "./video-project.js";
import { displaySchema } from "./common.js";
import {
  normalizeTerminologySearchValue,
  terminologyCategoryInputSchema,
  terminologyReadingInputSchema,
  terminologyStatusSchema,
  terminologySurfaceInputSchema,
  terminologyTermSchema
} from "./terminology.js";
import {
  assetDetailSchema,
  assetListResultSchema,
  assetKindSchema,
  assetStatusSchema,
  assetUploadReceiptSchema,
  normalizeAssetOptionalField,
  normalizeAssetSearchQuery,
  normalizeAssetTextField
} from "./asset.js";
import {
  visualSuggestionRequestSchema,
  visualSuggestionResponseSchema,
  type VisualSuggestionRequest,
  type VisualSuggestionResponse
} from "./visual-search-intent.js";

const apiErrorPathSegmentSchema = z.union([z.string(), z.number().int()]);

export const apiErrorDetailSchema = z
  .object({
    path: z.array(apiErrorPathSegmentSchema),
    message: z.string()
  })
  .strict();

export const apiSuccessResponseSchema = z
  .object({
    data: z.unknown(),
    revision: z.number().int().nonnegative().optional()
  })
  .strict();

export const apiErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    details: z.array(apiErrorDetailSchema),
    requestId: z.string().min(1)
  })
  .strict();

export const apiErrorResponseSchema = z
  .object({
    error: apiErrorSchema
  })
  .strict();

export const healthResponseSchema = z
  .object({
    data: z
      .object({
        status: z.string()
      })
      .strict(),
    revision: z.number().int().nonnegative().optional()
  })
  .strict();

export const projectCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1),
    department: z
      .string()
      .trim()
      .transform((value) => (value.length === 0 ? undefined : value))
      .optional(),
    manualVersion: z
      .string()
      .trim()
      .transform((value) => (value.length === 0 ? undefined : value))
      .optional()
  })
  .strict();

export const projectSummarySchema = z
  .object({
    id: idSchema,
    title: z.string(),
    department: z.string(),
    manualVersion: z.string(),
    revision: nonNegativeIntegerSchema,
    createdAt: isoUtcDateTimeSchema,
    updatedAt: isoUtcDateTimeSchema
  })
  .strict();

export const projectListResponseSchema = z
  .object({
    data: z.array(projectSummarySchema),
    revision: nonNegativeIntegerSchema.optional()
  })
  .strict();

export const projectCreateResponseSchema = z
  .object({
    data: videoProjectSchema,
    revision: z.literal(0)
  })
  .strict();

export const projectDetailResponseSchema = z
  .object({
    data: videoProjectSchema,
    revision: nonNegativeIntegerSchema.optional()
  })
  .strict();

export const projectSourceContentSchema = z
  .object({
    markdown: z.string(),
    sha256: sha256Schema
  })
  .strict();

export const projectSourceReadResponseSchema = z
  .object({
    data: projectSourceContentSchema,
    revision: nonNegativeIntegerSchema
  })
  .strict();

export const projectSourceSaveRequestSchema = z
  .object({
    markdown: z.string(),
    expectedRevision: nonNegativeIntegerSchema
  })
  .strict();

export const projectBriefSaveRequestSchema = z
  .object({
    brief: projectBriefSchema,
    expectedRevision: nonNegativeIntegerSchema
  })
  .strict();

export const projectMutationResponseSchema = z
  .object({
    data: videoProjectSchema,
    revision: nonNegativeIntegerSchema
  })
  .strict();

export const visualAssignmentInputSchema = strictObject({
  id: idSchema,
  startLineId: idSchema,
  endLineId: idSchema,
  assetId: idSchema,
  display: displaySchema
});

export const visualAssignmentCreateInputSchema = strictObject({
  id: idSchema,
  startLineId: idSchema,
  endLineId: idSchema,
  assetId: idSchema,
  display: displaySchema.optional()
});

export const visualAssignmentRequestSchema = strictObject({
  expectedRevision: nonNegativeIntegerSchema,
  assignment: visualAssignmentCreateInputSchema
});

export const visualAssignmentUpdateRequestSchema = strictObject({
  expectedRevision: nonNegativeIntegerSchema,
  assignment: visualAssignmentInputSchema
});

export const visualAssignmentDeleteRequestSchema = strictObject({
  expectedRevision: nonNegativeIntegerSchema
});

export const visualApprovalRequestSchema = strictObject({
  expectedRevision: nonNegativeIntegerSchema
});

export const visualAssignmentParamsSchema = strictObject({
  assignmentId: idSchema
});

export const visualAssignmentSaveRequestSchema = visualAssignmentRequestSchema;

export const visualAssignmentResponseSchema = projectMutationResponseSchema;

export const outlineGenerateRequestSchema = z
  .object({
    expectedRevision: nonNegativeIntegerSchema,
    modelId: z.string().min(1).optional()
  })
  .strict();

export const outlineSaveRequestSchema = z
  .object({
    outline: outlineSchema,
    expectedRevision: nonNegativeIntegerSchema
  })
  .strict();

export const outlineApproveRequestSchema = z
  .object({
    expectedRevision: nonNegativeIntegerSchema
  })
  .strict();

export const outlineReviewRequestSchema = z
  .object({
    expectedRevision: nonNegativeIntegerSchema
  })
  .strict();

export const scriptInitializeRequestSchema = z
  .object({
    expectedRevision: nonNegativeIntegerSchema
  })
  .strict();

export const scriptApproveRequestSchema = z
  .object({
    expectedRevision: nonNegativeIntegerSchema
  })
  .strict();

export const scriptSaveRequestSchema = z
  .object({
    script: scriptSchema,
    expectedRevision: nonNegativeIntegerSchema
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.script.status === "approved") {
      ctx.addIssue({
        code: "custom",
        path: ["script", "status"],
        message: "script approval is only available through the approval workflow"
      });
    }
  });

export const modelsQuerySchema = z
  .object({
    refresh: z.enum(["true", "false"]).optional()
  })
  .strict()
  .transform((query) => ({ refresh: query.refresh === "true" }));

export const modelSummarySchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    contextLength: z.number().int().positive(),
    inputPrice: z.string().min(1),
    outputPrice: z.string().min(1),
    outputModalities: z.array(z.string()),
    supportedParameters: z.array(z.string()),
    expirationDate: z.string().min(1).nullable(),
    structuredOutputs: z.boolean(),
    zdrAvailable: z.boolean()
  })
  .strict();

export const modelsResponseSchema = z
  .object({
    data: z
      .object({
        models: z.array(modelSummarySchema),
        fetchedAt: isoUtcDateTimeSchema,
        cached: z.boolean()
      })
      .strict()
  })
  .strict();

export const terminologyCreateRequestSchema = strictObject({
  surface: terminologySurfaceInputSchema,
  readingKatakana: terminologyReadingInputSchema,
  category: terminologyCategoryInputSchema,
  priority: finiteNumberSchema.int().optional().default(0),
  notes: z.string().optional().default("")
});

export const terminologyUpdateRequestSchema = strictObject({
  surface: terminologySurfaceInputSchema,
  readingKatakana: terminologyReadingInputSchema,
  category: terminologyCategoryInputSchema,
  priority: finiteNumberSchema.int(),
  notes: z.string()
});

export const terminologyListQuerySchema = strictObject({
  surface: z.string().transform(normalizeTerminologySearchValue).optional(),
  reading: z.string().transform(normalizeTerminologySearchValue).optional(),
  category: z
    .string()
    .transform((value) => value.trim())
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional(),
  status: terminologyStatusSchema.optional()
});

export const terminologyTermParamsSchema = strictObject({
  termId: idSchema
});

export const terminologyListResponseSchema = strictObject({
  data: z.array(terminologyTermSchema),
  revision: nonNegativeIntegerSchema.optional()
});

export const terminologyTermResponseSchema = strictObject({
  data: terminologyTermSchema,
  revision: nonNegativeIntegerSchema.optional()
});

export const terminologyPreviewRequestSchema = strictObject({
  spokenText: z.string().refine((value) => value.trim().length > 0, {
    message: "spokenText must not be blank"
  }),
  pronunciation: pronunciationSchema
});

export const appliedTerminologySchema = strictObject({
  termId: idSchema,
  surface: z.string().min(1),
  reading: z.string().min(1),
  termUpdatedAt: isoUtcDateTimeSchema
});

export const terminologyPreviewResultSchema = strictObject({
  resolvedSpokenText: z.string(),
  appliedTerms: z.array(appliedTerminologySchema)
});

export const terminologyPreviewResponseSchema = strictObject({
  data: terminologyPreviewResultSchema
});

const assetTagIdsInputSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .transform((values) => values.map(normalizeAssetTextField))
  .transform((values) => [...new Set(values)])
  .pipe(z.array(idSchema))
  .optional()
  .default([]);

export const assetUploadFieldsSchema = strictObject({
  kind: assetKindSchema,
  title: z
    .string()
    .transform(normalizeAssetTextField)
    .refine((value) => value.length > 0, "タイトルは必須です。"),
  description: z
    .string()
    .transform(normalizeAssetTextField)
    .optional()
    .default(""),
  department: z.string().transform(normalizeAssetOptionalField).optional(),
  system: z.string().transform(normalizeAssetOptionalField).optional(),
  confidentiality: z.string().transform(normalizeAssetOptionalField).optional(),
  tagIds: assetTagIdsInputSchema
});

export const assetUploadResponseSchema = strictObject({
  data: assetUploadReceiptSchema,
  revision: nonNegativeIntegerSchema.optional()
});

export const assetDetailResponseSchema = strictObject({
  data: assetDetailSchema,
  revision: nonNegativeIntegerSchema.optional()
});

export const assetListQuerySchema = strictObject({
  q: z.string().optional(),
  query: z.string().optional(),
  kind: assetKindSchema.optional(),
  department: z.string().transform(normalizeAssetOptionalField).optional(),
  system: z.string().transform(normalizeAssetOptionalField).optional(),
  status: assetStatusSchema.optional(),
  tagIds: assetTagIdsInputSchema,
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(24)
}).transform((query) => ({
  q: normalizeAssetSearchQuery(query.q ?? query.query ?? ""),
  kind: query.kind,
  department: query.department,
  system: query.system,
  status: query.status ?? "active",
  tagIds: query.tagIds,
  page: query.page,
  pageSize: query.pageSize
}));

export const assetListResponseSchema = strictObject({
  data: assetListResultSchema,
  revision: nonNegativeIntegerSchema.optional()
});

export const assetIdParamsSchema = strictObject({
  assetId: idSchema
});

export const assetThumbnailParamsSchema = strictObject({
  assetId: idSchema,
  thumbnailIndex: z.coerce.number().int().nonnegative()
});

export type ApiErrorDetail = z.infer<typeof apiErrorDetailSchema>;
export type ApiSuccessResponse<T> = {
  data: T;
  revision?: number;
};
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ProjectCreateRequest = z.infer<typeof projectCreateRequestSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
export type ProjectCreateResponse = z.infer<
  typeof projectCreateResponseSchema
>;
export type ProjectDetailResponse = z.infer<
  typeof projectDetailResponseSchema
>;
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
export type ProjectMutationResponse = z.infer<
  typeof projectMutationResponseSchema
>;
export type VisualAssignmentInput = z.infer<typeof visualAssignmentInputSchema>;
export type VisualAssignmentCreateInput = z.infer<
  typeof visualAssignmentCreateInputSchema
>;
export type VisualAssignmentRequest = z.infer<
  typeof visualAssignmentRequestSchema
>;
export type VisualAssignmentUpdateRequest = z.infer<
  typeof visualAssignmentUpdateRequestSchema
>;
export type VisualAssignmentDeleteRequest = z.infer<
  typeof visualAssignmentDeleteRequestSchema
>;
export type VisualApprovalRequest = z.infer<typeof visualApprovalRequestSchema>;
export type VisualAssignmentSaveRequest = z.infer<
  typeof visualAssignmentSaveRequestSchema
>;
export type VisualAssignmentResponse = z.infer<
  typeof visualAssignmentResponseSchema
>;
export type OutlineGenerateRequest = z.infer<
  typeof outlineGenerateRequestSchema
>;
export type OutlineSaveRequest = z.infer<typeof outlineSaveRequestSchema>;
export type OutlineApproveRequest = z.infer<typeof outlineApproveRequestSchema>;
export type OutlineReviewRequest = z.infer<typeof outlineReviewRequestSchema>;
export type ScriptInitializeRequest = z.infer<
  typeof scriptInitializeRequestSchema
>;
export type ScriptApproveRequest = z.infer<typeof scriptApproveRequestSchema>;
export type ScriptSaveRequest = z.infer<typeof scriptSaveRequestSchema>;
export type ModelsQuery = z.infer<typeof modelsQuerySchema>;
export type ModelSummary = z.infer<typeof modelSummarySchema>;
export type ModelsResponse = z.infer<typeof modelsResponseSchema>;
export type TerminologyCreateRequest = z.infer<
  typeof terminologyCreateRequestSchema
>;
export type TerminologyUpdateRequest = z.infer<
  typeof terminologyUpdateRequestSchema
>;
export type TerminologyListQuery = z.infer<typeof terminologyListQuerySchema>;
export type TerminologyTermParams = z.infer<
  typeof terminologyTermParamsSchema
>;
export type TerminologyListResponse = z.infer<
  typeof terminologyListResponseSchema
>;
export type TerminologyTermResponse = z.infer<
  typeof terminologyTermResponseSchema
>;
export type TerminologyPreviewRequest = z.infer<
  typeof terminologyPreviewRequestSchema
>;
export type AppliedTerminology = z.infer<typeof appliedTerminologySchema>;
export type TerminologyPreviewResult = z.infer<
  typeof terminologyPreviewResultSchema
>;
export type TerminologyPreviewResponse = z.infer<
  typeof terminologyPreviewResponseSchema
>;
export type AssetUploadFields = z.infer<typeof assetUploadFieldsSchema>;
export type AssetUploadResponse = z.infer<typeof assetUploadResponseSchema>;
export type AssetDetailResponse = z.infer<typeof assetDetailResponseSchema>;
export type AssetListQuery = z.infer<typeof assetListQuerySchema>;
export type AssetListResponse = z.infer<typeof assetListResponseSchema>;
export type AssetIdParams = z.infer<typeof assetIdParamsSchema>;
export type AssetThumbnailParams = z.infer<typeof assetThumbnailParamsSchema>;
export type VisualAssignmentParams = z.infer<
  typeof visualAssignmentParamsSchema
>;
export {
  visualSuggestionRequestSchema,
  visualSuggestionResponseSchema
};
export type { VisualSuggestionRequest, VisualSuggestionResponse };

export function createApiSuccessResponse<T>(
  data: T
): ApiSuccessResponse<T>;
export function createApiSuccessResponse<T>(
  data: T,
  revision: number
): ApiSuccessResponse<T>;
export function createApiSuccessResponse<T>(
  data: T,
  revision?: number
): ApiSuccessResponse<T> {
  return revision === undefined ? { data } : { data, revision };
}

export function createApiErrorResponse(
  code: string,
  message: string,
  requestId: string,
  details: readonly ApiErrorDetail[] = []
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      details: details.map((detail) => ({
        path: [...detail.path],
        message: detail.message
      })),
      requestId
    }
  };
}
