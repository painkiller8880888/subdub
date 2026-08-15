import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CharacterVisualCatalogService,
  CharacterVisualRepository
} from "../../src/app/character-visuals/index.js";
import {
  characterVisualSnapshotToAssetMetadata,
  characterVisualSnapshotToVariantCatalog
} from "../../src/assets/character-asset-manifest.js";
import {
  legacyCharacterVisualDescriptions,
  legacyCharacterVisualNames,
  legacyCharacterVisualSeed
} from "../../src/app/character-visuals/character-visual-seed.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import { characterVisualSetSchema } from "../../src/schema/character-visual.js";
import { validateCharacterVisualCatalog } from "../../src/validation/character-visuals.js";
import { compileRenderManifest } from "../../src/app/rendering/render-manifest-compiler.js";
import { createRenderManifestInput } from "../fixtures/render-manifest-input.js";
import { makeTransparentPng, pngBytes } from "../fixtures/asset-fixtures.js";

describe("character visual catalog", { timeout: 30_000 }, () => {
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

    const compilerInput = createRenderManifestInput(undefined, {
      characterVariantCatalog: compatibilityCatalog,
      assetMetadata: [
        ...(createRenderManifestInput().assetMetadata ?? []),
        ...characterVisualSnapshotToAssetMetadata(first)
      ]
    });
    const compiled = compileRenderManifest(compilerInput);
    expect(compiled.success).toBe(true);
    if (compiled.success) {
      expect(
        compiled.manifest.characterVariants
          .flatMap((variant) => Object.values(variant.files))
          .every((file) => file.path.startsWith("library/character-visuals/"))
      ).toBe(true);
    }

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

  it("does not require the legacy source after the initial seed", async () => {
    const { service } = await makeService();
    const sourceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-character-seed-source-")
    );
    try {
      await fs.cp(path.join(process.cwd(), "doc", "assets"), sourceRoot, {
        recursive: true
      });
      const first = await service.seedLegacyCatalog({
        sourceRoot,
        catalog: legacyCharacterVisualSeed,
        names: legacyCharacterVisualNames,
        descriptions: legacyCharacterVisualDescriptions
      });

      await fs.rm(sourceRoot, { recursive: true, force: true });

      await expect(
        service.seedLegacyCatalog({
          sourceRoot,
          catalog: legacyCharacterVisualSeed,
          names: legacyCharacterVisualNames,
          descriptions: legacyCharacterVisualDescriptions
        })
      ).resolves.toEqual(first);
    } finally {
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
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

  it("persists variant deactivation, keeps the row, and allows reactivation", async () => {
    const { service, repository, database, workspaceRoot } =
      await makeService();
    const visual = service.create({ name: "Status visual" });
    const withVariant = await service.createVariant(visual.visualId, {
      label: "Status variant",
      renderType: "single-image",
      tags: [],
      files: [
        {
          key: "single",
          content: pngBytes,
          mimeType: "image/png",
          filename: "ignored-by-server.png"
        }
      ]
    });
    const variantId = withVariant.variants[0]!.variantId;
    const countRows = (): number => {
      const row = database.connection
        .prepare("SELECT COUNT(*) AS count FROM character_variants")
        .get() as { count: number };
      return row.count;
    };

    expect(countRows()).toBe(1);
    const inactive = service.deactivateVariant(visual.visualId, variantId);
    expect(inactive.variants[0]?.status).toBe("inactive");
    expect(countRows()).toBe(1);
    expect(characterVisualSnapshotToVariantCatalog(repository.list())).toEqual(
      []
    );
    await expect(
      fs.stat(
        path.join(workspaceRoot, inactive.variants[0]!.files[0]!.libraryPath)
      )
    ).resolves.toBeDefined();

    const active = service.activateVariant(visual.visualId, variantId);
    expect(active.variants[0]?.status).toBe("active");
    expect(
      characterVisualSnapshotToVariantCatalog(repository.list())
    ).toHaveLength(1);
    expect(countRows()).toBe(1);
  });

  it("rejects duplicate slots, missing mouth slots, duplicate visual IDs, and duplicate paths", () => {
    const file = (visualId: string, variantId: string, key: string) => ({
      key,
      libraryPath: `library/character-visuals/${visualId}/${variantId}/${key}.png`,
      mimeType: "image/png" as const,
      checksum: "a".repeat(64),
      sizeBytes: 1,
      width: 600,
      height: 1000
    });
    const singleVisual = {
      visualId: "validation-visual",
      name: "Validation",
      description: "",
      status: "active" as const,
      baseWidth: 600,
      baseHeight: 1000,
      variants: [
        {
          variantId: "validation-single",
          label: "Single",
          renderType: "single-image" as const,
          tags: [],
          files: [file("validation-visual", "validation-single", "single")]
        }
      ],
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z"
    };
    const duplicateSlot = validateCharacterVisualCatalog([
      {
        ...singleVisual,
        variants: [
          {
            ...singleVisual.variants[0]!,
            files: [
              file("validation-visual", "validation-single", "single"),
              file("validation-visual", "validation-single", "single")
            ]
          }
        ]
      }
    ]);
    expect(duplicateSlot.valid).toBe(false);

    const missingMouthSlot = validateCharacterVisualCatalog([
      {
        ...singleVisual,
        variants: [
          {
            variantId: "validation-mouth",
            label: "Mouth",
            renderType: "mouth-pair" as const,
            tags: [],
            files: [file("validation-visual", "validation-mouth", "closed")]
          }
        ]
      }
    ]);
    expect(missingMouthSlot.valid).toBe(false);

    const duplicateGlobalEntries = validateCharacterVisualCatalog([
      singleVisual,
      singleVisual
    ]);
    const duplicateMessages = duplicateGlobalEntries.issues.map(
      (issue) => issue.message
    );
    expect(duplicateMessages).toEqual(
      expect.arrayContaining([
        "visualId must be unique",
        "variantId must be unique",
        "libraryPath must be unique"
      ])
    );
  });

  it("streams a multipart file into staging and cleans the staging root", async () => {
    const { service, workspaceRoot } = await makeService();
    const staged = await service.stageUpload({
      stream: Readable.from([pngBytes]),
      mimeType: "image/png",
      filename: "client-name.png"
    });
    const stagedPath = path.join(workspaceRoot, staged.fileRelativePath);
    await expect(fs.readFile(stagedPath)).resolves.toEqual(pngBytes);

    await service.discardStaged(staged);
    await expect(
      fs.stat(path.join(workspaceRoot, staged.stagingRelativePath))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns deterministic ordering regardless of seed input order", async () => {
    const { service } = await makeService();
    const sourceRoot = path.join(process.cwd(), "doc", "assets");
    const reversedCatalog = [...legacyCharacterVisualSeed].reverse();
    const snapshot = await service.seedLegacyCatalog({
      sourceRoot,
      catalog: reversedCatalog,
      names: legacyCharacterVisualNames,
      descriptions: legacyCharacterVisualDescriptions
    });

    expect(snapshot.map((visual) => visual.visualId)).toEqual([
      "character-learner",
      "character-mentor"
    ]);
    expect(
      snapshot.flatMap((visual) =>
        visual.variants.map((variant) => variant.variantId)
      )
    ).toEqual(
      snapshot
        .flatMap((visual) =>
          visual.variants.map((variant) => variant.variantId)
        )
        .sort()
    );
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

  it("keeps the previous ready file when a variant replacement transaction fails", async () => {
    const { repository, service, workspaceRoot } = await makeService();
    const visual = service.create({ name: "Replacement visual" });
    const before = await service.createVariant(visual.visualId, {
      label: "Before",
      renderType: "single-image",
      tags: [],
      files: [{ key: "single", content: pngBytes, mimeType: "image/png" }]
    });
    const variant = before.variants[0]!;
    const filePath = path.join(workspaceRoot, variant.files[0]!.libraryPath);
    vi.spyOn(repository, "transaction").mockImplementation(() => {
      throw new Error("database replacement failed");
    });

    await expect(
      service.updateVariant(visual.visualId, variant.variantId, {
        label: "After",
        renderType: "single-image",
        tags: [],
        files: [{ key: "single", content: pngBytes, mimeType: "image/png" }]
      })
    ).rejects.toThrow("database replacement failed");
    await expect(fs.readFile(filePath)).resolves.toEqual(pngBytes);
    expect(repository.list()).toEqual([before]);
  });

  it("does not overwrite concurrent visual metadata during variant registration", async () => {
    const { repository, service } = await makeService();
    const visual = service.create({ name: "Original visual" });
    const originalTransaction = repository.transaction.bind(repository);
    vi.spyOn(repository, "transaction").mockImplementation((operation) => {
      repository.updateVisual(visual.visualId, {
        name: "Concurrent visual",
        description: "Concurrent description",
        status: "inactive",
        updatedAt: "2026-08-14T00:00:01.000Z"
      });
      return originalTransaction(operation);
    });

    const result = await service.createVariant(visual.visualId, {
      label: "Concurrent-safe variant",
      renderType: "single-image",
      tags: [],
      files: [
        {
          key: "single",
          content: makeTransparentPng(600, 1000, 1),
          mimeType: "image/png"
        }
      ]
    });

    expect(result).toMatchObject({
      name: "Concurrent visual",
      description: "Concurrent description",
      status: "inactive",
      baseWidth: 600,
      baseHeight: 1000
    });
  });

  it("rechecks a concurrently initialized base canvas before committing a variant", async () => {
    const { repository, service } = await makeService();
    const visual = service.create({ name: "Concurrent canvas visual" });
    const originalTransaction = repository.transaction.bind(repository);
    vi.spyOn(repository, "transaction").mockImplementation((operation) => {
      repository.updateBaseCanvas(
        visual.visualId,
        600,
        1000,
        "2026-08-14T00:00:01.000Z"
      );
      return originalTransaction(operation);
    });

    await expect(
      service.createVariant(visual.visualId, {
        label: "Wrong canvas",
        renderType: "single-image",
        tags: [],
        files: [
          {
            key: "single",
            content: makeTransparentPng(700, 1000, 1),
            mimeType: "image/png"
          }
        ]
      })
    ).rejects.toMatchObject({ code: "CHARACTER_VISUAL_CANVAS_SIZE_MISMATCH" });
    expect(repository.findById(visual.visualId)).toMatchObject({
      baseWidth: 600,
      baseHeight: 1000,
      variants: []
    });
    await expect(service.findOrphanedFiles()).resolves.toEqual([]);
  });

  it("promotes replacements to immutable paths while the old path remains ready", async () => {
    const { repository, service, workspaceRoot } = await makeService();
    const visual = service.create({ name: "Immutable replacement visual" });
    const before = await service.createVariant(visual.visualId, {
      label: "Before",
      renderType: "single-image",
      tags: [],
      files: [{ key: "single", content: pngBytes, mimeType: "image/png" }]
    });
    const beforeFile = before.variants[0]!.files[0]!;
    const beforePath = path.join(workspaceRoot, beforeFile.libraryPath);
    let oldFileWasReadyAtTransactionBoundary = false;
    vi.spyOn(repository, "transaction").mockImplementation(() => {
      oldFileWasReadyAtTransactionBoundary = existsSync(beforePath);
      throw new Error("simulate process interruption before metadata commit");
    });

    await expect(
      service.updateVariant(visual.visualId, before.variants[0]!.variantId, {
        label: "After",
        renderType: "single-image",
        tags: [],
        files: [
          {
            key: "single",
            content: makeTransparentPng(1, 1, 1),
            mimeType: "image/png"
          }
        ]
      })
    ).rejects.toThrow("simulate process interruption");
    expect(oldFileWasReadyAtTransactionBoundary).toBe(true);
    await expect(fs.readFile(beforePath)).resolves.toEqual(pngBytes);
  });

  it("switches metadata to a new immutable path after a successful replacement", async () => {
    const { service, workspaceRoot } = await makeService();
    const visual = service.create({ name: "Successful immutable replacement" });
    const before = await service.createVariant(visual.visualId, {
      label: "Before",
      renderType: "single-image",
      tags: [],
      files: [{ key: "single", content: pngBytes, mimeType: "image/png" }]
    });
    const beforeFile = before.variants[0]!.files[0]!;
    const beforePath = path.join(workspaceRoot, beforeFile.libraryPath);
    const replacement = makeTransparentPng(1, 1, 1);
    const after = await service.updateVariant(
      visual.visualId,
      before.variants[0]!.variantId,
      {
        label: "After",
        renderType: "single-image",
        tags: [],
        files: [{ key: "single", content: replacement, mimeType: "image/png" }]
      }
    );
    const afterFile = after.variants[0]!.files[0]!;
    expect(afterFile.libraryPath).not.toBe(beforeFile.libraryPath);
    await expect(
      fs.readFile(path.join(workspaceRoot, afterFile.libraryPath))
    ).resolves.toEqual(replacement);
    await expect(
      fs.stat(path.join(workspaceRoot, beforeFile.libraryPath))
    ).rejects.toMatchObject({ code: "ENOENT" });

    await fs.mkdir(path.dirname(beforePath), { recursive: true });
    await fs.writeFile(beforePath, pngBytes);
    await expect(
      service.readManagedFileByPath(
        visual.visualId,
        after.variants[0]!.variantId,
        path.basename(beforeFile.libraryPath)
      )
    ).resolves.toEqual({
      content: pngBytes,
      mimeType: "image/png"
    });
  });

  it("diagnoses unreferenced final and staging files without deleting them", async () => {
    const { service, workspaceRoot } = await makeService();
    const orphanFinalPath = path.join(
      workspaceRoot,
      "library/character-visuals/orphan-visual/orphan-variant/orphan.png"
    );
    const orphanStagingPath = path.join(
      workspaceRoot,
      "library/staging/character-visual-upload-crashed/upload.bin"
    );
    await fs.mkdir(path.dirname(orphanFinalPath), { recursive: true });
    await fs.mkdir(path.dirname(orphanStagingPath), { recursive: true });
    await fs.writeFile(orphanFinalPath, pngBytes);
    await fs.writeFile(orphanStagingPath, pngBytes);

    await expect(service.findOrphanedFiles()).resolves.toEqual([
      "library/character-visuals/orphan-visual/orphan-variant/orphan.png",
      "library/staging/character-visual-upload-crashed/upload.bin"
    ]);
    await expect(fs.readFile(orphanFinalPath)).resolves.toEqual(pngBytes);
    await expect(fs.readFile(orphanStagingPath)).resolves.toEqual(pngBytes);
    await expect(
      service.readManagedFileByPath(
        "orphan-visual",
        "orphan-variant",
        "orphan.png"
      )
    ).resolves.toEqual({
      content: pngBytes,
      mimeType: "image/png"
    });
  });

  it("does not install seed files when the existing catalog read fails", async () => {
    const { repository, service, workspaceRoot } = await makeService();
    const sourceRoot = path.join(process.cwd(), "doc", "assets");
    const listSpy = vi.spyOn(repository, "list").mockImplementation(() => {
      throw new Error("existing catalog read failed");
    });

    await expect(
      service.seedLegacyCatalog({
        sourceRoot,
        catalog: legacyCharacterVisualSeed,
        names: legacyCharacterVisualNames,
        descriptions: legacyCharacterVisualDescriptions
      })
    ).rejects.toThrow("existing catalog read failed");

    expect(listSpy).toHaveBeenCalledTimes(1);
    await expect(
      fs.stat(
        path.join(
          workspaceRoot,
          "library/character-visuals/character-mentor/character-mentor-stand-v1/single.png"
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes newly installed files when the metadata transaction fails", async () => {
    const { repository, service, workspaceRoot } = await makeService();
    vi.spyOn(repository, "transaction").mockImplementation(() => {
      throw new Error("database write failed");
    });

    await expect(
      service.seedLegacyCatalog({
        sourceRoot: path.join(process.cwd(), "doc", "assets"),
        catalog: legacyCharacterVisualSeed,
        names: legacyCharacterVisualNames,
        descriptions: legacyCharacterVisualDescriptions
      })
    ).rejects.toThrow("database write failed");

    await expect(
      fs.stat(
        path.join(
          workspaceRoot,
          "library/character-visuals/character-mentor/character-mentor-stand-v1/single.png"
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(repository.list()).toEqual([]);
  });
});
