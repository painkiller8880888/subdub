import { stat } from "node:fs/promises";
import * as path from "node:path";

import type { BackupDatabase } from "./backup.js";
import {
  closeNativeDatabase,
  openNativeDatabase,
  type NativeSqliteConnection
} from "./connection.js";
import { createDrizzleClient, type WorkspaceDatabase } from "./client.js";
import { applyMigrations, type MigrationResult } from "./migrate.js";
import {
  resolveMigrationFolder,
  resolveWorkspaceDatabasePath,
  type MigrationFolder
} from "./paths.js";

export type InitializeDatabaseOptions = {
  databasePath?: string;
  migrationsFolder?: MigrationFolder;
  workspaceRoot?: string;
  backupDatabase?: BackupDatabase;
};

export type WorkspaceDatabaseHandle = {
  connection: NativeSqliteConnection;
  database: WorkspaceDatabase;
  databasePath: string;
  migrationResult: MigrationResult;
  migrationsFolder: string;
  close(): void;
};

async function databaseFileExists(databasePath: string): Promise<boolean> {
  try {
    const stats = await stat(databasePath);
    return stats.isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function initializeWorkspaceDatabase(
  options: InitializeDatabaseOptions = {}
): Promise<WorkspaceDatabaseHandle> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const databasePath = path.resolve(
    options.databasePath ?? resolveWorkspaceDatabasePath(workspaceRoot)
  );
  const migrationsFolder = resolveMigrationFolder(options.migrationsFolder);
  const databaseExisted = await databaseFileExists(databasePath);
  let connection: NativeSqliteConnection | undefined;

  try {
    connection = await openNativeDatabase(databasePath);
    const database = createDrizzleClient(connection);
    const migrationResult = await applyMigrations(database, connection, {
      backupDatabase: options.backupDatabase,
      databaseExisted,
      databasePath,
      migrationsFolder
    });
    let closed = false;

    return {
      close: () => {
        if (!closed) {
          closed = true;
          closeNativeDatabase(connection!);
        }
      },
      connection,
      database,
      databasePath,
      migrationResult,
      migrationsFolder
    };
  } catch (error) {
    if (connection !== undefined) {
      closeNativeDatabase(connection);
    }
    throw error;
  }
}
