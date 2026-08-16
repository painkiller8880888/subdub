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
    expect(firstHistory).toHaveLength(10);
    first.close();

    const second = await initializeWorkspaceDatabase({ workspaceRoot });
    expect(second.migrationResult.applied).toBe(false);
    expect(migrationHistory(second.connection)).toEqual(firstHistory);
    second.close();

    await expect(
      fs.stat(path.join(workspaceRoot, "library", "workspace.sqlite"))
    ).resolves.toBeDefined();
  });

  it("creates the decision log tables with constraints and reporting indexes", async () => {
    const workspaceRoot = await makeWorkspace();
    const initialized = await initializeWorkspaceDatabase({ workspaceRoot });
    const connection = initialized.connection;
    const tableSql = (name: string): string => {
      const row = connection
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
        )
        .get(name) as { sql: string } | undefined;
      expect(row, `table ${name}`).toBeDefined();
      return row!.sql;
    };

    expect(tableSql("ai_generation_candidates")).toContain(
      "ai_generation_candidates_task_kind_check"
    );
    expect(tableSql("improvement_decisions")).toContain(
      "improvement_decisions_after_json_check"
    );
    expect(tableSql("golden_examples")).toContain(
      "golden_examples_generation_metadata_check"
    );
    const indexes = connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND (tbl_name = 'ai_generation_candidates' OR tbl_name = 'improvement_decisions' OR tbl_name = 'golden_examples') ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "ai_generation_candidates_run_key_uq",
        "ai_generation_candidates_project_task_model_run_idx",
        "improvement_decisions_candidate_uq",
        "improvement_decisions_project_task_idx",
        "golden_examples_project_kind_payload_uq",
        "golden_examples_project_kind_revision_idx"
      ])
    );

    const now = "2026-08-11T00:00:00.000Z";
    const candidateJson = JSON.stringify({ ok: true });
    connection
      .prepare(
        `INSERT INTO ai_generation_candidates
          (candidate_id, generation_run_id, project_id, project_revision, task_kind, target_kind, target_id, candidate_key, candidate_json, candidate_checksum, model_id, response_model, prompt_version, created_at)
         VALUES (?, ?, ?, 1, 'outline_generation', 'outline', 'outline', 'outline', ?, ?, ?, NULL, '1.0.0', ?)`
      )
      .run(
        "candidate-check",
        "run-check",
        "project-check",
        candidateJson,
        "a".repeat(64),
        "model-check",
        now
      );
    expect(() =>
      connection
        .prepare(
          `INSERT INTO improvement_decisions
            (decision_id, candidate_id, project_id, project_revision_before, project_revision_after, task_kind, target_kind, target_id, decision, before_json, after_json, reason, model_id, prompt_version, created_at)
           VALUES ('decision-invalid', 'candidate-check', 'project-check', 1, 1, 'outline_generation', 'outline', 'outline', 'rejected', ?, ?, NULL, 'model-check', '1.0.0', ?)`
        )
        .run(candidateJson, candidateJson, now)
    ).toThrow();
    connection
      .prepare(
        `INSERT INTO improvement_decisions
          (decision_id, candidate_id, project_id, project_revision_before, project_revision_after, task_kind, target_kind, target_id, decision, before_json, after_json, reason, model_id, prompt_version, created_at)
         VALUES ('decision-rejected', 'candidate-check', 'project-check', 1, 1, 'outline_generation', 'outline', 'outline', 'rejected', ?, NULL, NULL, 'model-check', '1.0.0', ?)`
      )
      .run(candidateJson, now);
    expect(() =>
      connection
        .prepare(
          `INSERT INTO improvement_decisions
            (decision_id, candidate_id, project_id, project_revision_before, project_revision_after, task_kind, target_kind, target_id, decision, before_json, after_json, reason, model_id, prompt_version, created_at)
           VALUES ('decision-accepted', 'candidate-check', 'project-check', 1, 2, 'outline_generation', 'outline', 'outline', 'accepted', ?, ?, NULL, 'model-check', '1.0.0', ?)`
        )
        .run(candidateJson, candidateJson, now)
    ).toThrow();
    initialized.close();
  });

  it("applies the terminology migration with its table, indexes, and status check", async () => {
    const workspaceRoot = await makeWorkspace();
    const initialized = await initializeWorkspaceDatabase({ workspaceRoot });
    const table = initialized.connection
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'terminology_terms'"
      )
      .get() as { sql: string } | undefined;
    const indexes = initialized.connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'terminology_terms' ORDER BY name"
      )
      .all() as Array<{ name: string }>;

    expect(table?.sql).toContain("terminology_terms_status_check");
    expect(table?.sql).toContain("IN ('active', 'inactive')");
    expect(
      indexes
        .map((index) => index.name)
        .filter((name) => !name.startsWith("sqlite_autoindex_"))
    ).toEqual([
      "terminology_terms_status_idx",
      "terminology_terms_surface_uq"
    ]);
    expect(() =>
      initialized.connection
        .prepare(
          `INSERT INTO terminology_terms
            (term_id, surface, normalized_surface, reading_katakana, category, priority, notes, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "invalid-status",
          "invalid-status",
          "invalid-status",
          "イナリッド",
          "other",
          0,
          "",
          "paused",
          "2026-08-06T00:00:00.000Z",
          "2026-08-06T00:00:00.000Z"
        )
    ).toThrow();
    initialized.close();
  });

  it("creates asset library tables with checks, foreign keys, and unique constraints", async () => {
    const workspaceRoot = await makeWorkspace();
    const initialized = await initializeWorkspaceDatabase({ workspaceRoot });
    const connection = initialized.connection;

    const tableSql = (name: string): string => {
      const row = connection
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
        )
        .get(name) as { sql: string } | undefined;
      expect(row, `table ${name}`).toBeDefined();
      return row!.sql;
    };

    for (const name of [
      "assets",
      "asset_versions",
      "tags",
      "tag_aliases",
      "asset_tags"
    ]) {
      tableSql(name);
    }
    expect(tableSql("assets")).toContain("assets_kind_check");
    expect(tableSql("assets")).toContain("IN ('video', 'bgm', 'photo', 'document_scan', 'sound_effect')");
    expect(tableSql("assets")).toContain("assets_status_check");
    expect(tableSql("tags")).toContain("tags_axis_check");
    expect(tableSql("tags")).toContain("tags_status_check");

    const now = "2026-08-06T00:00:00.000Z";
    connection
      .prepare(
        `INSERT INTO assets
          (asset_id, kind, title, description, confidentiality, department, system, status, created_at, updated_at)
         VALUES (?, 'video', 't', '', 'internal', NULL, NULL, 'processing', ?, ?)`
      )
      .run("asset-a", now, now);
    connection
      .prepare(
        `INSERT INTO asset_versions
          (asset_id, version, library_media_path, mime_type, created_at, updated_at)
         VALUES (?, 1, 'media/asset-a/v1.mp4', 'video/mp4', ?, ?)`
      )
      .run("asset-a", now, now);

    expect(() =>
      connection
        .prepare(
          `INSERT INTO asset_versions
            (asset_id, version, library_media_path, mime_type, created_at, updated_at)
           VALUES (?, 1, 'media/asset-a/v1.mp4', 'video/mp4', ?, ?)`
        )
        .run("asset-a", now, now)
    ).toThrow();

    expect(() =>
      connection
        .prepare(
          `INSERT INTO asset_versions
            (asset_id, version, library_media_path, mime_type, created_at, updated_at)
           VALUES (?, 1, 'media/asset-b/v1.mp4', 'video/mp4', ?, ?)`
        )
        .run("missing-asset", now, now)
    ).toThrow();

    connection
      .prepare(
        `INSERT INTO tags
          (tag_id, axis, canonical_name, normalized_name, status, created_at, updated_at)
         VALUES (?, 'department', '現場', '現場', 'active', ?, ?)`
      )
      .run("tag-a", now, now);
    expect(() =>
      connection
        .prepare(
          `INSERT INTO tags
            (tag_id, axis, canonical_name, normalized_name, status, created_at, updated_at)
           VALUES (?, 'department', '重複', '現場', 'active', ?, ?)`
        )
        .run("tag-b", now, now)
    ).toThrow();

    connection
      .prepare(
        "INSERT INTO asset_tags (asset_id, tag_id, created_at) VALUES (?, ?, ?)"
      )
      .run("asset-a", "tag-a", now);
    expect(() =>
      connection
        .prepare(
          "INSERT INTO asset_tags (asset_id, tag_id, created_at) VALUES (?, ?, ?)"
        )
        .run("asset-a", "missing-tag", now)
    ).toThrow();
    expect(() =>
      connection
        .prepare(
          "INSERT INTO asset_tags (asset_id, tag_id, created_at) VALUES (?, ?, ?)"
        )
        .run("missing-asset", "tag-a", now)
    ).toThrow();

    expect(() =>
      connection
        .prepare(
          `INSERT INTO assets
            (asset_id, kind, title, description, confidentiality, status, created_at, updated_at)
           VALUES (?, 'invalid-kind', 't', '', 'internal', 'processing', ?, ?)`
        )
        .run("asset-c", now, now)
    ).toThrow();

    initialized.close();
  });

  it("applies the asset processing metadata migration with nullable columns once", async () => {
    const workspaceRoot = await makeWorkspace();
    const migrationsRoot = path.join(
      process.cwd(),
      "src",
      "db",
      "migrations"
    );
    const migrationTags = [
      "0000_baseline",
      "0001_curved_colleen_wing",
      "0002_asset-library",
      "0003_asset-processing-metadata",
      "0004_asset-search",
      "0005_decision-log-golden-examples",
      "0006_decision-log-single-final-decision",
      "0007_massive_madame_web",
      "0008_small_blockbuster"
    ];
    const definitions: MigrationDefinition[] = [];
    for (let index = 0; index < migrationTags.length; index++) {
      definitions.push({
        sql: await fs.readFile(
          path.join(migrationsRoot, `${migrationTags[index]}.sql`),
          "utf8"
        ),
        tag: migrationTags[index],
        when: BASE_MIGRATION_TIME + index
      });
    }

    const baselineFolder = await makeMigrationFolder(workspaceRoot, [
      definitions[0]
    ]);
    const first = await initializeWorkspaceDatabase({
      migrationsFolder: baselineFolder,
      workspaceRoot
    });
    first.close();

    const extendedFolder = await makeMigrationFolder(
      workspaceRoot,
      definitions
    );
    const second = await initializeWorkspaceDatabase({
      migrationsFolder: extendedFolder,
      workspaceRoot
    });
    expect(second.migrationResult.applied).toBe(true);
    const connection = second.connection;
    const columns = (name: string): string[] =>
      (
        connection
          .prepare(`PRAGMA table_info(${name})`)
          .all() as Array<{ name: string }>
      ).map((row) => row.name);
    expect(columns("assets")).toContain("error_code");
    expect(columns("assets")).toContain("error_message");
    expect(columns("asset_versions")).toContain("size_bytes");

    const now = "2026-08-06T00:00:00.000Z";
    connection
      .prepare(
        `INSERT INTO assets
          (asset_id, kind, title, description, confidentiality, status, error_code, error_message, created_at, updated_at)
         VALUES (?, 'video', 't', '', 'internal', 'error', 'PROCESSING_METADATA_FAILED', 'メタデータを取得できませんでした。', ?, ?)`
      )
      .run("asset-a", now, now);
    const inserted = connection
      .prepare(
        "SELECT error_code, error_message FROM assets WHERE asset_id = ?"
      )
      .get("asset-a") as {
      error_code: string;
      error_message: string;
    };
    expect(inserted.error_code).toBe("PROCESSING_METADATA_FAILED");
    expect(inserted.error_message).toBe("メタデータを取得できませんでした。");
    second.close();

    const third = await initializeWorkspaceDatabase({
      migrationsFolder: extendedFolder,
      workspaceRoot
    });
    expect(third.migrationResult.applied).toBe(false);
    expect(migrationHistory(third.connection)).toHaveLength(
      migrationTags.length
    );
    third.close();
  });

  it("applies the decision log migration to a database at 0004 exactly once", async () => {
    const workspaceRoot = await makeWorkspace();
    const migrationsRoot = path.join(process.cwd(), "src", "db", "migrations");
    const migrationTags = [
      "0000_baseline",
      "0001_curved_colleen_wing",
      "0002_asset-library",
      "0003_asset-processing-metadata",
      "0004_asset-search",
      "0005_decision-log-golden-examples",
      "0006_decision-log-single-final-decision",
      "0007_massive_madame_web",
      "0008_small_blockbuster"
    ];
    const definitions: MigrationDefinition[] = [];
    for (let index = 0; index < migrationTags.length; index += 1) {
      definitions.push({
        sql: await fs.readFile(
          path.join(migrationsRoot, `${migrationTags[index]}.sql`),
          "utf8"
        ),
        tag: migrationTags[index]!,
        when: BASE_MIGRATION_TIME + index
      });
    }
    const beforeDecisionLogFolder = await makeMigrationFolder(
      workspaceRoot,
      definitions.slice(0, 5)
    );
    const before = await initializeWorkspaceDatabase({
      migrationsFolder: beforeDecisionLogFolder,
      workspaceRoot
    });
    expect(
      before.connection
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'golden_examples'"
        )
        .get()
    ).toBeUndefined();
    before.close();

    const allMigrationsFolder = await makeMigrationFolder(
      workspaceRoot,
      definitions
    );
    const first = await initializeWorkspaceDatabase({
      migrationsFolder: allMigrationsFolder,
      workspaceRoot
    });
    expect(first.migrationResult.applied).toBe(true);
    expect(migrationHistory(first.connection)).toHaveLength(9);
    expect(
      first.connection
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'golden_examples'"
        )
        .get()
    ).toEqual({ 1: 1 });
    expect(
      first.connection
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'character_visuals'"
        )
        .get()
    ).toEqual({ 1: 1 });
    expect(
      first.connection
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'character_variants'"
        )
        .get()
    ).toEqual({ 1: 1 });
    expect(
      first.connection
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'character_variant_files'"
        )
        .get()
    ).toEqual({ 1: 1 });
    const history = migrationHistory(first.connection);
    first.close();

    const second = await initializeWorkspaceDatabase({
      migrationsFolder: allMigrationsFolder,
      workspaceRoot
    });
    expect(second.migrationResult.applied).toBe(false);
    expect(migrationHistory(second.connection)).toEqual(history);
    second.close();
  });

  it("applies the new migration to an already-baselined database only once", async () => {
    const workspaceRoot = await makeWorkspace();
    const terminologyMigration = await fs.readFile(
      path.join(
        process.cwd(),
        "src",
        "db",
        "migrations",
        "0001_curved_colleen_wing.sql"
      ),
      "utf8"
    );
    const baseline = {
      sql: "SELECT 1;",
      tag: "0000_baseline",
      when: BASE_MIGRATION_TIME
    };
    const baselineFolder = await makeMigrationFolder(workspaceRoot, [baseline]);
    const first = await initializeWorkspaceDatabase({
      migrationsFolder: baselineFolder,
      workspaceRoot
    });
    first.close();

    const extendedFolder = await makeMigrationFolder(workspaceRoot, [
      baseline,
      {
        sql: terminologyMigration,
        tag: "0001_curved_colleen_wing",
        when: BASE_MIGRATION_TIME + 1
      }
    ]);
    const second = await initializeWorkspaceDatabase({
      migrationsFolder: extendedFolder,
      workspaceRoot
    });
    expect(second.migrationResult.applied).toBe(true);
    expect(countRows(second.connection, "terminology_terms")).toBe(0);
    const history = migrationHistory(second.connection);
    expect(history).toHaveLength(2);
    second.close();

    const third = await initializeWorkspaceDatabase({
      migrationsFolder: extendedFolder,
      workspaceRoot
    });
    expect(third.migrationResult.applied).toBe(false);
    expect(migrationHistory(third.connection)).toEqual(history);
    third.close();
  });

  it("preserves existing character variants and backfills active status", async () => {
    const workspaceRoot = await makeWorkspace();
    const migrationsRoot = path.join(process.cwd(), "src", "db", "migrations");
    const migrationTags = [
      "0000_baseline",
      "0001_curved_colleen_wing",
      "0002_asset-library",
      "0003_asset-processing-metadata",
      "0004_asset-search",
      "0005_decision-log-golden-examples",
      "0006_decision-log-single-final-decision",
      "0007_massive_madame_web",
      "0008_small_blockbuster"
    ];
    const definitions: MigrationDefinition[] = [];
    for (let index = 0; index < migrationTags.length; index += 1) {
      definitions.push({
        sql: await fs.readFile(
          path.join(migrationsRoot, `${migrationTags[index]}.sql`),
          "utf8"
        ),
        tag: migrationTags[index]!,
        when: BASE_MIGRATION_TIME + index
      });
    }

    const before = await initializeWorkspaceDatabase({
      migrationsFolder: await makeMigrationFolder(
        workspaceRoot,
        definitions.slice(0, 8)
      ),
      workspaceRoot
    });
    const now = "2026-08-14T00:00:00.000Z";
    before.connection
      .prepare(
        `INSERT INTO character_visuals
          (visual_id, name, description, status, base_width, base_height, created_at, updated_at)
         VALUES ('legacy-visual', 'Legacy', '', 'active', 600, 1000, ?, ?)`
      )
      .run(now, now);
    before.connection
      .prepare(
        `INSERT INTO character_variants
          (variant_id, visual_id, label, render_type, tags, created_at, updated_at)
         VALUES ('legacy-variant', 'legacy-visual', 'Legacy', 'single-image', '[]', ?, ?)`
      )
      .run(now, now);
    before.connection
      .prepare(
        `INSERT INTO character_variant_files
          (variant_id, file_key, library_path, mime_type, checksum, size_bytes, width, height, created_at, updated_at)
         VALUES ('legacy-variant', 'single', 'library/character-visuals/legacy-visual/legacy-variant/single.png', 'image/png', ?, 3, 600, 1000, ?, ?)`
      )
      .run("a".repeat(64), now, now);
    before.close();

    const after = await initializeWorkspaceDatabase({
      migrationsFolder: await makeMigrationFolder(workspaceRoot, definitions),
      workspaceRoot
    });
    expect(after.migrationResult.applied).toBe(true);
    const variant = after.connection
      .prepare(
        "SELECT variant_id, visual_id, label, render_type, status, tags FROM character_variants WHERE variant_id = ?"
      )
      .get("legacy-variant");
    expect(variant).toEqual({
      variant_id: "legacy-variant",
      visual_id: "legacy-visual",
      label: "Legacy",
      render_type: "single-image",
      status: "active",
      tags: "[]"
    });
    expect(countRows(after.connection, "character_variant_files")).toBe(1);
    const tableSql = after.connection
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'character_variants'"
      )
      .get() as { sql: string };
    expect(tableSql.sql).toContain("character_variants_status_check");
    after.close();
  });

  it("backfills assets, tags, and aliases that predate the search migration", async () => {
    const workspaceRoot = await makeWorkspace();
    const migrationsRoot = path.join(process.cwd(), "src", "db", "migrations");
    const migrationTags = [
      "0000_baseline",
      "0001_curved_colleen_wing",
      "0002_asset-library",
      "0003_asset-processing-metadata",
      "0004_asset-search",
      "0005_decision-log-golden-examples",
      "0006_decision-log-single-final-decision",
      "0007_massive_madame_web",
      "0008_small_blockbuster"
    ];
    const definitions: MigrationDefinition[] = [];
    for (let index = 0; index < migrationTags.length; index++) {
      definitions.push({
        sql: await fs.readFile(
          path.join(migrationsRoot, `${migrationTags[index]}.sql`),
          "utf8"
        ),
        tag: migrationTags[index],
        when: BASE_MIGRATION_TIME + index
      });
    }

    const beforeSearchFolder = await makeMigrationFolder(
      workspaceRoot,
      definitions.slice(0, 4)
    );
    const beforeSearch = await initializeWorkspaceDatabase({
      migrationsFolder: beforeSearchFolder,
      workspaceRoot
    });
    const now = "2026-08-07T00:00:00.000Z";
    beforeSearch.connection
      .prepare(
        `INSERT INTO assets
          (asset_id, kind, title, description, confidentiality, department, system, status, created_at, updated_at)
         VALUES ('asset-before-search', 'photo', '移行前タイトル', '移行前説明', 'internal', '総務部', '申請システム', 'active', ?, ?)`
      )
      .run(now, now);
    beforeSearch.connection
      .prepare(
        `INSERT INTO tags
          (tag_id, axis, canonical_name, normalized_name, status, created_at, updated_at)
         VALUES ('tag-before-search', 'task', '移行タグ', '移行タグ', 'active', ?, ?)`
      )
      .run(now, now);
    beforeSearch.connection
      .prepare(
        `INSERT INTO tag_aliases
          (alias_id, tag_id, alias, normalized_alias, created_at)
         VALUES ('alias-before-search', 'tag-before-search', '移行別名', '移行別名', ?)`
      )
      .run(now);
    beforeSearch.connection
      .prepare(
        "INSERT INTO asset_tags (asset_id, tag_id, created_at) VALUES ('asset-before-search', 'tag-before-search', ?)"
      )
      .run(now);
    beforeSearch.close();

    const afterSearchFolder = await makeMigrationFolder(workspaceRoot, definitions);
    const afterSearch = await initializeWorkspaceDatabase({
      migrationsFolder: afterSearchFolder,
      workspaceRoot
    });
    expect(
      afterSearch.connection
        .prepare(
          "SELECT asset_id FROM asset_search WHERE asset_search MATCH ?"
        )
        .all("移行別名")
    ).toEqual([{ asset_id: "asset-before-search" }]);
    afterSearch.close();
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
