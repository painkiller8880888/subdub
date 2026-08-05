import type { FastifyInstance } from "fastify";

import { OutlineGenerationService } from "../../app/projects/outline-generation-service.js";
import {
  createApiSuccessResponse,
  outlineGenerateRequestSchema,
  projectMutationResponseSchema
} from "../../schema/api.js";

export function registerOutlineRoutes(
  app: FastifyInstance,
  outlineGenerationService: Pick<OutlineGenerationService, "generate">
): void {
  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/outline/generate",
    async (request) => {
      const input = outlineGenerateRequestSchema.parse(request.body);
      const project = await outlineGenerationService.generate(
        request.params.projectId,
        input
      );
      return projectMutationResponseSchema.parse(
        createApiSuccessResponse(project, project.revision)
      );
    }
  );
}
