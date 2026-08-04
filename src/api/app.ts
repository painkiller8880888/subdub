import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions
} from "fastify";

import { createApiSuccessResponse } from "../schema/api.js";
import { ProjectService } from "../app/projects/project-service.js";
import { registerApiErrorHandler } from "./middleware/error-handler.js";
import { registerNotFoundHandler } from "./middleware/not-found-handler.js";
import { registerProjectRoutes } from "./routes/projects.js";

export type AppOptions = {
  logger?: FastifyServerOptions["logger"];
  projectService?: ProjectService;
  staticRoot?: string;
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  registerApiErrorHandler(app);

  app.get("/api/health", async () =>
    createApiSuccessResponse({ status: "ok" })
  );

  if (options.projectService !== undefined) {
    registerProjectRoutes(app, options.projectService);
  }

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
