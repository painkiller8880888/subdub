import type { FastifyInstance } from "fastify";

import {
  createApiSuccessResponse,
  modelsQuerySchema,
  modelsResponseSchema
} from "../../schema/api.js";
import {
  filterSelectableModels,
  type OpenRouterModelService
} from "../../openrouter/model-service.js";

export function registerModelRoutes(
  app: FastifyInstance,
  modelService: Pick<OpenRouterModelService, "listModels">
): void {
  app.get("/api/models", async (request) => {
    const query = modelsQuerySchema.parse(request.query);
    const result = await modelService.listModels({ refresh: query.refresh });
    return modelsResponseSchema.parse(
      createApiSuccessResponse({
        models: filterSelectableModels(result.models),
        fetchedAt: result.fetchedAt,
        cached: result.cached
      })
    );
  });
}
