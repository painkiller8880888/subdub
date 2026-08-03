import { mkdir } from "node:fs/promises";
import * as path from "node:path";

import { type FastifyInstance } from "fastify";

import { buildApp, type AppOptions } from "./app.js";
import { API_HOST, API_PORT } from "./config.js";
import type { BackupDatabase } from "../db/backup.js";
import {
  initializeWorkspaceDatabase,
  type WorkspaceDatabaseHandle
} from "../db/initialize.js";
import type { MigrationFolder } from "../db/paths.js";

export const SERVER_HOST = API_HOST;
export const SERVER_PORT = API_PORT;

export type ServerOptions = AppOptions & {
  backupDatabase?: BackupDatabase;
  databasePath?: string;
  migrationsFolder?: MigrationFolder;
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
    const app = buildApp(appOptions);
    app.addHook("onClose", async () => {
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
