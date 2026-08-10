import type { FastifyInstance } from "fastify";

import {
  createApiSuccessResponse,
  voiceAdjustmentMutationResponseSchema,
  voiceAdjustmentParamsSchema,
  voiceAdjustmentPreviewParamsSchema,
  voiceAdjustmentPreviewRequestSchema,
  voiceAdjustmentPreviewResponseSchema,
  voiceAdjustmentResetResponseSchema,
  voiceAdjustmentSaveRequestSchema,
  voiceAdjustmentSnapshotResponseSchema
} from "../../schema/api.js";
import { idSchema } from "../../schema/primitives.js";
import type { VoicevoxAdjustmentServicePort } from "../../app/voicevox/adjustment-service.js";

export type { VoicevoxAdjustmentServicePort } from "../../app/voicevox/adjustment-service.js";

export function registerVoiceAdjustmentRoutes(
  app: FastifyInstance,
  service: VoicevoxAdjustmentServicePort
): void {
  app.get<{ Params: { projectId: string; lineId: string } }>(
    "/api/projects/:projectId/voice/adjustments/:lineId",
    async (request) => {
      const params = voiceAdjustmentParamsSchema.parse({
        lineId: request.params.lineId
      });
      const snapshot = await service.get(
        request.params.projectId,
        params.lineId
      );
      return voiceAdjustmentSnapshotResponseSchema.parse(
        createApiSuccessResponse(snapshot)
      );
    }
  );

  app.put<{ Params: { projectId: string; lineId: string } }>(
    "/api/projects/:projectId/voice/adjustments/:lineId",
    async (request) => {
      const params = voiceAdjustmentParamsSchema.parse({
        lineId: request.params.lineId
      });
      const input = voiceAdjustmentSaveRequestSchema.parse(request.body);
      const snapshot = await service.save(
        request.params.projectId,
        params.lineId,
        input.adjustment
      );
      return voiceAdjustmentSnapshotResponseSchema.parse(
        createApiSuccessResponse(snapshot)
      );
    }
  );

  app.post<{ Params: { projectId: string; lineId: string } }>(
    "/api/projects/:projectId/voice/adjustments/:lineId/preview",
    async (request) => {
      const params = voiceAdjustmentParamsSchema.parse({
        lineId: request.params.lineId
      });
      const input = voiceAdjustmentPreviewRequestSchema.parse(request.body);
      const preview = await service.preview(
        request.params.projectId,
        params.lineId,
        input.query
      );
      return voiceAdjustmentPreviewResponseSchema.parse(
        createApiSuccessResponse(preview)
      );
    }
  );

  app.get<{
    Params: { projectId: string; lineId: string; previewId: string };
  }>(
    "/api/projects/:projectId/voice/adjustments/:lineId/preview/:previewId",
    async (request, reply) => {
      const params = voiceAdjustmentPreviewParamsSchema.parse({
        lineId: request.params.lineId,
        previewId: request.params.previewId
      });
      const bytes = await service.readPreview(
        request.params.projectId,
        params.lineId,
        params.previewId
      );
      return reply.type("audio/wav").send(Buffer.from(bytes));
    }
  );

  app.delete<{ Params: { projectId: string; lineId: string } }>(
    "/api/projects/:projectId/voice/adjustments/:lineId",
    async (request) => {
      const params = voiceAdjustmentParamsSchema.parse({
        lineId: request.params.lineId
      });
      await service.discard(request.params.projectId, params.lineId);
      return voiceAdjustmentMutationResponseSchema.parse(
        createApiSuccessResponse({ lineId: params.lineId })
      );
    }
  );

  app.delete<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/voice/adjustments",
    async (request) => {
      const projectId = idSchema.parse(request.params.projectId);
      const result = await service.resetAll(projectId);
      return voiceAdjustmentResetResponseSchema.parse(
        createApiSuccessResponse(result)
      );
    }
  );
}
