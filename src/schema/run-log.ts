import { z } from "zod";

import { aiTaskKindSchema, type AiTaskKind } from "./video-project.js";
import {
  idSchema,
  isoUtcDateTimeSchema,
  nonNegativeIntegerSchema,
  relativePosixPathSchema,
  sha256Schema,
  strictObject
} from "./primitives.js";

const lowercaseSha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a lowercase SHA-256 hash");

export const runKindSchema = z.enum(["ai", "voice", "manifest", "render"]);
export const runStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed"
]);
export const renderKindSchema = z.enum(["mp4", "thumbnail"]);
export const runErrorCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/, "must be a normalized error code");

/**
 * Run logs describe where data was processed without retaining the data
 * itself. Local runs deliberately use null for the provider-specific fields.
 */
export const runPrivacySchema = strictObject({
  execution: z.enum(["local", "external"]),
  dataCollection: z.enum(["deny", "allow"]).nullable(),
  zdr: z.boolean().nullable(),
  providerFallbacks: z.boolean().nullable()
});

export const runOutputSchema = strictObject({
  path: relativePosixPathSchema.optional(),
  checksum: lowercaseSha256Schema.optional(),
  targetId: idSchema.optional()
}).superRefine((output, ctx) => {
  if (output.path === undefined && output.checksum === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "an output must include a path or checksum"
    });
  }
});

export const runLineFailureSchema = strictObject({
  lineId: idSchema,
  errorCode: runErrorCodeSchema
});

const runLogCommonFields = {
  runId: idSchema,
  projectId: idSchema,
  projectRevision: nonNegativeIntegerSchema,
  queuedAt: isoUtcDateTimeSchema,
  startedAt: isoUtcDateTimeSchema.nullable(),
  finishedAt: isoUtcDateTimeSchema.nullable(),
  status: runStatusSchema,
  inputHash: lowercaseSha256Schema,
  model: z.string().min(1).nullable(),
  engine: z.string().min(1).nullable(),
  privacy: runPrivacySchema,
  outputs: z.array(runOutputSchema),
  errorCode: runErrorCodeSchema.nullable()
};

const runLogInvariantFields = {
  ...runLogCommonFields,
  status: runStatusSchema
};

function addRunStatusIssues(
  value: {
    status: z.infer<typeof runStatusSchema>;
    startedAt: string | null;
    finishedAt: string | null;
    outputs: readonly unknown[];
    errorCode: string | null;
  },
  ctx: z.RefinementCtx
): void {
  if (value.status === "queued") {
    if (value.startedAt !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "queued runs must not have startedAt"
      });
    }
    if (value.finishedAt !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "queued runs must not have finishedAt"
      });
    }
  }

  if (value.status === "running") {
    if (value.startedAt === null) {
      ctx.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "running runs must have startedAt"
      });
    }
    if (value.finishedAt !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "running runs must not have finishedAt"
      });
    }
  }

  if (value.status === "succeeded") {
    if (value.startedAt === null) {
      ctx.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "succeeded runs must have startedAt"
      });
    }
    if (value.finishedAt === null) {
      ctx.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "succeeded runs must have finishedAt"
      });
    }
    if (value.errorCode !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "succeeded runs must not have errorCode"
      });
    }
  }

  if (value.status === "failed") {
    if (value.finishedAt === null) {
      ctx.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "failed runs must have finishedAt"
      });
    }
    if (value.errorCode === null) {
      ctx.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "failed runs must have errorCode"
      });
    }
  }

  if (
    (value.status === "queued" || value.status === "running") &&
    value.outputs.length > 0
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["outputs"],
      message: "non-terminal runs must not have completed outputs"
    });
  }
}

const aiRunLogBaseSchema = strictObject({
  ...runLogInvariantFields,
  kind: z.literal("ai"),
  taskKind: aiTaskKindSchema,
  sourceHash: lowercaseSha256Schema,
  modelId: z.string().min(1).nullable(),
  modelSelectionSource: z
    .enum(["run_override", "task_override", "default"])
    .nullable(),
  responseModel: z.string().min(1).nullable(),
  provider: z.string().min(1).nullable(),
  zdr: z.boolean(),
  dataCollection: z.literal("deny"),
  providerFallbacks: z.literal(true),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  httpAttemptCount: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  costCredits: z.number().finite().nonnegative().nullable(),
  schemaValidation: z.enum(["passed", "failed", "not_run"]),
  imageInput: z.boolean(),
  tools: z.boolean()
}).superRefine(addRunStatusIssues);

const voiceRunLogBaseSchema = strictObject({
  ...runLogInvariantFields,
  kind: z.literal("voice"),
  engineVersion: z.string().min(1),
  targetCount: nonNegativeIntegerSchema,
  generatedCount: nonNegativeIntegerSchema,
  noOp: z.boolean(),
  lineFailures: z.array(runLineFailureSchema)
}).superRefine(addRunStatusIssues);

const manifestRunLogBaseSchema = strictObject({
  ...runLogInvariantFields,
  kind: z.literal("manifest"),
  reused: z.boolean()
}).superRefine(addRunStatusIssues);

const renderRunLogBaseSchema = strictObject({
  ...runLogInvariantFields,
  kind: z.literal("render"),
  renderKind: renderKindSchema
}).superRefine(addRunStatusIssues);

/** The persisted, strict, discriminated run-log contract. */
export const runLogSchema = z.discriminatedUnion("kind", [
  aiRunLogBaseSchema,
  voiceRunLogBaseSchema,
  manifestRunLogBaseSchema,
  renderRunLogBaseSchema
]);

export type RunKind = z.infer<typeof runKindSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunPrivacy = z.infer<typeof runPrivacySchema>;
export type RunOutput = z.infer<typeof runOutputSchema>;
export type RunLineFailure = z.infer<typeof runLineFailureSchema>;
export type CommonAiRunLog = z.infer<typeof aiRunLogBaseSchema>;
export type VoiceRunLog = z.infer<typeof voiceRunLogBaseSchema>;
export type ManifestRunLog = z.infer<typeof manifestRunLogBaseSchema>;
export type CommonRenderRunLog = z.infer<typeof renderRunLogBaseSchema>;
export type RunLog = z.infer<typeof runLogSchema>;
export type RunLogAiTaskKind = AiTaskKind;

/*
 * These schemas describe the two contracts written by versions before
 * P6-01. They are intentionally kept private to the compatibility boundary
 * and are never emitted by RunLogStore.
 */
export const legacyAiRunLogSchema = strictObject({
  runId: idSchema,
  kind: z.literal("ai"),
  taskKind: aiTaskKindSchema,
  projectId: idSchema,
  startRevision: nonNegativeIntegerSchema,
  sourceHash: sha256Schema,
  inputHash: sha256Schema,
  startedAt: isoUtcDateTimeSchema,
  completedAt: isoUtcDateTimeSchema.nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  modelId: z.string().min(1).nullable(),
  modelSelectionSource: z
    .enum(["run_override", "task_override", "default"])
    .nullable(),
  responseModel: z.string().min(1).nullable(),
  provider: z.string().min(1).nullable(),
  zdr: z.boolean(),
  dataCollection: z.literal("deny"),
  providerFallbacks: z.literal(true),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  httpAttemptCount: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  schemaValidation: z.enum(["passed", "failed", "not_run"]),
  outputChecksum: sha256Schema.nullable(),
  errorCode: z.string().min(1).nullable(),
  imageInput: z.literal(false),
  tools: z.literal(false)
});

const legacyRenderRunLogCommonFields = {
  runId: idSchema,
  projectId: idSchema,
  kind: renderKindSchema,
  projectRevision: nonNegativeIntegerSchema,
  queuedAt: isoUtcDateTimeSchema
};

const legacyRenderRunLogQueuedSchema = strictObject({
  ...legacyRenderRunLogCommonFields,
  status: z.literal("queued"),
  startedAt: z.null(),
  completedAt: z.null()
});

const legacyRenderRunLogRunningSchema = strictObject({
  ...legacyRenderRunLogCommonFields,
  status: z.literal("running"),
  startedAt: isoUtcDateTimeSchema,
  completedAt: z.null()
});

const legacyRenderRunLogSucceededSchema = strictObject({
  ...legacyRenderRunLogCommonFields,
  status: z.literal("succeeded"),
  startedAt: isoUtcDateTimeSchema,
  completedAt: isoUtcDateTimeSchema,
  outputPath: relativePosixPathSchema,
  outputChecksum: sha256Schema
});

const legacyRenderRunLogFailedSchema = strictObject({
  ...legacyRenderRunLogCommonFields,
  status: z.literal("failed"),
  startedAt: isoUtcDateTimeSchema.nullable(),
  completedAt: isoUtcDateTimeSchema,
  errorCode: z.string().min(1)
});

export const legacyRenderRunLogSchema = z.discriminatedUnion("status", [
  legacyRenderRunLogQueuedSchema,
  legacyRenderRunLogRunningSchema,
  legacyRenderRunLogSucceededSchema,
  legacyRenderRunLogFailedSchema
]);

export type LegacyAiRunLog = z.infer<typeof legacyAiRunLogSchema>;
export type LegacyRenderRunLog = z.infer<typeof legacyRenderRunLogSchema>;

function legacyOutput(
  outputChecksum: string | null,
  projectId: string,
  outputPath: string | undefined
): RunOutput[] {
  if (outputChecksum === null && outputPath === undefined) {
    return [];
  }
  const output: RunOutput = {
    ...(outputPath === undefined
      ? {}
      : {
          path: outputPath.startsWith("projects/")
            ? outputPath
            : `projects/${projectId}/${outputPath}`
        }),
    ...(outputChecksum === null
      ? {}
      : { checksum: outputChecksum.toLowerCase() })
  };
  return [runOutputSchema.parse(output)];
}

function legacyAiToRunLog(value: LegacyAiRunLog): CommonAiRunLog {
  return runLogSchema.parse({
    runId: value.runId,
    kind: "ai",
    projectId: value.projectId,
    projectRevision: value.startRevision,
    queuedAt: value.startedAt,
    startedAt: value.startedAt,
    finishedAt: value.completedAt,
    status: value.status,
    inputHash: value.inputHash.toLowerCase(),
    model: value.modelId,
    engine: null,
    privacy: {
      execution: "external",
      dataCollection: value.dataCollection,
      zdr: value.zdr,
      providerFallbacks: value.providerFallbacks
    },
    outputs: legacyOutput(value.outputChecksum, value.projectId, undefined),
    errorCode: value.errorCode,
    taskKind: value.taskKind,
    sourceHash: value.sourceHash.toLowerCase(),
    modelId: value.modelId,
    modelSelectionSource: value.modelSelectionSource,
    responseModel: value.responseModel,
    provider: value.provider,
    zdr: value.zdr,
    dataCollection: value.dataCollection,
    providerFallbacks: value.providerFallbacks,
    responseTimeMs: value.responseTimeMs,
    httpAttemptCount: value.httpAttemptCount,
    promptTokens: value.promptTokens,
    completionTokens: value.completionTokens,
    totalTokens: value.totalTokens,
    costCredits: null,
    schemaValidation: value.schemaValidation,
    imageInput: value.imageInput,
    tools: value.tools
  }) as CommonAiRunLog;
}

function legacyRenderToRunLog(value: LegacyRenderRunLog): CommonRenderRunLog {
  const succeededOutput =
    value.status === "succeeded"
      ? legacyOutput(
          value.outputChecksum ?? null,
          value.projectId,
          value.outputPath
        )
      : [];
  return runLogSchema.parse({
    runId: value.runId,
    kind: "render",
    projectId: value.projectId,
    projectRevision: value.projectRevision,
    queuedAt: value.queuedAt,
    startedAt: value.startedAt,
    finishedAt: value.completedAt,
    status: value.status,
    inputHash: sha256Schema.parse(
      // Legacy render records had no input hash. Keep the compatibility hash
      // deterministic and free of filesystem or input-content data.
      requireLegacyHash(value)
    ),
    model: null,
    engine: "Remotion",
    privacy: {
      execution: "local",
      dataCollection: null,
      zdr: null,
      providerFallbacks: null
    },
    outputs: succeededOutput,
    errorCode:
      value.status === "failed" ? (value.errorCode ?? "RENDER_FAILED") : null,
    renderKind: value.kind
  }) as CommonRenderRunLog;
}

function requireLegacyHash(value: LegacyRenderRunLog): string {
  // Legacy render records did not retain an input hash. Reuse the recorded
  // artifact checksum when available; otherwise use a stable empty value.
  // New render records always compute a real manifest/render-kind hash.
  return value.status === "succeeded"
    ? value.outputChecksum.toLowerCase()
    : "0".repeat(64);
}

export function normalizeLegacyRunLog(value: unknown): RunLog | undefined {
  const ai = legacyAiRunLogSchema.safeParse(value);
  if (ai.success) {
    try {
      return legacyAiToRunLog(ai.data);
    } catch {
      return undefined;
    }
  }
  const render = legacyRenderRunLogSchema.safeParse(value);
  if (render.success) {
    try {
      return legacyRenderToRunLog(render.data);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function normalizeRunLog(value: unknown): RunLog | undefined {
  const current = runLogSchema.safeParse(value);
  return current.success ? current.data : normalizeLegacyRunLog(value);
}
