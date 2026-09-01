import type { FastifyInstance } from "fastify";

import { OutlineGenerationService } from "../../app/projects/outline-generation-service.js";
import {
  createApiSuccessResponse,
  projectMutationResponseSchema
} from "../../schema/api.js";
import { outlineGenerateRequestSchema } from "../../schema/legacy-api.js";

/**
 * Compatibility-only route registration. The standard Fastify composition
 * deliberately does not call this function; PC-04 retires the planning API
 * from the current runtime while keeping the implementation available for
 * isolated legacy maintenance.
 */

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
