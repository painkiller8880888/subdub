import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions
} from "fastify";

import { createApiSuccessResponse } from "../schema/api.js";
import { ProjectService } from "../app/projects/project-service.js";
import { createOpenRouterModelService } from "../openrouter/model-service.js";
import { OutlineGenerationService } from "../app/projects/outline-generation-service.js";
import type { AssetUploadLimits } from "../app/assets/asset-upload-limits.js";
import { DEFAULT_ASSET_UPLOAD_LIMITS } from "../app/assets/asset-upload-limits.js";
import { registerApiErrorHandler } from "./middleware/error-handler.js";
import { registerNotFoundHandler } from "./middleware/not-found-handler.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerOutlineRoutes } from "./routes/outline.js";
import { registerVisualSuggestionRoutes } from "./routes/visual-suggestions.js";
import {
  registerProjectRoutes,
  type ProjectEditServicePort
} from "./routes/projects.js";
import {
  registerTerminologyRoutes,
  type TerminologyServicePort
} from "./routes/terminology.js";
import { registerAssetRoutes, type AssetServicePort } from "./routes/assets.js";
import { VisualSuggestionService } from "../app/projects/visual-suggestion-service.js";
import { registerVisualAssignmentRoutes } from "./routes/visual-assignments.js";
import {
  registerVoicevoxRoutes,
  type VoicevoxStatusServicePort
} from "./routes/voicevox.js";
import {
  registerVoiceGenerationRoutes,
  type VoicevoxGenerationServicePort
} from "./routes/voice-generation.js";
import {
  registerVoiceAdjustmentRoutes,
  type VoicevoxAdjustmentServicePort
} from "./routes/voice-adjustments.js";
import { createVoicevoxStatusService } from "../voicevox/service.js";
import {
  registerManifestPreviewRoutes,
  type ManifestPreviewServicePort
} from "./routes/manifest-preview.js";
import {
  registerManifestCompileRoutes,
  type ManifestCompileServicePort
} from "./routes/manifest-compile.js";
import {
  registerProjectFileRoutes,
  type ProjectFileServicePort
} from "./routes/project-files.js";
import {
  registerRenderRoutes,
  type RenderJobServicePort
} from "./routes/render.js";
import {
  registerAiRunRoutes,
  type AiRunSearchServicePort
} from "./routes/ai-runs.js";
import {
  registerCharacterVisualRoutes,
  type CharacterVisualCatalogServicePort
} from "./routes/character-visuals.js";
import {
  registerScreenTemplateRoutes,
  type ScreenTemplateServicePort
} from "./routes/screen-templates.js";
import {
  registerInsertTextTemplateRoutes,
  type InsertTextTemplateServicePort
} from "./routes/insert-text-templates.js";

export type AppOptions = {
  logger?: FastifyServerOptions["logger"];
  modelService?: Pick<
    ReturnType<typeof createOpenRouterModelService>,
    "listModels"
  >;
  projectService?: ProjectService;
  projectEditService?: ProjectEditServicePort;
  outlineGenerationService?: Pick<OutlineGenerationService, "generate">;
  visualSuggestionService?: Pick<VisualSuggestionService, "generate"> &
    Partial<Pick<VisualSuggestionService, "rejectCandidate">>;
  visualAssignmentService?: import("./routes/visual-assignments.js").VisualAssignmentServicePort;
  terminologyService?: TerminologyServicePort;
  assetService?: AssetServicePort;
  assetUploadLimits?: AssetUploadLimits;
  staticRoot?: string;
  voicevoxService?: VoicevoxStatusServicePort;
  voiceGenerationService?: VoicevoxGenerationServicePort;
  voiceAdjustmentService?: VoicevoxAdjustmentServicePort;
  manifestPreviewService?: ManifestPreviewServicePort;
  manifestCompileService?: ManifestCompileServicePort;
  projectFileService?: ProjectFileServicePort;
  renderJobService?: RenderJobServicePort;
  aiRunSearchService?: AiRunSearchServicePort;
  characterVisualCatalogService?: CharacterVisualCatalogServicePort;
  screenTemplateService?: ScreenTemplateServicePort;
  insertTextTemplateService?: InsertTextTemplateServicePort;
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  registerApiErrorHandler(app);
  registerModelRoutes(
    app,
    options.modelService ?? createOpenRouterModelService()
  );
  registerVoicevoxRoutes(
    app,
    options.voicevoxService ?? createVoicevoxStatusService()
  );

  if (options.voiceGenerationService !== undefined) {
    registerVoiceGenerationRoutes(app, options.voiceGenerationService);
  }

  if (options.voiceAdjustmentService !== undefined) {
    registerVoiceAdjustmentRoutes(app, options.voiceAdjustmentService);
  }

  app.get("/api/health", async () =>
    createApiSuccessResponse({ status: "ok" })
  );

  if (
    options.assetService !== undefined ||
    options.characterVisualCatalogService !== undefined
  ) {
    const assetLimits =
      options.assetUploadLimits ?? DEFAULT_ASSET_UPLOAD_LIMITS;
    app.register(fastifyMultipart, {
      limits: {
        files: Math.max(2, assetLimits.maxFileCount),
        parts: Math.max(64, assetLimits.maxPartCount),
        fields: 1000,
        fieldNameSize: Math.max(64, assetLimits.maxFieldNameLength),
        fieldSize: Math.max(8192, assetLimits.maxFieldValueLength),
        fileSize: assetLimits.maxGlobalFileBytes
      }
    });
  }

  if (options.projectService !== undefined) {
    registerProjectRoutes(
      app,
      options.projectService,
      options.projectEditService
    );
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

  if (options.manifestPreviewService !== undefined) {
    registerManifestPreviewRoutes(app, options.manifestPreviewService);
  }

  if (options.manifestCompileService !== undefined) {
    registerManifestCompileRoutes(app, options.manifestCompileService);
  }

  if (options.projectFileService !== undefined) {
    registerProjectFileRoutes(app, options.projectFileService);
  }

  if (options.renderJobService !== undefined) {
    registerRenderRoutes(app, options.renderJobService);
  }

  if (options.aiRunSearchService !== undefined) {
    registerAiRunRoutes(app, options.aiRunSearchService);
  }

  if (options.characterVisualCatalogService !== undefined) {
    registerCharacterVisualRoutes(app, options.characterVisualCatalogService);
  }

  if (options.screenTemplateService !== undefined) {
    registerScreenTemplateRoutes(app, options.screenTemplateService);
  }

  if (options.insertTextTemplateService !== undefined) {
    registerInsertTextTemplateRoutes(app, options.insertTextTemplateService);
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
