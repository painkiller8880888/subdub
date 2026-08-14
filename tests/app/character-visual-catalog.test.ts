import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CharacterVisualCatalogService,
  CharacterVisualRepository
} from "../../src/app/character-visuals/index.js";
import { characterVisualSnapshotToVariantCatalog } from "../../src/assets/character-asset-manifest.js";
import {
  legacyCharacterVisualDescriptions,
  legacyCharacterVisualNames,
  legacyCharacterVisualSeed
} from "../../src/app/character-visuals/character-visual-seed.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import { characterVisualSetSchema } from "../../src/schema/character-visual.js";
import { validateCharacterVisualCatalog } from "../../src/validation/character-visuals.js";

describe("character visual catalog", () => {
  const workspaceRoots: string[] = [];
  const databases: Awaited<ReturnType<typeof initializeWorkspaceDatabase>>[] =
    [];

  afterEach(async () => {
    for (const database of databases.splice(0)) {
      if (database.connection.open) {
        database.close();
      }
    }
    await Promise.all(
      workspaceRoots
        .splice(0)
        .map((workspaceRoot) =>
          fs.rm(workspaceRoot, { recursive: true, force: true })
        )
    );
  });

  async function makeService() {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-character-visuals-")
    );
    workspaceRoots.push(workspaceRoot);
    const database = await initializeWorkspaceDatabase({ workspaceRoot });
    databases.push(database);
    const repository = new CharacterVisualRepository(database.database);
    return {
      database,
      repository,
      service: new CharacterVisualCatalogService({
        repository,
        workspaceRoot,
        now: () => new Date("2026-08-14T00:00:00.000Z")
      }),
      workspaceRoot
    };
  }

  it("migrates the legacy assets into an idempotent 2/6/10 catalog", async () => {
    const { database, repository, service, workspaceRoot } =
      await makeService();
    const sourceRoot = path.join(process.cwd(), "doc", "assets");

    const first = await service.seedLegacyCatalog({
      sourceRoot,
      catalog: legacyCharacterVisualSeed,
      names: legacyCharacterVisualNames,
      descriptions: legacyCharacterVisualDescriptions
    });
    expect(first).toHaveLength(2);
    expect(first.map((visual) => visual.variants.length)).toEqual([3, 3]);
    expect(
      first.flatMap((visual) =>
        visual.variants.flatMap((variant) => variant.files)
      )
    ).toHaveLength(10);
    expect(first.every((visual) => visual.baseWidth === 600)).toBe(true);
    expect(first.every((visual) => visual.baseHeight === 1000)).toBe(true);
    const compatibilityCatalog = characterVisualSnapshotToVariantCatalog(first);
    expect(compatibilityCatalog).toHaveLength(6);
    expect(
      compatibilityCatalog
        .flatMap((variant) => variant.files)
        .every((file) =>
          file.destinationPath.startsWith("library/character-visuals/")
        )
    ).toBe(true);

    for (const visual of first) {
      for (const variant of visual.variants) {
        for (const file of variant.files) {
          const managedFile = path.join(workspaceRoot, file.libraryPath);
          expect((await fs.stat(managedFile)).isFile()).toBe(true);
          expect(file.libraryPath).toContain("library/character-visuals/");
        }
      }
    }

    const counts = (table: string): number => {
      const row = database.connection
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count: number };
      return row.count;
    };
    expect(counts("character_visuals")).toBe(2);
    expect(counts("character_variants")).toBe(6);
    expect(counts("character_variant_files")).toBe(10);

    const second = await service.seedLegacyCatalog({
      sourceRoot,
      catalog: legacyCharacterVisualSeed,
      names: legacyCharacterVisualNames,
      descriptions: legacyCharacterVisualDescriptions
    });
    expect(second).toEqual(first);
    expect(repository.list()).toEqual(first);
    expect(counts("character_visuals")).toBe(2);
    expect(counts("character_variants")).toBe(6);
    expect(counts("character_variant_files")).toBe(10);
  });

  it("allows an empty visual while rejecting incomplete variants", async () => {
    const { service } = await makeService();
    const visual = service.create({ name: "Partial visual" });
    expect(visual).toMatchObject({
      name: "Partial visual",
      baseWidth: null,
      baseHeight: null,
      variants: []
    });

    const invalid = characterVisualSetSchema.safeParse({
      ...visual,
      variants: [
        {
          variantId: "partial-variant",
          label: "Partial",
          renderType: "mouth-pair",
          tags: [],
          files: []
        }
      ],
      baseWidth: 600,
      baseHeight: 1000
    });
    expect(invalid.success).toBe(false);
  });

  it("rejects unsafe managed paths, duplicate IDs, and mismatched canvas metadata", async () => {
    const { service } = await makeService();
    const visual = service.create({ name: "Visual" });
    const validFile = {
      key: "single",
      libraryPath: `library/character-visuals/${visual.visualId}/variant/single.png`,
      mimeType: "image/png" as const,
      checksum: "a".repeat(64),
      sizeBytes: 1,
      width: 600,
      height: 1000
    };
    const result = validateCharacterVisualCatalog([
      {
        ...visual,
        baseWidth: 600,
        baseHeight: 1000,
        variants: [
          {
            variantId: "variant",
            label: "Variant",
            renderType: "single-image",
            tags: [],
            files: [validFile]
          },
          {
            variantId: "variant",
            label: "Duplicate",
            renderType: "single-image",
            tags: [],
            files: [
              {
                ...validFile,
                libraryPath: `library/character-visuals/${visual.visualId}/variant/../escape.png`,
                width: 601
              }
            ]
          }
        ]
      }
    ]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("variantId"))
    ).toBe(true);
    expect(
      result.issues.some((issue) => issue.message.includes("canvas"))
    ).toBe(true);
  });

  it("rolls back all catalog rows when a transaction fails", async () => {
    const { repository } = await makeService();
    expect(() =>
      repository.transaction((transaction) => {
        transaction.insertVisual({
          visualId: "rollback-visual",
          name: "Rollback",
          description: "",
          status: "active",
          baseWidth: null,
          baseHeight: null,
          createdAt: "2026-08-14T00:00:00.000Z",
          updatedAt: "2026-08-14T00:00:00.000Z"
        });
        throw new Error("force rollback");
      })
    ).toThrow("force rollback");
    expect(repository.list()).toEqual([]);
  });
});
