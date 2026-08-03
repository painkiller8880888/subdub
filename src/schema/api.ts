import { z } from "zod";

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

export type ApiErrorDetail = z.infer<typeof apiErrorDetailSchema>;
export type ApiSuccessResponse<T> = {
  data: T;
  revision?: number;
};
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

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
