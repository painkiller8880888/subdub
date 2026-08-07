import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { buildApp } from "./app.js";
import { API_HOST, API_PORT } from "./config.js";
import { ProjectRepository } from "../app/projects/project-repository.js";
import { ProjectService } from "../app/projects/project-service.js";
import { OutlineGenerationService } from "../app/projects/outline-generation-service.js";
import { TerminologyRepository } from "../app/terminology/terminology-repository.js";
import { TerminologyService } from "../app/terminology/terminology-service.js";
import { AssetRepository } from "../app/assets/asset-repository.js";
import { AssetService } from "../app/assets/asset-service.js";
import { createOpenRouterChatAdapter } from "../openrouter/chat-adapter.js";
import { createOpenRouterModelService } from "../openrouter/model-service.js";
import { initializeWorkspaceDatabase } from "../db/initialize.js";
export const SERVER_HOST = API_HOST;
export const SERVER_PORT = API_PORT;
export async function ensureWorkspaceDirectories(workspaceRoot = process.cwd()) {
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
export async function initializeServer(options = {}) {
    const { backupDatabase, databasePath, migrationsFolder, projectRepository, terminologyRepository, assetRepository, terminologyService: suppliedTerminologyService, projectService: suppliedProjectService, workspaceRoot = process.cwd(), ...appOptions } = options;
    await ensureWorkspaceDirectories(workspaceRoot);
    const database = await initializeWorkspaceDatabase({
        backupDatabase,
        databasePath,
        migrationsFolder,
        workspaceRoot
    });
    try {
        const resolvedProjectRepository = projectRepository ?? new ProjectRepository({ workspaceRoot });
        const resolvedModelService = appOptions.modelService ?? createOpenRouterModelService();
        const resolvedProjectService = suppliedProjectService ??
            new ProjectService({
                repository: resolvedProjectRepository
            });
        const resolvedOutlineGenerationService = appOptions.outlineGenerationService ??
            new OutlineGenerationService({
                repository: resolvedProjectRepository,
                modelService: resolvedModelService,
                chatAdapter: createOpenRouterChatAdapter()
            });
        const resolvedTerminologyService = suppliedTerminologyService ??
            new TerminologyService({
                repository: terminologyRepository ?? new TerminologyRepository(database.database)
            });
        const resolvedAssetService = appOptions.assetService ??
            new AssetService({
                repository: assetRepository ?? new AssetRepository(database.database),
                managementRoot: path.join(workspaceRoot, "library"),
                limits: options.assetUploadLimits
            });
        const app = buildApp({
            ...appOptions,
            modelService: resolvedModelService,
            outlineGenerationService: resolvedOutlineGenerationService,
            projectService: resolvedProjectService,
            terminologyService: resolvedTerminologyService,
            assetService: resolvedAssetService,
            assetUploadLimits: options.assetUploadLimits
        });
        app.addHook("onClose", async () => {
            database.close();
        });
        return { app, database };
    }
    catch (error) {
        database.close();
        throw error;
    }
}
export async function startServer(options = {}) {
    const initialized = await initializeServer(options);
    try {
        await initialized.app.listen({ host: SERVER_HOST, port: SERVER_PORT });
    }
    catch (error) {
        await initialized.app.close();
        throw error;
    }
}
//# sourceMappingURL=server.js.map