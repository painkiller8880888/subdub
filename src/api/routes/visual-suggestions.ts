import type { FastifyInstance } from "fastify";

import { VisualSuggestionService } from "../../app/projects/visual-suggestion-service.js";
import {
  createApiSuccessResponse,
  improvementDecisionResponseSchema,
  visualSuggestionCandidateRejectParamsSchema,
  visualSuggestionCandidateRejectRequestSchema,
  visualSuggestionRequestSchema,
  visualSuggestionResponseSchema
} from "../../schema/api.js";

export function registerVisualSuggestionRoutes(
  app: FastifyInstance,
  visualSuggestionService: Pick<VisualSuggestionService, "generate"> &
    Partial<Pick<VisualSuggestionService, "rejectCandidate">>
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

  if (visualSuggestionService.rejectCandidate !== undefined) {
    app.post<{
      Params: { projectId: string; runId: string; assetId: string };
    }>(
      "/api/projects/:projectId/visual-suggestions/:runId/candidates/:assetId/reject",
      async (request) => {
        const params = visualSuggestionCandidateRejectParamsSchema.parse({
          runId: request.params.runId,
          assetId: request.params.assetId
        });
        const input = visualSuggestionCandidateRejectRequestSchema.parse(
          request.body
        );
        const result = await visualSuggestionService.rejectCandidate?.(
          request.params.projectId,
          params.runId,
          params.assetId,
          input
        );
        if (result === undefined) {
          throw new Error(
            "Visual suggestion rejection service is unavailable."
          );
        }
        return improvementDecisionResponseSchema.parse(
          createApiSuccessResponse(result.data, result.revision)
        );
      }
    );
  }
}
