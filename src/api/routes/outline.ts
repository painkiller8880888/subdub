import type { FastifyInstance } from "fastify";

import { OutlineGenerationService } from "../../app/projects/outline-generation-service.js";
import {
  createApiSuccessResponse,
  outlineGenerateRequestSchema,
  outlineRegenerateRequestSchema,
  projectMutationResponseSchema
} from "../../schema/api.js";

export function registerOutlineRoutes(
  app: FastifyInstance,
  outlineGenerationService: Pick<
    OutlineGenerationService,
    "generate" | "regenerate"
  >
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

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/outline/regenerate",
    async (request) => {
      const input = outlineRegenerateRequestSchema.parse(request.body);
      const project = await outlineGenerationService.regenerate(
        request.params.projectId,
        input
      );
      return projectMutationResponseSchema.parse(
        createApiSuccessResponse(project, project.revision)
      );
    }
  );
}
