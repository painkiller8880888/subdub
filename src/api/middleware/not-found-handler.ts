import type { FastifyInstance } from "fastify";

import { createApiErrorResponse } from "../../schema/api.js";
import { API_ERROR_CODE } from "../errors/api-error.js";

type NotFoundHandlerOptions = {
  readonly staticFallback: boolean;
};

function isApiPath(url: string): boolean {
  const pathname = url.split("?", 1)[0];
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function registerNotFoundHandler(
  app: FastifyInstance,
  options: NotFoundHandlerOptions
): void {
  app.setNotFoundHandler((request, reply) => {
    if (isApiPath(request.url)) {
      return reply
        .code(404)
        .type("application/json")
        .send(
          createApiErrorResponse(
            API_ERROR_CODE.apiNotFound,
            "指定されたAPIルートが見つかりません。",
            request.id
          )
        );
    }

    if (options.staticFallback && request.method === "GET") {
      return reply.sendFile("index.html");
    }

    return reply.code(404).send();
  });
}
