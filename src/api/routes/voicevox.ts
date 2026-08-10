import type { FastifyInstance } from "fastify";

import {
  createApiErrorResponse,
  createApiSuccessResponse,
  voicevoxStatusResponseSchema
} from "../../schema/api.js";
import { API_ERROR_CODE } from "../errors/api-error.js";
import type { VoicevoxStatusService } from "../../voicevox/service.js";

export type VoicevoxStatusServicePort = Pick<
  VoicevoxStatusService,
  "getStatus"
>;

export function registerVoicevoxRoutes(
  app: FastifyInstance,
  voicevoxService: VoicevoxStatusServicePort
): void {
  app.get("/api/voicevox/status", async (request, reply) => {
    const status = await voicevoxService.getStatus();
    if (!status.available) {
      return reply
        .code(503)
        .type("application/json")
        .send(
          createApiErrorResponse(
            API_ERROR_CODE.voicevoxUnavailable,
            "VOICEVOX audio is unavailable.",
            request.id
          )
        );
    }

    return voicevoxStatusResponseSchema.parse(createApiSuccessResponse(status));
  });
}
