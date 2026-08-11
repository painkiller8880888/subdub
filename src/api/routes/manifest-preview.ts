import type { FastifyInstance } from "fastify";

import { ManifestPreviewService } from "../../app/rendering/manifest-preview-service.js";
import {
  createApiSuccessResponse,
  manifestPreviewParamsSchema,
  manifestPreviewResponseSchema
} from "../../schema/api.js";

export type ManifestPreviewServicePort = Pick<ManifestPreviewService, "get">;

export function registerManifestPreviewRoutes(
  app: FastifyInstance,
  manifestPreviewService: ManifestPreviewServicePort
): void {
  app.get("/api/projects/:projectId/manifest", async (request) => {
    const params = manifestPreviewParamsSchema.parse(request.params);
    const data = await manifestPreviewService.get(params.projectId);
    return manifestPreviewResponseSchema.parse(createApiSuccessResponse(data));
  });
}
