import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type MigrationFolder = string | URL;

const defaultMigrationFolder = new URL("./migrations/", import.meta.url);

export function resolveWorkspaceDatabasePath(workspaceRoot: string): string {
  return path.resolve(workspaceRoot, "library", "workspace.sqlite");
}

export function resolveMigrationFolder(
  migrationsFolder: MigrationFolder = defaultMigrationFolder
): string {
  if (typeof migrationsFolder === "string") {
    return path.resolve(migrationsFolder);
  }

  return fileURLToPath(migrationsFolder);
}
