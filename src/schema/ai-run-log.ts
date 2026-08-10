import { z } from "zod";

import { isoUtcDateTimeSchema } from "./primitives.js";
import { sha256Schema, strictObject } from "./primitives.js";
import { aiTaskKindSchema } from "./video-project.js";

export const aiRunLogSchema = strictObject({
  runId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: z.literal("ai"),
  taskKind: aiTaskKindSchema,
  projectId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  startRevision: z.number().int().nonnegative(),
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

export type AiRunLog = z.infer<typeof aiRunLogSchema>;
