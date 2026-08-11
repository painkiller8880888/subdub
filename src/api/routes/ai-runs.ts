import type { FastifyInstance } from "fastify";

import {
  aiRunExportQuerySchema,
  aiRunSearchQuerySchema,
  aiRunSearchResponseSchema,
  createApiSuccessResponse
} from "../../schema/api.js";
import type { AiRunSearchService } from "../../app/ai-run-search-service.js";

export type AiRunSearchServicePort = Pick<
  AiRunSearchService,
  "search" | "exportJsonLines"
>;

export function registerAiRunRoutes(
  app: FastifyInstance,
  service: AiRunSearchServicePort
): void {
  app.get("/api/ai-runs/export", async (request, reply) => {
    const query = aiRunExportQuerySchema.parse(request.query);
    const body = await service.exportJsonLines(query);
    return reply
      .code(200)
      .type("application/x-ndjson; charset=utf-8")
      .header(
        "content-disposition",
        'attachment; filename="subdub-ai-runs.jsonl"'
      )
      .send(body);
  });

  app.get("/api/ai-runs", async (request) => {
    const query = aiRunSearchQuerySchema.parse(request.query);
    const data = await service.search(query);
    return aiRunSearchResponseSchema.parse(createApiSuccessResponse(data));
  });
}
