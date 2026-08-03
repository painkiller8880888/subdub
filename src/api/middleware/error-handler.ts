import type { FastifyInstance } from "fastify";

import { createApiErrorResponse } from "../../schema/api.js";
import { mapApiError } from "../errors/api-error.js";

function getUnexpectedErrorName(error: unknown): string {
  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }

  return typeof error;
}

export function registerApiErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const mappedError = mapApiError(error);

    if (mappedError.shouldLog) {
      request.log.error(
        {
          requestId: request.id,
          errorCode: mappedError.code,
          errorName: getUnexpectedErrorName(error)
        },
        "Unexpected API error"
      );
    }

    return reply
      .code(mappedError.status)
      .type("application/json")
      .send(
        createApiErrorResponse(
          mappedError.code,
          mappedError.message,
          request.id,
          mappedError.details
        )
      );
  });
}
