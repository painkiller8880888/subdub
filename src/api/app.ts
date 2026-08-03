import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { createApiSuccessResponse } from "../schema/api.js";
import { registerApiErrorHandler } from "./middleware/error-handler.js";
import { registerNotFoundHandler } from "./middleware/not-found-handler.js";

export type AppOptions = {
  staticRoot?: string;
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerApiErrorHandler(app);

  app.get("/api/health", async () =>
    createApiSuccessResponse({ status: "ok" })
  );

  if (options.staticRoot !== undefined) {
    app.register(fastifyStatic, {
      root: options.staticRoot,
      prefix: "/"
    });
  }

  registerNotFoundHandler(app, {
    staticFallback: options.staticRoot !== undefined
  });

  return app;
}
