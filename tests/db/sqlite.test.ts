import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { BackupDatabase } from "../../src/db/backup.js";
import {
  openNativeDatabase,
  SQLITE_BUSY_TIMEOUT_MS
} from "../../src/db/connection.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import { initializeServer } from "../../src/api/server.js";

type MigrationDefinition = {
  tag: string;
  when: number;
  sql: string;
};

const BASE_MIGRATION_TIME = 1_750_000_000_000;

describe("workspace SQLite", () => {
  const workspaceRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      workspaceRoots.splice(0).map((workspaceRoot) =>
        fs.rm(workspaceRoot, { recursive: true, force: true })
      )
    );
  });

  async function makeWorkspace(): Promise<string> {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-sqlite-")
    );
    workspaceRoots.push(workspaceRoot);
    return workspaceRoot;
  }

  async function makeMigrationFolder(
    workspaceRoot: string,
    migrations: MigrationDefinition[]
  ): Promise<string> {
    const migrationsFolder = await fs.mkdtemp(
      path.join(workspaceRoot, "migrations-")
    );
    await fs.mkdir(path.join(migrationsFolder, "meta"), { recursive: true });

    for (const migration of migrations) {
      await fs.writeFile(
        path.join(migrationsFolder, `${migration.tag}.sql`),
        migration.sql,
        "utf8"
      );
    }

    await fs.writeFile(
      path.join(migrationsFolder, "meta", "_journal.json"),
      JSON.stringify({
        dialect: "sqlite",
        entries: migrations.map((migration, idx) => ({
          breakpoints: true,
          idx,
          tag: migration.tag,
          version: "7",
          when: migration.when
        })),
        version: "7"
      }),
      "utf8"
    );

    return migrationsFolder;
  }

  function countRows(
    connection: { prepare(source: string): { get(): unknown } },
    tableName: string
  ): number {
    const row = connection
      .prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`)
      .get();
    if (typeof row !== "object" || row === null || !("count" in row)) {
      throw new Error(`Could not read row count for ${tableName}.`);
    }

    return Number((row as { count: number }).count);
  }

  function migrationHistory(
    connection: { prepare(source: string): { all(): unknown[] } }
  ): Array<Record<string, unknown>> {
    return connection
      .prepare(
        "SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY id"
      )
      .all()
      .map((row) => row as Record<string, unknown>);
  }

  it("creates an empty workspace DB and records the baseline once", async () => {
    const workspaceRoot = await makeWorkspace();

    const first = await initializeWorkspaceDatabase({ workspaceRoot });
    const firstHistory = migrationHistory(first.connection);
    expect(first.migrationResult.applied).toBe(true);
    expect(firstHistory).toHaveLength(1);
    first.close();

    const second = await initializeWorkspaceDatabase({ workspaceRoot });
    expect(second.migrationResult.applied).toBe(false);
    expect(migrationHistory(second.connection)).toEqual(firstHistory);
    second.close();

    await expect(
      fs.stat(path.join(workspaceRoot, "library", "workspace.sqlite"))
    ).resolves.toBeDefined();
  });

  it("does not repeat a migration side effect on reinitialization", async () => {
    const workspaceRoot = await makeWorkspace();
    const migrationsFolder = await makeMigrationFolder(workspaceRoot, [
      {
        sql: `
CREATE TABLE side_effects (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO side_effects (id, value) VALUES (1, 'once');
`,
        tag: "0000_side_effect",
        when: BASE_MIGRATION_TIME
      }
    ]);

    const first = await initializeWorkspaceDatabase({
      migrationsFolder,
      workspaceRoot
    });
    first.close();

    const second = await initializeWorkspaceDatabase({
      migrationsFolder,
      workspaceRoot
    });
    expect(countRows(second.connection, "side_effects")).toBe(1);
    expect(migrationHistory(second.connection)).toHaveLength(1);
    second.close();
  });

  it("sets and verifies SQLite foreign keys, WAL, and busy timeout", async () => {
    const workspaceRoot = await makeWorkspace();
    const initialized = await initializeWorkspaceDatabase({ workspaceRoot });

    expect(
      initialized.connection.pragma("foreign_keys", { simple: true })
    ).toBe(1);
    expect(
      String(
        initialized.connection.pragma("journal_mode", { simple: true })
      ).toLowerCase()
    ).toBe("wal");
    expect(
      initialized.connection.pragma("busy_timeout", { simple: true })
    ).toBe(SQLITE_BUSY_TIMEOUT_MS);

    initialized.close();
  });

  it("backs up an existing DB before applying a pending migration", async () => {
    const workspaceRoot = await makeWorkspace();
    const firstMigrations = await makeMigrationFolder(workspaceRoot, [
      {
        sql: `
CREATE TABLE existing_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO existing_rows (id, value) VALUES (1, 'kept');
`,
        tag: "0000_existing",
        when: BASE_MIGRATION_TIME
      }
    ]);
    const pendingMigrations = await makeMigrationFolder(workspaceRoot, [
      ...(await readMigrationDefinitions(firstMigrations)),
      {
        sql: `
CREATE TABLE pending_rows (id INTEGER PRIMARY KEY);
--> statement-breakpoint
INSERT INTO pending_rows (id) VALUES (1);
`,
        tag: "0001_pending",
        when: BASE_MIGRATION_TIME + 1
      }
    ]);

    const first = await initializeWorkspaceDatabase({
      migrationsFolder: firstMigrations,
      workspaceRoot
    });
    first.close();

    const second = await initializeWorkspaceDatabase({
      migrationsFolder: pendingMigrations,
      workspaceRoot
    });
    const databasePath = second.databasePath;
    second.close();

    const backupNames = (await fs.readdir(path.dirname(databasePath))).filter(
      (name) =>
        name.startsWith(`${path.basename(databasePath)}.pre-migration-`) &&
        name.endsWith(".bak")
    );
    expect(backupNames).toHaveLength(1);
    const backup = await openNativeDatabase(
      path.join(path.dirname(databasePath), backupNames[0])
    );
    expect(countRows(backup, "existing_rows")).toBe(1);
    backup.close();
    const inspected = await initializeWorkspaceDatabase({
      migrationsFolder: pendingMigrations,
      workspaceRoot
    });
    expect(countRows(inspected.connection, "pending_rows")).toBe(1);
    inspected.close();
  });

  it("does not start migration when backup creation fails", async () => {
    const workspaceRoot = await makeWorkspace();
    const firstMigrations = await makeMigrationFolder(workspaceRoot, [
      {
        sql: "CREATE TABLE existing_rows (id INTEGER PRIMARY KEY);",
        tag: "0000_existing",
        when: BASE_MIGRATION_TIME
      }
    ]);
    const pendingMigrations = await makeMigrationFolder(workspaceRoot, [
      ...(await readMigrationDefinitions(firstMigrations)),
      {
        sql: "CREATE TABLE should_not_exist (id INTEGER PRIMARY KEY);",
        tag: "0001_pending",
        when: BASE_MIGRATION_TIME + 1
      }
    ]);
    const first = await initializeWorkspaceDatabase({
      migrationsFolder: firstMigrations,
      workspaceRoot
    });
    first.close();

    const failingBackup: BackupDatabase = async () => {
      throw new Error("backup failed for test");
    };
    await expect(
      initializeWorkspaceDatabase({
        backupDatabase: failingBackup,
        migrationsFolder: pendingMigrations,
        workspaceRoot
      })
    ).rejects.toThrow("backup failed for test");

    const inspected = await initializeWorkspaceDatabase({
      migrationsFolder: firstMigrations,
      workspaceRoot
    });
    expect(migrationHistory(inspected.connection)).toHaveLength(1);
    expect(
      inspected.connection
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'should_not_exist'"
        )
        .get()
    ).toBeUndefined();
    inspected.close();
  });

  it("rolls back a failed migration and preserves existing rows", async () => {
    const workspaceRoot = await makeWorkspace();
    const firstMigrations = await makeMigrationFolder(workspaceRoot, [
      {
        sql: `
CREATE TABLE existing_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO existing_rows (id, value) VALUES (1, 'original');
`,
        tag: "0000_existing",
        when: BASE_MIGRATION_TIME
      }
    ]);
    const failedMigrations = await makeMigrationFolder(workspaceRoot, [
      ...(await readMigrationDefinitions(firstMigrations)),
      {
        sql: `
CREATE TABLE partial_rows (id INTEGER PRIMARY KEY);
--> statement-breakpoint
INSERT INTO existing_rows (id, value) VALUES (2, 'should rollback');
--> statement-breakpoint
THIS IS NOT VALID SQL;
`,
        tag: "0001_failed",
        when: BASE_MIGRATION_TIME + 1
      }
    ]);

    const first = await initializeWorkspaceDatabase({
      migrationsFolder: firstMigrations,
      workspaceRoot
    });
    first.close();

    await expect(
      initializeServer({
        migrationsFolder: failedMigrations,
        workspaceRoot
      })
    ).rejects.toThrow();

    const inspected = await initializeWorkspaceDatabase({
      migrationsFolder: firstMigrations,
      workspaceRoot
    });
    expect(migrationHistory(inspected.connection)).toHaveLength(1);
    expect(countRows(inspected.connection, "existing_rows")).toBe(1);
    expect(
      inspected.connection
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partial_rows'"
        )
        .get()
    ).toBeUndefined();
    inspected.close();

    const backupNames = (await fs.readdir(path.join(workspaceRoot, "library"))).filter(
      (name) => name.endsWith(".bak")
    );
    expect(backupNames).toHaveLength(1);
  });

  it("rolls back all writes in a Drizzle transaction after an exception", async () => {
    const workspaceRoot = await makeWorkspace();
    const migrationsFolder = await makeMigrationFolder(workspaceRoot, [
      {
        sql: "CREATE TABLE transaction_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
        tag: "0000_transaction",
        when: BASE_MIGRATION_TIME
      }
    ]);
    const initialized = await initializeWorkspaceDatabase({
      migrationsFolder,
      workspaceRoot
    });

    expect(() => {
      initialized.database.transaction((transaction) => {
        transaction.run(
          sql`INSERT INTO transaction_rows (id, value) VALUES (1, ${"first"})`
        );
        transaction.run(
          sql`INSERT INTO transaction_rows (id, value) VALUES (2, ${"second"})`
        );
        throw new Error("rollback transaction");
      });
    }).toThrow("rollback transaction");
    expect(countRows(initialized.connection, "transaction_rows")).toBe(0);
    initialized.close();
  });

  it("rejects missing and malformed migration folders", async () => {
    const workspaceRoot = await makeWorkspace();
    await expect(
      initializeWorkspaceDatabase({
        migrationsFolder: path.join(workspaceRoot, "missing-migrations"),
        workspaceRoot
      })
    ).rejects.toThrow("meta/_journal.json");

    const malformedFolder = await fs.mkdtemp(
      path.join(workspaceRoot, "malformed-migrations-")
    );
    await fs.mkdir(path.join(malformedFolder, "meta"), { recursive: true });
    await fs.writeFile(
      path.join(malformedFolder, "meta", "_journal.json"),
      "{not valid json",
      "utf8"
    );
    await expect(
      initializeWorkspaceDatabase({
        migrationsFolder: malformedFolder,
        workspaceRoot
      })
    ).rejects.toThrow();
  });

  it("closes the DB connection through Fastify close", async () => {
    const workspaceRoot = await makeWorkspace();
    const initialized = await initializeServer({ workspaceRoot });

    expect(initialized.database.connection.open).toBe(true);
    await initialized.app.close();
    expect(initialized.database.connection.open).toBe(false);
  });
});

async function readMigrationDefinitions(
  migrationsFolder: string
): Promise<MigrationDefinition[]> {
  const journal = JSON.parse(
    await fs.readFile(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")
  ) as {
    entries: Array<{ tag: string; when: number }>;
  };

  return Promise.all(
    journal.entries.map(async (entry) => ({
      sql: await fs.readFile(path.join(migrationsFolder, `${entry.tag}.sql`), "utf8"),
      tag: entry.tag,
      when: entry.when
    }))
  );
}
