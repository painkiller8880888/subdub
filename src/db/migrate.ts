import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";

import type { BackupDatabase } from "./backup.js";
import { backupBeforeMigration } from "./backup.js";
import type { NativeSqliteConnection } from "./connection.js";
import type { WorkspaceDatabase } from "./client.js";
import { resolveMigrationFolder, type MigrationFolder } from "./paths.js";

export const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations" as const;

export type MigrationResult = {
  applied: boolean;
  backupPath?: string;
};

type MigrationFile = ReturnType<typeof readMigrationFiles>[number];

export type ApplyMigrationsOptions = {
  databaseExisted: boolean;
  databasePath: string;
  migrationsFolder?: MigrationFolder;
  backupDatabase?: BackupDatabase;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasMigrationTable(connection: NativeSqliteConnection): boolean {
  const row = connection
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    )
    .get(DRIZZLE_MIGRATIONS_TABLE);

  return row !== undefined;
}

function readLatestMigrationTimestamp(
  connection: NativeSqliteConnection
): number | undefined {
  const row = connection
    .prepare(
      `SELECT created_at AS createdAt FROM "${DRIZZLE_MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`
    )
    .get();

  if (!isRecord(row)) {
    return undefined;
  }

  const timestamp = Number(row.createdAt);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function hasPendingMigration(
  connection: NativeSqliteConnection,
  migrations: MigrationFile[]
): boolean {
  if (migrations.length === 0) {
    return false;
  }

  if (!hasMigrationTable(connection)) {
    return true;
  }

  const latestTimestamp = readLatestMigrationTimestamp(connection);
  return migrations.some(
    (migration) =>
      latestTimestamp === undefined || latestTimestamp < migration.folderMillis
  );
}

export async function applyMigrations(
  database: WorkspaceDatabase,
  connection: NativeSqliteConnection,
  options: ApplyMigrationsOptions
): Promise<MigrationResult> {
  const migrationsFolder = resolveMigrationFolder(options.migrationsFolder);
  const migrations = readMigrationFiles({ migrationsFolder });

  if (!hasPendingMigration(connection, migrations)) {
    return { applied: false };
  }

  let backupPath: string | undefined;
  if (options.databaseExisted) {
    backupPath = await backupBeforeMigration(
      connection,
      options.databasePath,
      options.backupDatabase
    );
  }

  drizzleMigrate(database, { migrationsFolder });
  return { applied: true, backupPath };
}
