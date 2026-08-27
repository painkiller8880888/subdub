import { z } from "zod";

import {
  legacyRenderRunLogSchema,
  runLogSchema,
  type CommonRenderRunLog,
  type LegacyRenderRunLog,
  type RunLog
} from "./run-log.js";
import {
  idSchema,
  isoUtcDateTimeSchema,
  relativePosixPathSchema,
  sha256Schema,
  strictObject,
  nonNegativeIntegerSchema
} from "./primitives.js";
import { renderProfileSchema } from "./render-profile.js";

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
  queuedAt: isoUtcDateTimeSchema,
  renderProfile: renderProfileSchema.optional()
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

export type RenderRunLogQueued = z.infer<typeof renderRunLogQueuedSchema>;
export type RenderRunLogRunning = z.infer<typeof renderRunLogRunningSchema>;
export type RenderRunLogSucceeded = z.infer<typeof renderRunLogSucceededSchema>;
export type RenderRunLogFailed = z.infer<typeof renderRunLogFailedSchema>;

function publicOutputPath(path: string, projectId: string): string {
  const projectPrefix = `projects/${projectId}/`;
  return path.startsWith(projectPrefix)
    ? path.slice(projectPrefix.length)
    : path;
}

function publicProfile(value: CommonRenderRunLog): {
  readonly renderProfile?: CommonRenderRunLog["renderProfile"];
} {
  return value.renderProfile === undefined ||
    value.renderProfile.kind === "production"
    ? {}
    : { renderProfile: value.renderProfile };
}

function toCompatibilityView(
  value: LegacyRenderRunLog | RunLog
):
  | RenderRunLogQueued
  | RenderRunLogRunning
  | RenderRunLogSucceeded
  | RenderRunLogFailed {
  if (value.kind !== "render") {
    return value as never;
  }

  if (value.status === "succeeded") {
    if (value.startedAt === null || value.finishedAt === null) {
      throw new Error("succeeded render run is missing timestamps");
    }
    const output = value.outputs.find(
      (candidate) => candidate.path !== undefined
    );
    if (output?.path === undefined || output.checksum === undefined) {
      throw new Error("succeeded render run is missing its output artifact");
    }
    return {
      runId: value.runId,
      projectId: value.projectId,
      kind: value.renderKind,
      ...publicProfile(value),
      projectRevision: value.projectRevision,
      queuedAt: value.queuedAt,
      status: value.status,
      startedAt: value.startedAt,
      completedAt: value.finishedAt,
      outputPath: publicOutputPath(output.path, value.projectId),
      outputChecksum: output.checksum
    };
  }

  if (value.status === "failed") {
    if (value.finishedAt === null || value.errorCode === null) {
      throw new Error("failed render run is missing terminal fields");
    }
    return {
      runId: value.runId,
      projectId: value.projectId,
      kind: value.renderKind,
      ...publicProfile(value),
      projectRevision: value.projectRevision,
      queuedAt: value.queuedAt,
      status: value.status,
      startedAt: value.startedAt,
      completedAt: value.finishedAt,
      errorCode: value.errorCode
    };
  }

  return {
    runId: value.runId,
    projectId: value.projectId,
    kind: value.renderKind,
    ...publicProfile(value),
    projectRevision: value.projectRevision,
    queuedAt: value.queuedAt,
    status: value.status,
    startedAt: value.startedAt,
    completedAt: null
  } as RenderRunLogQueued | RenderRunLogRunning;
}

const compatibleInputSchema = z
  .union([legacyRenderRunLogSchema, runLogSchema])
  .superRefine((value, ctx) => {
    const isLegacyRender =
      "kind" in value && (value.kind === "mp4" || value.kind === "thumbnail");
    const isCommonRender = value.kind === "render";
    if (!isLegacyRender && !isCommonRender) {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: "expected a render run log"
      });
    }
  });

/**
 * Compatibility reader for the public/API render contract. The persisted
 * representation is the common run-log contract; old files remain readable.
 */
export const renderRunLogSchema = compatibleInputSchema.transform((value) => {
  if (value.kind === "render") {
    return toCompatibilityView(value);
  }
  if (value.kind === "mp4" || value.kind === "thumbnail") {
    return value;
  }
  throw new Error("expected a render run log");
});

export type RenderJobKind = z.infer<typeof renderJobKindSchema>;
export type RenderRunStatus = z.infer<typeof renderRunStatusSchema>;
export type RenderRunLog = z.infer<typeof renderRunLogSchema>;
