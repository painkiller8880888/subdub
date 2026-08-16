import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";

type MigrationDefinition = {
  tag: string;
  when: number;
  sql: string;
};

const MIGRATION_TAGS = [
  "0000_baseline",
  "0001_curved_colleen_wing",
  "0002_asset-library",
  "0003_asset-processing-metadata",
  "0004_asset-search",
  "0005_decision-log-golden-examples",
  "0006_decision-log-single-final-decision",
  "0007_massive_madame_web",
  "0008_small_blockbuster",
  "0009_black_mandroid"
] as const;

async function readDefinitions(): Promise<MigrationDefinition[]> {
  const root = path.join(process.cwd(), "src", "db", "migrations");
  return Promise.all(
    MIGRATION_TAGS.map(async (tag, index) => ({
      tag,
      when: 1_750_000_000_000 + index,
      sql: await fs.readFile(path.join(root, `${tag}.sql`), "utf8")
    }))
  );
}

async function makeMigrationFolder(
  workspaceRoot: string,
  definitions: readonly MigrationDefinition[]
): Promise<string> {
  const folder = await fs.mkdtemp(path.join(workspaceRoot, "migrations-"));
  await fs.mkdir(path.join(folder, "meta"), { recursive: true });
  for (const definition of definitions) {
    await fs.writeFile(
      path.join(folder, `${definition.tag}.sql`),
      definition.sql,
      "utf8"
    );
  }
  await fs.writeFile(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: definitions.map((definition, idx) => ({
        idx,
        version: "7",
        when: definition.when,
        tag: definition.tag,
        breakpoints: true
      }))
    }),
    "utf8"
  );
  return folder;
}

describe("BGM asset migration", () => {
  const workspaceRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      workspaceRoots.splice(0).map((root) =>
        fs.rm(root, { recursive: true, force: true })
      )
    );
  });

  it("preserves existing rows, tag links, statuses, and FTS synchronization", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), "subdub-bgm-migration-"));
    workspaceRoots.push(workspaceRoot);
    const definitions = await readDefinitions();

    const before = await initializeWorkspaceDatabase({
      workspaceRoot,
      migrationsFolder: await makeMigrationFolder(
        workspaceRoot,
        definitions.slice(0, 9)
      )
    });
    const now = "2026-08-15T00:00:00.000Z";
    before.connection
      .prepare(
        `INSERT INTO assets
          (asset_id, kind, title, description, confidentiality, department, system, status, created_at, updated_at)
         VALUES ('legacy-video', 'video', 'legacyword', 'legacy description', 'internal', 'ops', 'legacy-system', 'inactive', ?, ?)`
      )
      .run(now, now);
    before.connection
      .prepare(
        `INSERT INTO asset_versions
          (asset_id, version, library_media_path, mime_type, checksum, size_bytes, width, height, duration_ms, page_count, created_at, updated_at)
         VALUES ('legacy-video', 1, 'media/legacy-video/v1.avi', 'video/x-msvideo', ?, 123, 640, 480, 3000, NULL, ?, ?)`
      )
      .run("a".repeat(64), now, now);
    before.connection
      .prepare(
        `INSERT INTO tags
          (tag_id, axis, canonical_name, normalized_name, status, created_at, updated_at)
         VALUES ('legacy-tag', 'task', 'legacytag', 'legacytag', 'active', ?, ?)`
      )
      .run(now, now);
    before.connection
      .prepare(
        `INSERT INTO tag_aliases
          (alias_id, tag_id, alias, normalized_alias, created_at)
         VALUES ('legacy-alias', 'legacy-tag', 'legacyalias', 'legacyalias', ?)`
      )
      .run(now);
    before.connection
      .prepare(
        `INSERT INTO asset_tags (asset_id, tag_id, created_at)
         VALUES ('legacy-video', 'legacy-tag', ?)`
      )
      .run(now);
    expect(
      before.connection
        .prepare("SELECT asset_id FROM asset_search WHERE asset_search MATCH ?")
        .all("legacyalias")
    ).toEqual([{ asset_id: "legacy-video" }]);
    before.close();

    const after = await initializeWorkspaceDatabase({
      workspaceRoot,
      migrationsFolder: await makeMigrationFolder(workspaceRoot, definitions)
    });
    expect(after.migrationResult.applied).toBe(true);

    expect(
      after.connection
        .prepare(
          "SELECT kind, title, status, department, system FROM assets WHERE asset_id = 'legacy-video'"
        )
        .get()
    ).toEqual({
      kind: "video",
      title: "legacyword",
      status: "inactive",
      department: "ops",
      system: "legacy-system"
    });
    expect(
      after.connection
        .prepare(
          "SELECT library_media_path, mime_type, checksum, width, height, duration_ms FROM asset_versions WHERE asset_id = 'legacy-video' AND version = 1"
        )
        .get()
    ).toEqual({
      library_media_path: "media/legacy-video/v1.avi",
      mime_type: "video/x-msvideo",
      checksum: "a".repeat(64),
      width: 640,
      height: 480,
      duration_ms: 3000
    });
    expect(
      after.connection
        .prepare("SELECT tag_id FROM asset_tags WHERE asset_id = 'legacy-video'")
        .all()
    ).toEqual([{ tag_id: "legacy-tag" }]);
    expect(
      after.connection
        .prepare("SELECT asset_id FROM asset_search WHERE asset_search MATCH ?")
        .all("legacyalias")
    ).toEqual([{ asset_id: "legacy-video" }]);

    after.connection
      .prepare(
        "UPDATE assets SET title = 'updatedword', status = 'active', updated_at = ? WHERE asset_id = 'legacy-video'"
      )
      .run("2026-08-16T00:00:00.000Z");
    expect(
      after.connection
        .prepare("SELECT asset_id FROM asset_search WHERE asset_search MATCH ?")
        .all("updatedword")
    ).toEqual([{ asset_id: "legacy-video" }]);

    after.connection
      .prepare(
        `INSERT INTO assets
          (asset_id, kind, title, description, confidentiality, department, system, status, created_at, updated_at)
         VALUES ('new-bgm', 'bgm', 'music', '', 'internal', NULL, NULL, 'processing', ?, ?)`
      )
      .run(now, now);
    expect(
      after.connection
        .prepare("SELECT kind, status FROM assets WHERE asset_id = 'new-bgm'")
        .get()
    ).toEqual({ kind: "bgm", status: "processing" });
    expect(() =>
      after.connection
        .prepare(
          `INSERT INTO assets
            (asset_id, kind, title, description, confidentiality, status, created_at, updated_at)
           VALUES ('bad-kind', 'audio', 'bad', '', 'internal', 'processing', ?, ?)`
        )
        .run(now, now)
    ).toThrow();

    const triggerNames = after.connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'asset_search_assets_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    expect(triggerNames.map((row) => row.name)).toEqual([
      "asset_search_assets_ad",
      "asset_search_assets_ai",
      "asset_search_assets_au"
    ]);
    after.close();
  });
});
