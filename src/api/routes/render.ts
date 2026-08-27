import type { FastifyInstance } from "fastify";

import type { RenderJobService } from "../../app/rendering/render-job-service.js";
import {
  createApiSuccessResponse,
  previewRenderAcceptedResponseSchema,
  previewRenderRequestSchema,
  renderAcceptedResponseSchema,
  renderProjectParamsSchema,
  renderRunParamsSchema,
  renderRunStatusResponseSchema
} from "../../schema/api.js";

export type RenderJobServicePort = Pick<
  RenderJobService,
  "enqueueMp4" | "enqueueThumbnail" | "getStatus"
> &
  Partial<Pick<RenderJobService, "enqueuePreview">>;

export function registerRenderRoutes(
  app: FastifyInstance,
  renderJobService: RenderJobServicePort
): void {
  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/render",
    async (request, reply) => {
      const params = renderProjectParamsSchema.parse(request.params);
      const accepted = await renderJobService.enqueueMp4(params.projectId);
      return reply
        .code(202)
        .type("application/json")
        .send(
          renderAcceptedResponseSchema.parse(createApiSuccessResponse(accepted))
        );
    }
  );

  if (renderJobService.enqueuePreview !== undefined) {
    const enqueuePreview =
      renderJobService.enqueuePreview.bind(renderJobService);
    app.post<{
      Params: { projectId: string };
      Body: { previewPreset: unknown };
    }>("/api/projects/:projectId/preview/render", async (request, reply) => {
      const params = renderProjectParamsSchema.parse(request.params);
      const body = previewRenderRequestSchema.parse(request.body);
      const accepted = await enqueuePreview(
        params.projectId,
        body.previewPreset
      );
      return reply
        .code(202)
        .type("application/json")
        .send(
          previewRenderAcceptedResponseSchema.parse(
            createApiSuccessResponse(accepted)
          )
        );
    });
  }

  app.get<{ Params: { projectId: string; runId: string } }>(
    "/api/projects/:projectId/render/:runId",
    async (request) => {
      const params = renderRunParamsSchema.parse(request.params);
      const status = await renderJobService.getStatus(
        params.projectId,
        params.runId
      );
      return renderRunStatusResponseSchema.parse(
        createApiSuccessResponse(status)
      );
    }
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/thumbnail/render",
    async (request, reply) => {
      const params = renderProjectParamsSchema.parse(request.params);
      const accepted = await renderJobService.enqueueThumbnail(
        params.projectId
      );
      return reply
        .code(202)
        .type("application/json")
        .send(
          renderAcceptedResponseSchema.parse(createApiSuccessResponse(accepted))
        );
    }
  );
}
