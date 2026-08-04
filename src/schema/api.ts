import { z } from "zod";

import {
  idSchema,
  isoUtcDateTimeSchema,
  nonNegativeIntegerSchema
} from "./primitives.js";
import { videoProjectSchema } from "./video-project.js";

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
