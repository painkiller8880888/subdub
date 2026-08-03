import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export interface SqliteStatement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): unknown;
}

export interface NativeSqliteConnection {
  readonly open: boolean;
  backup(destinationPath: string): Promise<unknown>;
  close(): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): SqliteStatement;
}

interface BetterSqlite3Constructor {
  new (databasePath: string): NativeSqliteConnection;
}

const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Constructor;

export async function openNativeDatabase(
  databasePath: string
): Promise<NativeSqliteConnection> {
  const resolvedDatabasePath = path.resolve(databasePath);
  await mkdir(path.dirname(resolvedDatabasePath), { recursive: true });

  const connection = new BetterSqlite3(resolvedDatabasePath);

  try {
    connection.pragma("foreign_keys = ON");
    const foreignKeys = connection.pragma("foreign_keys", { simple: true });
    if (foreignKeys !== 1) {
      throw new Error("SQLite foreign_keys pragma was not enabled.");
    }

    const journalMode = connection.pragma("journal_mode = WAL", {
      simple: true
    });
    if (String(journalMode).toLowerCase() !== "wal") {
      throw new Error("SQLite journal_mode pragma was not set to WAL.");
    }

    connection.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    const busyTimeout = connection.pragma("busy_timeout", { simple: true });
    if (Number(busyTimeout) !== SQLITE_BUSY_TIMEOUT_MS) {
      throw new Error("SQLite busy_timeout pragma was not configured.");
    }

    return connection;
  } catch (error) {
    closeNativeDatabase(connection);
    throw error;
  }
}

export function closeNativeDatabase(connection: NativeSqliteConnection): void {
  if (connection.open) {
    connection.close();
  }
}
