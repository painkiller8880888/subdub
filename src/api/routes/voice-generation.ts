import type { FastifyInstance } from "fastify";

import {
  createApiSuccessResponse,
  voiceGenerateAllRequestSchema,
  voiceGenerateRequestSchema,
  voiceGenerationAcceptedResponseSchema,
  voiceGenerationStatusResponseSchema
} from "../../schema/api.js";
import type { VoicevoxGenerationService } from "../../app/voicevox/generation-service.js";

export type VoicevoxGenerationServicePort = Pick<
  VoicevoxGenerationService,
  "generate" | "generateAll" | "getStatus"
>;

export function registerVoiceGenerationRoutes(
  app: FastifyInstance,
  service: VoicevoxGenerationServicePort
): void {
  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/voice/generate",
    async (request, reply) => {
      const input = voiceGenerateRequestSchema.parse(request.body);
      const accepted = await service.generate(request.params.projectId, input);
      return reply
        .code(202)
        .type("application/json")
        .send(
          voiceGenerationAcceptedResponseSchema.parse(
            createApiSuccessResponse(accepted)
          )
        );
    }
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/voice/generate-all",
    async (request, reply) => {
      voiceGenerateAllRequestSchema.parse(request.body ?? {});
      const accepted = await service.generateAll(request.params.projectId);
      return reply
        .code(202)
        .type("application/json")
        .send(
          voiceGenerationAcceptedResponseSchema.parse(
            createApiSuccessResponse(accepted)
          )
        );
    }
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/voice/status",
    async (request) => {
      const status = await service.getStatus(request.params.projectId);
      return voiceGenerationStatusResponseSchema.parse(
        createApiSuccessResponse(status)
      );
    }
  );
}
