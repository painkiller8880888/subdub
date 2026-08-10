import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions
} from "fastify";

import { createApiSuccessResponse } from "../schema/api.js";
import { ProjectService } from "../app/projects/project-service.js";
import { createOpenRouterModelService } from "../openrouter/model-service.js";
import { OutlineGenerationService } from "../app/projects/outline-generation-service.js";
import type { AssetUploadLimits } from "../app/assets/asset-upload-limits.js";
import { registerApiErrorHandler } from "./middleware/error-handler.js";
import { registerNotFoundHandler } from "./middleware/not-found-handler.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerOutlineRoutes } from "./routes/outline.js";
import { registerVisualSuggestionRoutes } from "./routes/visual-suggestions.js";
import { registerProjectRoutes } from "./routes/projects.js";
import {
  registerTerminologyRoutes,
  type TerminologyServicePort
} from "./routes/terminology.js";
import { registerAssetRoutes, type AssetServicePort } from "./routes/assets.js";
import { VisualSuggestionService } from "../app/projects/visual-suggestion-service.js";
import { registerVisualAssignmentRoutes } from "./routes/visual-assignments.js";

export type AppOptions = {
  logger?: FastifyServerOptions["logger"];
  modelService?: Pick<
    ReturnType<typeof createOpenRouterModelService>,
    "listModels"
  >;
  projectService?: ProjectService;
  outlineGenerationService?: Pick<OutlineGenerationService, "generate">;
  visualSuggestionService?: Pick<VisualSuggestionService, "generate">;
  visualAssignmentService?: import("./routes/visual-assignments.js").VisualAssignmentServicePort;
  terminologyService?: TerminologyServicePort;
  assetService?: AssetServicePort;
  assetUploadLimits?: AssetUploadLimits;
  staticRoot?: string;
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  registerApiErrorHandler(app);
  registerModelRoutes(
    app,
    options.modelService ?? createOpenRouterModelService()
  );

  app.get("/api/health", async () =>
    createApiSuccessResponse({ status: "ok" })
  );

  if (options.projectService !== undefined) {
    registerProjectRoutes(app, options.projectService);
  }

  if (options.outlineGenerationService !== undefined) {
    registerOutlineRoutes(app, options.outlineGenerationService);
  }

  if (options.visualSuggestionService !== undefined) {
    registerVisualSuggestionRoutes(app, options.visualSuggestionService);
  }

  if (options.visualAssignmentService !== undefined) {
    registerVisualAssignmentRoutes(app, options.visualAssignmentService);
  }

  if (options.terminologyService !== undefined) {
    registerTerminologyRoutes(app, options.terminologyService);
  }

  if (options.assetService !== undefined) {
    registerAssetRoutes(app, options.assetService, {
      limits: options.assetUploadLimits
    });
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
