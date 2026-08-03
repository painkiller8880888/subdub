import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import * as path from "node:path";

import type { NativeSqliteConnection } from "./connection.js";

export type BackupDatabase = (
  connection: NativeSqliteConnection,
  destinationPath: string
) => Promise<void>;

export function makeMigrationBackupPath(
  databasePath: string,
  now = new Date(),
  uniqueId = randomUUID()
): string {
  const timestamp = now.toISOString().replace(/[-:.]/g, "");
  const fileName = `${path.basename(
    databasePath
  )}.pre-migration-${timestamp}-${uniqueId}.bak`;
  return path.join(path.dirname(databasePath), fileName);
}

export async function backupBeforeMigration(
  connection: NativeSqliteConnection,
  databasePath: string,
  backupDatabase: BackupDatabase = (source, destinationPath) =>
    source.backup(destinationPath).then(() => undefined)
): Promise<string> {
  const backupPath = makeMigrationBackupPath(databasePath);

  try {
    await backupDatabase(connection, backupPath);
    return backupPath;
  } catch (error) {
    await rm(backupPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
