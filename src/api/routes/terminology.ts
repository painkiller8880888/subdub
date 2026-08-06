import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { TerminologyService } from "../../app/terminology/terminology-service.js";
import { ApiResponseValidationError } from "../errors/api-error.js";
import {
  createApiSuccessResponse,
  terminologyCreateRequestSchema,
  terminologyListQuerySchema,
  terminologyListResponseSchema,
  terminologyPreviewRequestSchema,
  terminologyPreviewResponseSchema,
  terminologyTermParamsSchema,
  terminologyTermResponseSchema,
  terminologyUpdateRequestSchema
} from "../../schema/api.js";

export type TerminologyServicePort = Pick<
  TerminologyService,
  "list" | "create" | "get" | "update" | "deactivate" | "activate" | "preview"
>;

function parseTerminologyPreviewResponse(value: unknown) {
  try {
    return terminologyPreviewResponseSchema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiResponseValidationError(error);
    }
    throw error;
  }
}

export function registerTerminologyRoutes(
  app: FastifyInstance,
  terminologyService: TerminologyServicePort
): void {
  app.get("/api/terminology", async (request) => {
    const query = terminologyListQuerySchema.parse(request.query);
    return terminologyListResponseSchema.parse(
      createApiSuccessResponse(terminologyService.list(query))
    );
  });

  app.post("/api/terminology/preview", async (request) => {
    const input = terminologyPreviewRequestSchema.parse(request.body);
    return parseTerminologyPreviewResponse(
      createApiSuccessResponse(terminologyService.preview(input))
    );
  });

  app.post("/api/terminology", async (request) => {
    const input = terminologyCreateRequestSchema.parse(request.body);
    return terminologyTermResponseSchema.parse(
      createApiSuccessResponse(terminologyService.create(input))
    );
  });

  app.get<{ Params: { termId: string } }>(
    "/api/terminology/:termId",
    async (request) => {
      const params = terminologyTermParamsSchema.parse(request.params);
      return terminologyTermResponseSchema.parse(
        createApiSuccessResponse(terminologyService.get(params.termId))
      );
    }
  );

  app.put<{ Params: { termId: string } }>(
    "/api/terminology/:termId",
    async (request) => {
      const params = terminologyTermParamsSchema.parse(request.params);
      const input = terminologyUpdateRequestSchema.parse(request.body);
      return terminologyTermResponseSchema.parse(
        createApiSuccessResponse(
          terminologyService.update(params.termId, input)
        )
      );
    }
  );

  app.post<{ Params: { termId: string } }>(
    "/api/terminology/:termId/deactivate",
    async (request) => {
      const params = terminologyTermParamsSchema.parse(request.params);
      return terminologyTermResponseSchema.parse(
        createApiSuccessResponse(terminologyService.deactivate(params.termId))
      );
    }
  );

  app.post<{ Params: { termId: string } }>(
    "/api/terminology/:termId/activate",
    async (request) => {
      const params = terminologyTermParamsSchema.parse(request.params);
      return terminologyTermResponseSchema.parse(
        createApiSuccessResponse(terminologyService.activate(params.termId))
      );
    }
  );
}
