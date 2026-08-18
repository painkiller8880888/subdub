import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { type FastifyInstance } from "fastify";

import { buildApp, type AppOptions } from "./app.js";
import { API_HOST, API_PORT } from "./config.js";
import {
  ProjectRepository
} from "../app/projects/project-repository.js";
import { ProjectService } from "../app/projects/project-service.js";
import { ProjectEditService } from "../app/projects/project-edit-service.js";
import { OutlineGenerationService } from "../app/projects/outline-generation-service.js";
import { VisualSuggestionService } from "../app/projects/visual-suggestion-service.js";
import { VisualAssignmentService } from "../app/projects/visual-assignment-service.js";
import { TerminologyRepository } from "../app/terminology/terminology-repository.js";
import { TerminologyService } from "../app/terminology/terminology-service.js";
import { AssetRepository } from "../app/assets/asset-repository.js";
import { AssetService } from "../app/assets/asset-service.js";
import { AssetProcessingService } from "../app/assets/asset-processing-service.js";
import { AssetProcessingWorker } from "../app/assets/asset-processing-worker.js";
import {
  NodeAssetFileStore
} from "../app/assets/asset-file-store.js";
import { createLazyMediaProcessingPort } from "../app/assets/processing/index.js";
import type { AssetUploadLimits } from "../app/assets/asset-upload-limits.js";
import { createOpenRouterChatAdapter } from "../openrouter/chat-adapter.js";
import { createOpenRouterModelService } from "../openrouter/model-service.js";
import type { BackupDatabase } from "../db/backup.js";
import {
  initializeWorkspaceDatabase,
  type WorkspaceDatabaseHandle
} from "../db/initialize.js";
import type { MigrationFolder } from "../db/paths.js";
import { VoicevoxGenerationService } from "../app/voicevox/generation-service.js";
import { VoicevoxAdjustmentService } from "../app/voicevox/adjustment-service.js";
import { VoicevoxClient } from "../voicevox/client.js";
import { VoicevoxAudioStore } from "../app/voicevox/audio-store.js";
import { RenderManifestStore } from "../app/rendering/render-manifest-store.js";
import { RenderManifestCompileService } from "../app/rendering/render-manifest-compile-service.js";
import { ManifestPreviewService } from "../app/rendering/manifest-preview-service.js";
import {
  RenderJobService,
  type RenderJobLifecyclePort
} from "../app/rendering/render-job-service.js";
import { ProjectFileService } from "../app/projects/project-file-service.js";
import {
  ImprovementLogRepository,
  type ImprovementLogRepositoryPort
} from "../app/projects/improvement-log-repository.js";
import {
  AiRunSearchService,
  type AiRunSearchImprovementLogRepositoryPort
} from "../app/ai-run-search-service.js";
import { RunLogStore } from "../app/run-log-store.js";
import { CharacterVisualRepository } from "../app/character-visuals/character-visual-repository.js";
import { CharacterVisualCatalogService } from "../app/character-visuals/character-visual-service.js";
import {
  legacyCharacterVisualDescriptions,
  legacyCharacterVisualNames,
  legacyCharacterVisualSeed
} from "../app/character-visuals/character-visual-seed.js";
import {
  ScreenTemplateCatalogService,
  ScreenTemplateRepository
} from "../app/screen-templates/index.js";

export const SERVER_HOST = API_HOST;
export const SERVER_PORT = API_PORT;

const characterVisualSeedSourceRoot = fileURLToPath(
  new URL("../../doc/assets/", import.meta.url)
);

export type ServerOptions = AppOptions & {
  backupDatabase?: BackupDatabase;
  databasePath?: string;
  migrationsFolder?: MigrationFolder;
  projectRepository?: ProjectRepository;
  projectEditService?: ProjectEditService;
  improvementLogRepository?: ImprovementLogRepositoryPort &
    AiRunSearchImprovementLogRepositoryPort;
  terminologyRepository?: TerminologyRepository;
  assetRepository?: AssetRepository;
  assetProcessingService?: AssetProcessingService;
  assetProcessingWorker?: AssetProcessingWorker;
  visualAssignmentService?: import("./routes/visual-assignments.js").VisualAssignmentServicePort;
  assetUploadLimits?: AssetUploadLimits;
  workspaceRoot?: string;
  renderJobService?: RenderJobLifecyclePort;
};

export type InitializedServer = {
  app: FastifyInstance;
  database: WorkspaceDatabaseHandle;
};

export async function ensureWorkspaceDirectories(
  workspaceRoot = process.cwd()
): Promise<void> {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  await Promise.all([
    mkdir(path.join(resolvedWorkspaceRoot, "library"), { recursive: true }),
    mkdir(path.join(resolvedWorkspaceRoot, "library", "media"), {
      recursive: true
    }),
    mkdir(path.join(resolvedWorkspaceRoot, "library", "staging"), {
      recursive: true
    }),
    mkdir(path.join(resolvedWorkspaceRoot, "library", "character-visuals"), {
      recursive: true
    }),
    mkdir(path.join(resolvedWorkspaceRoot, "projects"), { recursive: true })
  ]);
}

export async function initializeServer(
  options: ServerOptions = {}
): Promise<InitializedServer> {
  const {
    backupDatabase,
    databasePath,
    migrationsFolder,
    projectRepository,
    improvementLogRepository,
    terminologyRepository,
    assetRepository,
    assetProcessingService,
    assetProcessingWorker,
    terminologyService: suppliedTerminologyService,
    projectService: suppliedProjectService,
    projectEditService: suppliedProjectEditService,
    visualAssignmentService: suppliedVisualAssignmentService,
    voiceAdjustmentService: suppliedVoiceAdjustmentService,
    voiceGenerationService: suppliedVoiceGenerationService,
    renderJobService: suppliedRenderJobService,
    screenTemplateService: suppliedScreenTemplateService,
    workspaceRoot = process.cwd(),
    ...appOptions
  } = options;
  await ensureWorkspaceDirectories(workspaceRoot);

  const database = await initializeWorkspaceDatabase({
    backupDatabase,
    databasePath,
    migrationsFolder,
    workspaceRoot
  });

  try {
    const resolvedScreenTemplateService =
      suppliedScreenTemplateService ??
      new ScreenTemplateCatalogService({
        repository: new ScreenTemplateRepository(database.database)
      });
    const resolvedProjectRepository =
      projectRepository ??
      new ProjectRepository({
        workspaceRoot,
        screenTemplateCatalog: resolvedScreenTemplateService
      });
    const resolvedImprovementLogRepository =
      improvementLogRepository ?? new ImprovementLogRepository(database.database);
    const resolvedAiRunSearchService =
      appOptions.aiRunSearchService ??
      new AiRunSearchService({
        projectRepository: resolvedProjectRepository,
        runLogStore: new RunLogStore({ workspaceRoot }),
        improvementLogRepository: resolvedImprovementLogRepository
      });
    const resolvedModelService =
      appOptions.modelService ?? createOpenRouterModelService();
    const resolvedChatAdapter = createOpenRouterChatAdapter();
    const resolvedAssetRepository =
      assetRepository ?? new AssetRepository(database.database);
    let resolvedCharacterVisualCatalogService =
      appOptions.characterVisualCatalogService;
    if (resolvedCharacterVisualCatalogService === undefined) {
      const seededCharacterVisualCatalogService =
        new CharacterVisualCatalogService({
          repository: new CharacterVisualRepository(database.database),
          workspaceRoot
        });
      await seededCharacterVisualCatalogService.seedLegacyCatalog({
        sourceRoot: characterVisualSeedSourceRoot,
        catalog: legacyCharacterVisualSeed,
        names: legacyCharacterVisualNames,
        descriptions: legacyCharacterVisualDescriptions
      });
      resolvedCharacterVisualCatalogService =
        seededCharacterVisualCatalogService;
    }
    const resolvedProjectService =
      suppliedProjectService ??
      new ProjectService({
        repository: resolvedProjectRepository,
        improvementLogRepository: resolvedImprovementLogRepository,
        screenTemplateCatalog: resolvedScreenTemplateService
      });
    const resolvedProjectEditService =
      suppliedProjectEditService ??
      new ProjectEditService({
        repository: resolvedProjectRepository,
        assetRepository: resolvedAssetRepository,
        workspaceRoot,
        libraryRoot: path.join(workspaceRoot, "library")
      });
    const resolvedOutlineGenerationService =
      appOptions.outlineGenerationService ??
      new OutlineGenerationService({
        repository: resolvedProjectRepository,
        modelService: resolvedModelService,
        chatAdapter: resolvedChatAdapter,
        improvementLogRepository: resolvedImprovementLogRepository
      });
    const resolvedVisualSuggestionService =
      appOptions.visualSuggestionService ??
      new VisualSuggestionService({
        repository: resolvedProjectRepository,
        assetRepository: resolvedAssetRepository,
        modelService: resolvedModelService,
        chatAdapter: resolvedChatAdapter,
        improvementLogRepository: resolvedImprovementLogRepository
      });
    const resolvedVisualAssignmentService =
      suppliedVisualAssignmentService ??
      new VisualAssignmentService({
        repository: resolvedProjectRepository,
        assetRepository: resolvedAssetRepository,
        workspaceRoot,
        libraryRoot: path.join(workspaceRoot, "library"),
        improvementLogRepository: resolvedImprovementLogRepository
      });
    const resolvedTerminologyService =
      suppliedTerminologyService ??
      new TerminologyService({
        repository:
          terminologyRepository ?? new TerminologyRepository(database.database)
      });
    const voicevoxClient = new VoicevoxClient();
    const resolvedAssetService =
      appOptions.assetService ??
      new AssetService({
        repository:
          resolvedAssetRepository,
        managementRoot: path.join(workspaceRoot, "library"),
        limits: options.assetUploadLimits
      });
    const resolvedVoiceGenerationService =
      suppliedVoiceGenerationService ??
      new VoicevoxGenerationService({
        repository: resolvedProjectRepository,
        client: voicevoxClient,
        terminologyService: resolvedTerminologyService,
        workspaceRoot
      });
    const resolvedVoiceAdjustmentService =
      suppliedVoiceAdjustmentService ??
      new VoicevoxAdjustmentService({
        repository: resolvedProjectRepository,
        client: voicevoxClient,
        terminologyService: resolvedTerminologyService,
        workspaceRoot
      });
    const resolvedProcessingService =
      assetProcessingService ??
      new AssetProcessingService({
        repository:
          resolvedAssetRepository,
        fileStore: new NodeAssetFileStore(path.join(workspaceRoot, "library")),
        processingPort: createLazyMediaProcessingPort()
      });
    const resolvedProcessingWorker =
      assetProcessingWorker ??
      new AssetProcessingWorker({ service: resolvedProcessingService });
    const resolvedProjectFileService =
      appOptions.projectFileService ?? new ProjectFileService({ workspaceRoot });
    const renderManifestStore = new RenderManifestStore({ workspaceRoot });
    const audioStore = new VoicevoxAudioStore({ workspaceRoot });
    const resolvedManifestPreviewService =
      appOptions.manifestPreviewService ??
      new ManifestPreviewService({
        workspaceRoot,
        projectRepository: resolvedProjectRepository,
        screenTemplateCatalog: resolvedScreenTemplateService,
        manifestStore: renderManifestStore,
        audioStore,
        voiceGenerationService: resolvedVoiceGenerationService,
        projectFileService: resolvedProjectFileService
      });
    const verifyCharacterVisualFiles =
      resolvedCharacterVisualCatalogService.verifyFiles;
    const resolvedManifestCompileService =
      appOptions.manifestCompileService ??
      (verifyCharacterVisualFiles === undefined
        ? undefined
        : new RenderManifestCompileService({
            workspaceRoot,
            projectRepository: resolvedProjectRepository,
            screenTemplateCatalog: resolvedScreenTemplateService,
            assetRepository: resolvedAssetRepository,
            characterVisualCatalogService: {
              verifyFiles: verifyCharacterVisualFiles.bind(
                resolvedCharacterVisualCatalogService
              )
            },
            audioStore,
            manifestStore: renderManifestStore
          }));
    const resolvedRenderJobService: RenderJobLifecyclePort =
      suppliedRenderJobService ??
      new RenderJobService({
        workspaceRoot,
        projectRepository: resolvedProjectRepository,
        manifestPreviewService: resolvedManifestPreviewService
      });
    const app = buildApp({
      ...appOptions,
      modelService: resolvedModelService,
      outlineGenerationService: resolvedOutlineGenerationService,
      visualSuggestionService: resolvedVisualSuggestionService,
      visualAssignmentService: resolvedVisualAssignmentService,
      projectService: resolvedProjectService,
      projectEditService: resolvedProjectEditService,
      terminologyService: resolvedTerminologyService,
      assetService: resolvedAssetService,
      assetUploadLimits: options.assetUploadLimits,
      voiceGenerationService: resolvedVoiceGenerationService,
      voiceAdjustmentService: resolvedVoiceAdjustmentService,
      manifestPreviewService: resolvedManifestPreviewService,
      manifestCompileService: resolvedManifestCompileService,
      projectFileService: resolvedProjectFileService,
      renderJobService: resolvedRenderJobService,
      aiRunSearchService: resolvedAiRunSearchService,
      characterVisualCatalogService: resolvedCharacterVisualCatalogService,
      screenTemplateService: resolvedScreenTemplateService
    });
    resolvedProcessingWorker.start();
    resolvedRenderJobService.start();
    app.addHook("onClose", async () => {
      await resolvedRenderJobService.stop();
      await resolvedProcessingWorker.stop();
      database.close();
    });
    return { app, database };
  } catch (error) {
    database.close();
    throw error;
  }
}

export async function startServer(
  options: ServerOptions = {}
): Promise<void> {
  const initialized = await initializeServer(options);

  try {
    await initialized.app.listen({ host: SERVER_HOST, port: SERVER_PORT });
  } catch (error) {
    await initialized.app.close();
    throw error;
  }
}
