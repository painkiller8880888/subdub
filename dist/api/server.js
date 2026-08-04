import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { buildApp } from "./app.js";
import { API_HOST, API_PORT } from "./config.js";
import { ProjectRepository } from "../app/projects/project-repository.js";
import { ProjectService } from "../app/projects/project-service.js";
import { initializeWorkspaceDatabase } from "../db/initialize.js";
export const SERVER_HOST = API_HOST;
export const SERVER_PORT = API_PORT;
export async function ensureWorkspaceDirectories(workspaceRoot = process.cwd()) {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    await Promise.all([
        mkdir(path.join(resolvedWorkspaceRoot, "library"), { recursive: true }),
        mkdir(path.join(resolvedWorkspaceRoot, "projects"), { recursive: true })
    ]);
}
export async function initializeServer(options = {}) {
    const { backupDatabase, databasePath, migrationsFolder, projectRepository, projectService: suppliedProjectService, workspaceRoot = process.cwd(), ...appOptions } = options;
    await ensureWorkspaceDirectories(workspaceRoot);
    const database = await initializeWorkspaceDatabase({
        backupDatabase,
        databasePath,
        migrationsFolder,
        workspaceRoot
    });
    try {
        const resolvedProjectService = suppliedProjectService ??
            new ProjectService({
                repository: projectRepository ?? new ProjectRepository({ workspaceRoot })
            });
        const app = buildApp({
            ...appOptions,
            projectService: resolvedProjectService
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