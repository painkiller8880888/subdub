import type { FastifyInstance } from "fastify";

import { VisualAssignmentService } from "../../app/projects/visual-assignment-service.js";
import {
  createApiSuccessResponse,
  visualAssignmentRequestSchema,
  visualAssignmentResponseSchema,
  visualAssignmentUpdateRequestSchema,
  visualAssignmentDeleteRequestSchema,
  visualApprovalRequestSchema,
  visualAssignmentParamsSchema
} from "../../schema/api.js";

export type VisualAssignmentServicePort = Pick<
  VisualAssignmentService,
  "assign"
> &
  Partial<Pick<VisualAssignmentService, "update" | "remove" | "approve">>;

export function registerVisualAssignmentRoutes(
  app: FastifyInstance,
  visualAssignmentService: VisualAssignmentServicePort
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

  if (
    visualAssignmentService.update !== undefined &&
    visualAssignmentService.remove !== undefined &&
    visualAssignmentService.approve !== undefined
  ) {
    app.put<{ Params: { projectId: string; assignmentId: string } }>(
      "/api/projects/:projectId/visual-assignments/:assignmentId",
      async (request) => {
        const params = visualAssignmentParamsSchema.parse({
          assignmentId: request.params.assignmentId
        });
        const input = visualAssignmentUpdateRequestSchema.parse(request.body);
        const result = await visualAssignmentService.update?.(
          request.params.projectId,
          params.assignmentId,
          input
        );
        if (result === undefined) {
          throw new Error("Visual assignment update service is unavailable.");
        }
        return visualAssignmentResponseSchema.parse(
          createApiSuccessResponse(result.data, result.revision)
        );
      }
    );

    app.delete<{ Params: { projectId: string; assignmentId: string } }>(
      "/api/projects/:projectId/visual-assignments/:assignmentId",
      async (request) => {
        const params = visualAssignmentParamsSchema.parse({
          assignmentId: request.params.assignmentId
        });
        const input = visualAssignmentDeleteRequestSchema.parse(request.body);
        const result = await visualAssignmentService.remove?.(
          request.params.projectId,
          params.assignmentId,
          input
        );
        if (result === undefined) {
          throw new Error("Visual assignment removal service is unavailable.");
        }
        return visualAssignmentResponseSchema.parse(
          createApiSuccessResponse(result.data, result.revision)
        );
      }
    );

    app.post<{ Params: { projectId: string } }>(
      "/api/projects/:projectId/visuals/approve",
      async (request) => {
        const input = visualApprovalRequestSchema.parse(request.body);
        const result = await visualAssignmentService.approve?.(
          request.params.projectId,
          input
        );
        if (result === undefined) {
          throw new Error("Visual approval service is unavailable.");
        }
        return visualAssignmentResponseSchema.parse(
          createApiSuccessResponse(result.data, result.revision)
        );
      }
    );
  }
}
