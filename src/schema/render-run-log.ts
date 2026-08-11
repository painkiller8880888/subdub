import { z } from "zod";

import {
  idSchema,
  isoUtcDateTimeSchema,
  relativePosixPathSchema,
  sha256Schema,
  strictObject,
  nonNegativeIntegerSchema
} from "./primitives.js";

export const renderJobKindSchema = z.enum(["mp4", "thumbnail"]);

export const renderRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed"
]);

const renderRunLogCommonFields = {
  runId: idSchema,
  projectId: idSchema,
  kind: renderJobKindSchema,
  projectRevision: nonNegativeIntegerSchema,
  queuedAt: isoUtcDateTimeSchema
};

export const renderRunLogQueuedSchema = strictObject({
  ...renderRunLogCommonFields,
  status: z.literal("queued"),
  startedAt: z.null(),
  completedAt: z.null()
});

export const renderRunLogRunningSchema = strictObject({
  ...renderRunLogCommonFields,
  status: z.literal("running"),
  startedAt: isoUtcDateTimeSchema,
  completedAt: z.null()
});

export const renderRunLogSucceededSchema = strictObject({
  ...renderRunLogCommonFields,
  status: z.literal("succeeded"),
  startedAt: isoUtcDateTimeSchema,
  completedAt: isoUtcDateTimeSchema,
  outputPath: relativePosixPathSchema,
  outputChecksum: sha256Schema
});

export const renderRunLogFailedSchema = strictObject({
  ...renderRunLogCommonFields,
  status: z.literal("failed"),
  startedAt: isoUtcDateTimeSchema.nullable(),
  completedAt: isoUtcDateTimeSchema,
  errorCode: z.string().min(1)
});

export const renderRunLogSchema = z.discriminatedUnion("status", [
  renderRunLogQueuedSchema,
  renderRunLogRunningSchema,
  renderRunLogSucceededSchema,
  renderRunLogFailedSchema
]);

export type RenderJobKind = z.infer<typeof renderJobKindSchema>;
export type RenderRunStatus = z.infer<typeof renderRunStatusSchema>;
export type RenderRunLogQueued = z.infer<typeof renderRunLogQueuedSchema>;
export type RenderRunLogRunning = z.infer<typeof renderRunLogRunningSchema>;
export type RenderRunLogSucceeded = z.infer<typeof renderRunLogSucceededSchema>;
export type RenderRunLogFailed = z.infer<typeof renderRunLogFailedSchema>;
export type RenderRunLog = z.infer<typeof renderRunLogSchema>;
