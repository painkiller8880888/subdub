import type { FastifyInstance } from "fastify";

import { VisualAssignmentService } from "../../app/projects/visual-assignment-service.js";
import {
  createApiSuccessResponse,
  visualAssignmentRequestSchema,
  visualAssignmentResponseSchema
} from "../../schema/api.js";

export function registerVisualAssignmentRoutes(
  app: FastifyInstance,
  visualAssignmentService: Pick<VisualAssignmentService, "assign">
): void {
  app.put<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/visual-assignments",
    async (request) => {
      const input = visualAssignmentRequestSchema.parse(request.body);
      const result = await visualAssignmentService.assign(
        request.params.projectId,
        input
      );
      return visualAssignmentResponseSchema.parse(
        createApiSuccessResponse(result.data, result.revision)
      );
    }
  );
}
