import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { createApiSuccessResponse } from "../schema/api.js";
import { createOpenRouterModelService } from "../openrouter/model-service.js";
import { registerApiErrorHandler } from "./middleware/error-handler.js";
import { registerNotFoundHandler } from "./middleware/not-found-handler.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerOutlineRoutes } from "./routes/outline.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerTerminologyRoutes } from "./routes/terminology.js";
import { registerAssetRoutes } from "./routes/assets.js";
export function buildApp(options = {}) {
    const app = Fastify({ logger: options.logger ?? false });
    registerApiErrorHandler(app);
    registerModelRoutes(app, options.modelService ?? createOpenRouterModelService());
    app.get("/api/health", async () => createApiSuccessResponse({ status: "ok" }));
    if (options.projectService !== undefined) {
        registerProjectRoutes(app, options.projectService);
    }
    if (options.outlineGenerationService !== undefined) {
        registerOutlineRoutes(app, options.outlineGenerationService);
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
//# sourceMappingURL=app.js.map