import { z } from "zod";

import {
  idSchema,
  isoUtcDateTimeSchema,
  nonNegativeIntegerSchema,
  relativePosixPathSchema,
  sha256Schema,
  finiteNumberSchema,
  strictObject
} from "./primitives.js";
import {
  outlineSchema,
  projectBriefSchema,
  pronunciationSchema,
  scriptSchema,
  videoProjectSchema,
  aiTaskKindSchema
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
import {
  voicevoxAdjustmentFileSchema,
  voicevoxAdjustmentBaseSchema,
  voicevoxAudioQuerySchema,
  voicevoxResolvedSpeakerSchema
} from "../voicevox/schemas.js";
import { renderManifestSchema } from "./render-manifest.js";
import {
  renderJobKindSchema,
  renderRunLogSchema
} from "./render-run-log.js";
import {
  runErrorCodeSchema,
  runStatusSchema
} from "./run-log.js";
import {
  improvementDecisionSummarySchema,
  improvementReasonSchema
} from "./improvement-log.js";

const optionalImprovementReasonSchema = improvementReasonSchema
  .nullable()
  .optional();

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

export const voicevoxStatusDataSchema = strictObject({
  available: z.literal(true),
  speakers: z.array(voicevoxResolvedSpeakerSchema).length(2)
});

export const voicevoxStatusResponseSchema = strictObject({
  data: voicevoxStatusDataSchema
});

export const voiceLineGenerationStatusSchema = z.enum([
  "current",
  "stale",
  "needs_review",
  "generating",
  "failed"
]);

export const voiceGenerationJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed"
]);

export const voiceGenerateRequestSchema = strictObject({
  lineIds: z
    .array(idSchema)
    .min(1)
    .superRefine((lineIds, ctx) => {
      if (new Set(lineIds).size !== lineIds.length) {
        ctx.addIssue({
          code: "custom",
          message: "lineIds must not contain duplicates"
        });
      }
    })
});

export const voiceGenerateAllRequestSchema = strictObject({});

export const voiceGenerationAcceptedDataSchema = strictObject({
  runId: idSchema,
  status: z.literal("queued"),
  lineIds: z.array(idSchema)
});

export const voiceGenerationAcceptedResponseSchema = strictObject({
  data: voiceGenerationAcceptedDataSchema
});

export const voiceGenerationLineStatusSchema = strictObject({
  lineId: idSchema,
  status: voiceLineGenerationStatusSchema,
  errorCode: z.string().min(1).optional()
}).superRefine((line, ctx) => {
  if (line.status === "failed" && line.errorCode === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["errorCode"],
      message: "failed voice lines must include an error code"
    });
  }
  if (line.status !== "failed" && line.errorCode !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["errorCode"],
      message: "only failed voice lines may include an error code"
    });
  }
});

export const voiceGenerationJobSummarySchema = strictObject({
  runId: idSchema,
  status: voiceGenerationJobStatusSchema,
  lineIds: z.array(idSchema),
  failedLineIds: z.array(idSchema)
});

export const voiceGenerationStatusDataSchema = strictObject({
  available: z.boolean(),
  unavailableCode: z.string().min(1).optional(),
  lines: z.array(voiceGenerationLineStatusSchema),
  jobs: z.array(voiceGenerationJobSummarySchema)
});

export const voiceGenerationStatusResponseSchema = strictObject({
  data: voiceGenerationStatusDataSchema
});

export const voiceAdjustmentStatusSchema = z.enum(["current", "needs_review"]);

export const voiceAdjustmentParamsSchema = strictObject({
  lineId: idSchema
});

export const voiceAdjustmentPreviewParamsSchema = strictObject({
  lineId: idSchema,
  previewId: idSchema
});

export const voiceAdjustmentSnapshotSchema = strictObject({
  lineId: idSchema,
  status: voiceAdjustmentStatusSchema,
  query: voicevoxAudioQuerySchema,
  adjustment: voicevoxAdjustmentFileSchema.nullable(),
  currentBase: voicevoxAdjustmentBaseSchema
});

export const voiceAdjustmentSnapshotResponseSchema = strictObject({
  data: voiceAdjustmentSnapshotSchema
});

export const voiceAdjustmentSaveRequestSchema = strictObject({
  adjustment: voicevoxAdjustmentFileSchema
});

export const voiceAdjustmentPreviewRequestSchema = strictObject({
  query: voicevoxAudioQuerySchema
});

export const voiceAdjustmentPreviewResponseSchema = strictObject({
  data: strictObject({
    previewId: idSchema
  })
});

export const voiceAdjustmentMutationResponseSchema = strictObject({
  data: strictObject({
    lineId: idSchema
  })
});

export const voiceAdjustmentResetResponseSchema = strictObject({
  data: strictObject({
    projectId: idSchema,
    resetLineIds: z.array(idSchema)
  })
});

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

export const manifestPreviewStateSchema = z.enum([
  "current",
  "stale",
  "missing",
  "invalid"
]);

export const manifestPreviewBlockerTargetSchema = strictObject({
  kind: z.enum([
    "outline",
    "script",
    "visuals",
    "voice",
    "asset",
    "manifest"
  ]),
  path: relativePosixPathSchema.optional(),
  lineId: idSchema.optional(),
  assignmentId: idSchema.optional(),
  sectionId: idSchema.optional()
});

export const manifestPreviewBlockerSchema = strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  target: manifestPreviewBlockerTargetSchema
});

export const manifestPreviewDataSchema = strictObject({
  project: strictObject({
    id: idSchema,
    title: z.string()
  }),
  state: manifestPreviewStateSchema,
  canPlay: z.boolean(),
  manifest: renderManifestSchema.nullable(),
  blockers: z.array(manifestPreviewBlockerSchema)
});

export const manifestPreviewResponseSchema = strictObject({
  data: manifestPreviewDataSchema
});

export const manifestPreviewParamsSchema = strictObject({
  projectId: idSchema
});

export const renderProjectParamsSchema = strictObject({
  projectId: idSchema
});

export const renderRunParamsSchema = strictObject({
  projectId: idSchema,
  runId: idSchema
});

export const renderAcceptedDataSchema = strictObject({
  runId: idSchema,
  status: z.literal("queued"),
  kind: renderJobKindSchema
});

export const renderAcceptedResponseSchema = strictObject({
  data: renderAcceptedDataSchema
});

export const renderRunStatusResponseSchema = strictObject({
  data: renderRunLogSchema
});

export const aiRunDecisionFilterSchema = z.enum([
  "accepted",
  "rejected",
  "undecided"
]);

export const aiRunStatusFilterSchema = z.enum(["succeeded", "failed"]);

const aiRunFilterQueryShape = {
  from: isoUtcDateTimeSchema.optional(),
  to: isoUtcDateTimeSchema.optional(),
  taskKind: aiTaskKindSchema.optional(),
  modelId: z.string().min(1).optional(),
  status: aiRunStatusFilterSchema.optional(),
  decision: aiRunDecisionFilterSchema.optional(),
  errorCode: runErrorCodeSchema.optional()
};

function validateAiRunDateRange(
  query: { readonly from?: string; readonly to?: string },
  ctx: z.RefinementCtx
): void {
  if (
    query.from !== undefined &&
    query.to !== undefined &&
    Date.parse(query.from) >= Date.parse(query.to)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["from"],
      message: "from must be earlier than to"
    });
  }
}

export const aiRunExportQuerySchema = strictObject(
  aiRunFilterQueryShape
).superRefine(validateAiRunDateRange);

export const aiRunSearchQuerySchema = strictObject({
  ...aiRunFilterQueryShape,
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().nonnegative().optional().default(0)
}).superRefine(validateAiRunDateRange);

export const aiRunSearchItemSchema = strictObject({
  runId: idSchema,
  projectId: idSchema,
  taskKind: aiTaskKindSchema,
  modelId: z.string().min(1).nullable(),
  responseModel: z.string().min(1).nullable(),
  status: runStatusSchema,
  queuedAt: isoUtcDateTimeSchema,
  finishedAt: isoUtcDateTimeSchema.nullable(),
  schemaValidation: z.enum(["passed", "failed", "not_run"]),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  errorCode: runErrorCodeSchema.nullable(),
  candidateCount: nonNegativeIntegerSchema,
  acceptedCount: nonNegativeIntegerSchema,
  rejectedCount: nonNegativeIntegerSchema,
  undecidedCount: nonNegativeIntegerSchema,
  modified: z.boolean().nullable()
});

export const AI_RUN_EXPORT_VERSION = "1.0.0" as const;

export const aiRunExportRecordSchema = strictObject({
  exportVersion: z.literal(AI_RUN_EXPORT_VERSION),
  runId: idSchema,
  projectId: idSchema,
  taskKind: aiTaskKindSchema,
  modelId: z.string().min(1).nullable(),
  responseModel: z.string().min(1).nullable(),
  status: runStatusSchema,
  queuedAt: isoUtcDateTimeSchema,
  finishedAt: isoUtcDateTimeSchema.nullable(),
  schemaValidation: z.enum(["passed", "failed", "not_run"]),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  errorCode: runErrorCodeSchema.nullable(),
  candidateCount: nonNegativeIntegerSchema,
  acceptedCount: nonNegativeIntegerSchema,
  rejectedCount: nonNegativeIntegerSchema,
  undecidedCount: nonNegativeIntegerSchema,
  modified: z.boolean().nullable()
});

export const aiRunSearchSummarySchema = strictObject({
  totalCount: nonNegativeIntegerSchema,
  validationPassedCount: nonNegativeIntegerSchema,
  validationEvaluatedCount: nonNegativeIntegerSchema,
  validationPassRate: z.number().finite().min(0).max(1).nullable(),
  responseTimeMeasuredCount: nonNegativeIntegerSchema,
  averageResponseTimeMs: z.number().finite().nonnegative().nullable(),
  modifiedRunCount: nonNegativeIntegerSchema,
  modificationEvaluatedCount: nonNegativeIntegerSchema
});

export const aiRunSearchDataSchema = strictObject({
  items: z.array(aiRunSearchItemSchema),
  summary: aiRunSearchSummarySchema,
  limit: z.number().int().min(1).max(100),
  offset: nonNegativeIntegerSchema,
  hasNextPage: z.boolean()
});

export const aiRunSearchResponseSchema = strictObject({
  data: aiRunSearchDataSchema
});

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
  assignment: visualAssignmentCreateInputSchema,
  suggestionRunId: idSchema.optional(),
  reason: optionalImprovementReasonSchema
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
    expectedRevision: nonNegativeIntegerSchema,
    reason: optionalImprovementReasonSchema
  })
  .strict();

export const outlineRejectRequestSchema = z
  .object({
    expectedRevision: nonNegativeIntegerSchema,
    reason: optionalImprovementReasonSchema
  })
  .strict();

export const visualSuggestionCandidateRejectRequestSchema = strictObject({
  expectedRevision: nonNegativeIntegerSchema,
  reason: optionalImprovementReasonSchema
});

export const visualSuggestionCandidateRejectParamsSchema = strictObject({
  runId: idSchema,
  assetId: idSchema
});

export const improvementDecisionResponseSchema = strictObject({
  data: improvementDecisionSummarySchema,
  revision: nonNegativeIntegerSchema
});

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
  .strict();

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
export type VoicevoxStatusData = z.infer<typeof voicevoxStatusDataSchema>;
export type VoicevoxStatusResponse = z.infer<
  typeof voicevoxStatusResponseSchema
>;
export type VoiceLineGenerationStatus = z.infer<
  typeof voiceGenerationLineStatusSchema
>;
export type VoiceGenerationAccepted = z.infer<
  typeof voiceGenerationAcceptedDataSchema
>;
export type VoiceGenerateRequest = z.infer<
  typeof voiceGenerateRequestSchema
>;
export type VoiceGenerationJobSummary = z.infer<
  typeof voiceGenerationJobSummarySchema
>;
export type VoiceGenerationStatusData = z.infer<
  typeof voiceGenerationStatusDataSchema
>;
export type VoiceAdjustmentStatus = z.infer<
  typeof voiceAdjustmentStatusSchema
>;
export type VoiceAdjustmentSnapshot = z.infer<
  typeof voiceAdjustmentSnapshotSchema
>;
export type VoiceAdjustmentSaveRequest = z.infer<
  typeof voiceAdjustmentSaveRequestSchema
>;
export type VoiceAdjustmentPreviewRequest = z.infer<
  typeof voiceAdjustmentPreviewRequestSchema
>;
export type VoiceAdjustmentPreviewResponse = z.infer<
  typeof voiceAdjustmentPreviewResponseSchema
>;
export type VoiceAdjustmentResetResponse = z.infer<
  typeof voiceAdjustmentResetResponseSchema
>;
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
export type OutlineRejectRequest = z.infer<typeof outlineRejectRequestSchema>;
export type OutlineReviewRequest = z.infer<typeof outlineReviewRequestSchema>;
export type ScriptInitializeRequest = z.infer<
  typeof scriptInitializeRequestSchema
>;
export type ScriptApproveRequest = z.infer<typeof scriptApproveRequestSchema>;
export type ScriptSaveRequest = z.infer<typeof scriptSaveRequestSchema>;
export type VisualSuggestionCandidateRejectRequest = z.infer<
  typeof visualSuggestionCandidateRejectRequestSchema
>;
export type VisualSuggestionCandidateRejectParams = z.infer<
  typeof visualSuggestionCandidateRejectParamsSchema
>;
export type ImprovementDecisionResponse = z.infer<
  typeof improvementDecisionResponseSchema
>;
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
export type ManifestPreviewState = z.infer<typeof manifestPreviewStateSchema>;
export type ManifestPreviewBlocker = z.infer<
  typeof manifestPreviewBlockerSchema
>;
export type ManifestPreviewData = z.infer<typeof manifestPreviewDataSchema>;
export type ManifestPreviewResponse = z.infer<
  typeof manifestPreviewResponseSchema
>;
export type ManifestPreviewParams = z.infer<
  typeof manifestPreviewParamsSchema
>;
export type RenderProjectParams = z.infer<typeof renderProjectParamsSchema>;
export type RenderRunParams = z.infer<typeof renderRunParamsSchema>;
export type RenderAcceptedData = z.infer<typeof renderAcceptedDataSchema>;
export type RenderAcceptedResponse = z.infer<
  typeof renderAcceptedResponseSchema
>;
export type RenderRunStatusResponse = z.infer<
  typeof renderRunStatusResponseSchema
>;
export type AiRunDecisionFilter = z.infer<typeof aiRunDecisionFilterSchema>;
export type AiRunStatusFilter = z.infer<typeof aiRunStatusFilterSchema>;
export type AiRunExportQuery = z.infer<typeof aiRunExportQuerySchema>;
export type AiRunSearchQuery = z.infer<typeof aiRunSearchQuerySchema>;
export type AiRunSearchItem = z.infer<typeof aiRunSearchItemSchema>;
export type AiRunExportRecord = z.infer<typeof aiRunExportRecordSchema>;
export type AiRunSearchSummary = z.infer<typeof aiRunSearchSummarySchema>;
export type AiRunSearchData = z.infer<typeof aiRunSearchDataSchema>;
export type AiRunSearchResponse = z.infer<typeof aiRunSearchResponseSchema>;
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
