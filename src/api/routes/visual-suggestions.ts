import type { FastifyInstance } from "fastify";

import { VisualSuggestionService } from "../../app/projects/visual-suggestion-service.js";
import {
  createApiSuccessResponse,
  visualSuggestionRequestSchema,
  visualSuggestionResponseSchema
} from "../../schema/api.js";

export function registerVisualSuggestionRoutes(
  app: FastifyInstance,
  visualSuggestionService: Pick<VisualSuggestionService, "generate">
): void {
  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/visual-suggestions",
    async (request) => {
      const input = visualSuggestionRequestSchema.parse(request.body);
      const result = await visualSuggestionService.generate(
        request.params.projectId,
        input
      );
      return visualSuggestionResponseSchema.parse(
        createApiSuccessResponse(result.data, result.revision)
      );
    }
  );
}
