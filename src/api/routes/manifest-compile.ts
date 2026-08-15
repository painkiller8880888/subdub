import type { FastifyInstance } from "fastify";

import type { RenderManifestCompileService } from "../../app/rendering/render-manifest-compile-service.js";
import {
  createApiSuccessResponse,
  manifestCompileParamsSchema,
  manifestCompileResponseSchema
} from "../../schema/api.js";

export type ManifestCompileServicePort = Pick<
  RenderManifestCompileService,
  "compile"
>;

export function registerManifestCompileRoutes(
  app: FastifyInstance,
  manifestCompileService: ManifestCompileServicePort
): void {
  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/manifest/compile",
    async (request) => {
      const params = manifestCompileParamsSchema.parse(request.params);
      const result = await manifestCompileService.compile(params.projectId);
      return manifestCompileResponseSchema.parse(
        createApiSuccessResponse(result)
      );
    }
  );
}
