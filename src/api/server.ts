import { mkdir } from "node:fs/promises";
import * as path from "node:path";

import { type FastifyInstance } from "fastify";

import { buildApp, type AppOptions } from "./app.js";
import { API_HOST, API_PORT } from "./config.js";
import {
  ProjectRepository
} from "../app/projects/project-repository.js";
import { ProjectService } from "../app/projects/project-service.js";
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

export const SERVER_HOST = API_HOST;
export const SERVER_PORT = API_PORT;

export type ServerOptions = AppOptions & {
  backupDatabase?: BackupDatabase;
  databasePath?: string;
  migrationsFolder?: MigrationFolder;
  projectRepository?: ProjectRepository;
  terminologyRepository?: TerminologyRepository;
  assetRepository?: AssetRepository;
  assetProcessingService?: AssetProcessingService;
  assetProcessingWorker?: AssetProcessingWorker;
  visualAssignmentService?: import("./routes/visual-assignments.js").VisualAssignmentServicePort;
  assetUploadLimits?: AssetUploadLimits;
  workspaceRoot?: string;
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
    terminologyRepository,
    assetRepository,
    assetProcessingService,
    assetProcessingWorker,
    terminologyService: suppliedTerminologyService,
    projectService: suppliedProjectService,
    visualAssignmentService: suppliedVisualAssignmentService,
    voiceGenerationService: suppliedVoiceGenerationService,
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
    const resolvedProjectRepository =
      projectRepository ?? new ProjectRepository({ workspaceRoot });
    const resolvedModelService =
      appOptions.modelService ?? createOpenRouterModelService();
    const resolvedChatAdapter = createOpenRouterChatAdapter();
    const resolvedAssetRepository =
      assetRepository ?? new AssetRepository(database.database);
    const resolvedProjectService =
      suppliedProjectService ??
      new ProjectService({
        repository: resolvedProjectRepository
      });
    const resolvedOutlineGenerationService =
      appOptions.outlineGenerationService ??
      new OutlineGenerationService({
        repository: resolvedProjectRepository,
        modelService: resolvedModelService,
        chatAdapter: resolvedChatAdapter
      });
    const resolvedVisualSuggestionService =
      appOptions.visualSuggestionService ??
      new VisualSuggestionService({
        repository: resolvedProjectRepository,
        assetRepository: resolvedAssetRepository,
        modelService: resolvedModelService,
        chatAdapter: resolvedChatAdapter
      });
    const resolvedVisualAssignmentService =
      suppliedVisualAssignmentService ??
      new VisualAssignmentService({
        repository: resolvedProjectRepository,
        assetRepository: resolvedAssetRepository,
        workspaceRoot,
        libraryRoot: path.join(workspaceRoot, "library")
      });
    const resolvedTerminologyService =
      suppliedTerminologyService ??
      new TerminologyService({
        repository:
          terminologyRepository ?? new TerminologyRepository(database.database)
      });
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
    const app = buildApp({
      ...appOptions,
      modelService: resolvedModelService,
      outlineGenerationService: resolvedOutlineGenerationService,
      visualSuggestionService: resolvedVisualSuggestionService,
      visualAssignmentService: resolvedVisualAssignmentService,
      projectService: resolvedProjectService,
      terminologyService: resolvedTerminologyService,
      assetService: resolvedAssetService,
      assetUploadLimits: options.assetUploadLimits,
      voiceGenerationService: resolvedVoiceGenerationService
    });
    resolvedProcessingWorker.start();
    app.addHook("onClose", async () => {
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
