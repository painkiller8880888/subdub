import type { FastifyInstance } from "fastify";

import { CharacterVisualCatalogService } from "../../app/character-visuals/character-visual-service.js";
import {
  characterVisualCatalogResponseSchema,
  characterVisualFileParamsSchema,
  createApiSuccessResponse
} from "../../schema/api.js";

export type CharacterVisualCatalogServicePort = Pick<
  CharacterVisualCatalogService,
  "list" | "readManagedFile"
>;

export function registerCharacterVisualRoutes(
  app: FastifyInstance,
  characterVisualCatalogService: CharacterVisualCatalogServicePort
): void {
  app.get("/api/character-visuals", async () =>
    characterVisualCatalogResponseSchema.parse(
      createApiSuccessResponse(characterVisualCatalogService.list())
    )
  );

  app.get<{
    Params: {
      visualId: string;
      variantId: string;
      fileKey: string;
    };
  }>(
    "/api/character-visuals/:visualId/:variantId/:fileKey",
    async (request, reply) => {
      const params = characterVisualFileParamsSchema.parse(request.params);
      const file = await characterVisualCatalogService.readManagedFile(
        params.visualId,
        params.variantId,
        params.fileKey
      );
      if (file === undefined) {
        return reply.code(404).send();
      }
      return reply.type(file.mimeType).send(file.content);
    }
  );
}
