import { z } from "zod";

import {
  legacyAiRunLogSchema,
  runLogSchema,
  type LegacyAiRunLog,
  type RunLog
} from "./run-log.js";

/**
 * Compatibility view for callers that still use the pre-P6-01 AI shape.
 * New files are validated and written using runLogSchema; this parser also
 * accepts those files so existing readers do not break during the transition.
 */
const compatibleInputSchema = z
  .union([legacyAiRunLogSchema, runLogSchema])
  .superRefine((value, ctx) => {
    if (value.kind !== "ai") {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: "expected an AI run log"
      });
    }
  });

function toCompatibilityView(value: LegacyAiRunLog | RunLog) {
  if (value.kind === "ai" && "projectRevision" in value) {
    return {
      runId: value.runId,
      kind: "ai" as const,
      taskKind: value.taskKind,
      projectId: value.projectId,
      startRevision: value.projectRevision,
      sourceHash: value.sourceHash,
      inputHash: value.inputHash,
      startedAt: value.startedAt,
      completedAt: value.finishedAt,
      status: value.status,
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
      costCredits: value.costCredits,
      schemaValidation: value.schemaValidation,
      outputChecksum:
        value.outputs.find((output) => output.checksum !== undefined)
          ?.checksum ?? null,
      errorCode: value.errorCode,
      imageInput: value.imageInput,
      tools: value.tools
    };
  }

  if (value.kind === "ai") {
    return value;
  }

  throw new Error("expected an AI run log");
}

export const aiRunLogSchema =
  compatibleInputSchema.transform(toCompatibilityView);

export type AiRunLog = z.infer<typeof aiRunLogSchema>;
