import type { FastifyInstance } from "fastify";

import { TerminologyService } from "../../app/terminology/terminology-service.js";
import {
  createApiSuccessResponse,
  terminologyCreateRequestSchema,
  terminologyListQuerySchema,
  terminologyListResponseSchema,
  terminologyTermParamsSchema,
  terminologyTermResponseSchema,
  terminologyUpdateRequestSchema
} from "../../schema/api.js";

export type TerminologyServicePort = Pick<
  TerminologyService,
  "list" | "create" | "get" | "update" | "deactivate" | "activate"
>;

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
