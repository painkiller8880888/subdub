import type { FastifyInstance } from "fastify";

import {
  aiRunSearchQuerySchema,
  aiRunSearchResponseSchema,
  createApiSuccessResponse
} from "../../schema/api.js";
import type { AiRunSearchService } from "../../app/ai-run-search-service.js";

export type AiRunSearchServicePort = Pick<AiRunSearchService, "search">;

export function registerAiRunRoutes(
  app: FastifyInstance,
  service: AiRunSearchServicePort
): void {
  app.get("/api/ai-runs", async (request) => {
    const query = aiRunSearchQuerySchema.parse(request.query);
    const data = await service.search(query);
    return aiRunSearchResponseSchema.parse(createApiSuccessResponse(data));
  });
}
